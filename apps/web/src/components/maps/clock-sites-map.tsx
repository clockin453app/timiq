"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { ClockAssignedSite } from "../../features/time-clock/api";
import { nearestSiteId } from "../../lib/geo";
import { OSM_TILE_ATTRIBUTION, OSM_TILE_LAYER_URL } from "./leaflet-default-tiles";

export const CLOCK_MAP_FALLBACK_MESSAGE =
  "Map temporarily unavailable. GPS validation is still active.";

function siteMarkerIcon(isNearest: boolean) {
  const cls = isNearest
    ? "timiq-leaflet-site-marker timiq-leaflet-site-marker--nearest"
    : "timiq-leaflet-site-marker";

  return L.divIcon({
    className: "timiq-leaflet-marker-host",
    html: `<div class="${cls}" aria-hidden="true"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export type ClockSitesMapProps = {
  employeeLatitude: number;
  employeeLongitude: number;
  accuracyMeters?: number;
  sites: ClockAssignedSite[];
  /** Called when the map hits a fault (catch, init failure, or error boundary). Parent may disable Leaflet for the session. */
  onMapFault?: () => void;
};

type BoundaryState = { hasError: boolean };

/** Catches React render/lifecycle errors from the map subtree only (not async Leaflet handlers). */
class ClockSitesMapErrorBoundary extends Component<
  { children: ReactNode; onMapFault?: () => void },
  BoundaryState
> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onMapFault?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="timiq-leaflet-shell flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
          style={{ width: "100%" }}
        >
          {CLOCK_MAP_FALLBACK_MESSAGE}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Rounded keys limit effect re-runs while GPS is stabilising (avoids destroy/recreate loops that
 * break Leaflet panes on mobile — common source of `el._leaflet_pos` errors).
 */
function useMapEffectKeys(
  employeeLatitude: number,
  employeeLongitude: number,
  accuracyMeters: number | undefined,
  sites: ClockAssignedSite[],
) {
  const sitesSignature = useMemo(
    () =>
      sites
        .map((s) => `${s.id}:${s.latitude}:${s.longitude}:${s.geofence_radius_meters}`)
        .join("|"),
    [sites],
  );

  const coordsKey = useMemo(() => {
    if (
      !Number.isFinite(employeeLatitude) ||
      !Number.isFinite(employeeLongitude) ||
      Math.abs(employeeLatitude) > 90 ||
      Math.abs(employeeLongitude) > 180
    ) {
      return "invalid";
    }
    return `${employeeLatitude.toFixed(3)},${employeeLongitude.toFixed(3)}`;
  }, [employeeLatitude, employeeLongitude]);

  const accuracyKey = useMemo(() => {
    if (accuracyMeters === undefined || !Number.isFinite(accuracyMeters)) {
      return "na";
    }
    return String(Math.round(accuracyMeters / 10) * 10);
  }, [accuracyMeters]);

  return { coordsKey, accuracyKey, sitesSignature };
}

function ClockSitesMapInner({
  employeeLatitude,
  employeeLongitude,
  accuracyMeters,
  sites,
  onMapFault,
}: ClockSitesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapFault, setMapFault] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);

  function reportMapFault(message: string) {
    onMapFault?.();
    setMapFault(message);
  }

  const { coordsKey, accuracyKey, sitesSignature } = useMapEffectKeys(
    employeeLatitude,
    employeeLongitude,
    accuracyMeters,
    sites,
  );

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    setMapFault(null);

    if (!clientReady) {
      return undefined;
    }

    const employeeOk =
      Number.isFinite(employeeLatitude) &&
      Number.isFinite(employeeLongitude) &&
      Math.abs(employeeLatitude) <= 90 &&
      Math.abs(employeeLongitude) <= 180;

    if (!employeeOk) {
      setMapFault("GPS coordinates are not ready to show the map.");
      return undefined;
    }

    const validSites = sites.filter(
      (s) =>
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude) &&
        Math.abs(s.latitude) <= 90 &&
        Math.abs(s.longitude) <= 180 &&
        Number.isFinite(s.geofence_radius_meters) &&
        s.geofence_radius_meters > 0,
    );

    if (validSites.length === 0) {
      setMapFault("No valid assigned sites to display on the map.");
      return undefined;
    }

    const nearestId = nearestSiteId(employeeLatitude, employeeLongitude, validSites);

    let map: L.Map | null = null;
    let ro: ResizeObserver | null = null;
    let alive = true;
    let layoutAttempts = 0;
    let invalidateTimer: number | null = null;
    let bootstrapRaf1: number | null = null;
    let bootstrapRaf2: number | null = null;
    let tryInitRaf: number | null = null;
    let postInitRaf1: number | null = null;
    let postInitRaf2: number | null = null;

    const safeInvalidate = () => {
      if (!alive || !map) {
        return;
      }
      let container: HTMLElement;
      try {
        container = map.getContainer();
      } catch {
        return;
      }
      if (!container?.isConnected) {
        return;
      }
      if (container.offsetWidth < 2 || container.offsetHeight < 2) {
        return;
      }
      try {
        map.invalidateSize({ animate: false });
      } catch {
        /* Leaflet can throw if panes are mid-teardown (e.g. el._leaflet_pos undefined) */
      }
    };

    const scheduleInvalidate = () => {
      if (!alive) {
        return;
      }
      if (invalidateTimer !== null) {
        window.clearTimeout(invalidateTimer);
      }
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = null;
        if (!alive) {
          return;
        }
        safeInvalidate();
      }, 120);
    };

    const onWinResize = () => scheduleInvalidate();
    const onOrientation = () => window.requestAnimationFrame(() => scheduleInvalidate());
    const onVisViewport = () => scheduleInvalidate();

    const teardown = () => {
      alive = false;
      if (bootstrapRaf1 !== null) {
        window.cancelAnimationFrame(bootstrapRaf1);
        bootstrapRaf1 = null;
      }
      if (bootstrapRaf2 !== null) {
        window.cancelAnimationFrame(bootstrapRaf2);
        bootstrapRaf2 = null;
      }
      if (tryInitRaf !== null) {
        window.cancelAnimationFrame(tryInitRaf);
        tryInitRaf = null;
      }
      if (postInitRaf1 !== null) {
        window.cancelAnimationFrame(postInitRaf1);
        postInitRaf1 = null;
      }
      if (postInitRaf2 !== null) {
        window.cancelAnimationFrame(postInitRaf2);
        postInitRaf2 = null;
      }
      if (invalidateTimer !== null) {
        window.clearTimeout(invalidateTimer);
        invalidateTimer = null;
      }
      window.removeEventListener("resize", onWinResize);
      window.removeEventListener("orientationchange", onOrientation);
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.removeEventListener("resize", onVisViewport);
      }
      if (ro) {
        try {
          ro.disconnect();
        } catch {
          /* ignore */
        }
        ro = null;
      }
      if (map) {
        try {
          map.remove();
        } catch {
          /* ignore */
        }
        map = null;
      }
      const el = containerRef.current;
      if (el) {
        try {
          el.replaceChildren();
        } catch {
          /* ignore */
        }
      }
    };

    const tryInit = () => {
      if (!alive) {
        return;
      }
      const el = containerRef.current;
      if (!el) {
        return;
      }
      layoutAttempts += 1;
      if (layoutAttempts > 240) {
        setMapFault("Map container did not become visible in time.");
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < 2 || h < 2) {
        tryInitRaf = window.requestAnimationFrame(() => {
          tryInitRaf = null;
          tryInit();
        });
        return;
      }

      try {
        map = L.map(el, { preferCanvas: false }).setView([employeeLatitude, employeeLongitude], 15);
      } catch {
        reportMapFault(CLOCK_MAP_FALLBACK_MESSAGE);
        teardown();
        return;
      }

      if (!alive || !map) {
        try {
          map?.remove();
        } catch {
          /* ignore */
        }
        map = null;
        return;
      }

      const layerMap = map;

      try {
        L.tileLayer(OSM_TILE_LAYER_URL, {
          attribution: OSM_TILE_ATTRIBUTION,
          maxZoom: 19,
        }).addTo(layerMap);

        L.circleMarker([employeeLatitude, employeeLongitude], {
          radius: 7,
          color: "#1e293b",
          weight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.95,
        })
          .addTo(layerMap)
          .bindPopup("Your captured GPS position");

        if (accuracyMeters !== undefined && accuracyMeters > 0 && accuracyMeters < 5000) {
          L.circle([employeeLatitude, employeeLongitude], {
            radius: accuracyMeters,
            color: "#94a3b8",
            weight: 1,
            dashArray: "4 6",
            fillOpacity: 0,
          }).addTo(layerMap);
        }

        const bounds = L.latLngBounds([[employeeLatitude, employeeLongitude]]);

        validSites.forEach((site) => {
          const isNearest = site.id === nearestId;
          const circle = L.circle([site.latitude, site.longitude], {
            radius: site.geofence_radius_meters,
            color: isNearest ? "#0f766e" : "#64748b",
            weight: isNearest ? 2 : 1,
            fillColor: isNearest ? "#14b8a6" : "#94a3b8",
            fillOpacity: isNearest ? 0.14 : 0.08,
          }).addTo(layerMap);

          circle.bindPopup(
            `${site.name}${isNearest ? " (nearest assigned site)" : ""}<br />Radius ${site.geofence_radius_meters}m`,
          );

          L.marker([site.latitude, site.longitude], {
            icon: siteMarkerIcon(isNearest),
            zIndexOffset: isNearest ? 500 : 250,
          })
            .addTo(layerMap)
            .bindPopup(
              `${site.name}${isNearest ? " (nearest assigned site)" : ""}<br />Site center`,
            );

          bounds.extend([site.latitude, site.longitude]);
        });

        layerMap.fitBounds(bounds.pad(0.12));
      } catch {
        reportMapFault(CLOCK_MAP_FALLBACK_MESSAGE);
        teardown();
        return;
      }

      if (!alive) {
        teardown();
        return;
      }

      ro = new ResizeObserver(() => {
        if (!alive) {
          return;
        }
        scheduleInvalidate();
      });
      ro.observe(el);
      window.addEventListener("resize", onWinResize);
      window.addEventListener("orientationchange", onOrientation);
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.addEventListener("resize", onVisViewport);
      }
      postInitRaf1 = window.requestAnimationFrame(() => {
        postInitRaf1 = null;
        postInitRaf2 = window.requestAnimationFrame(() => {
          postInitRaf2 = null;
          scheduleInvalidate();
        });
      });
    };

    bootstrapRaf1 = window.requestAnimationFrame(() => {
      bootstrapRaf1 = null;
      bootstrapRaf2 = window.requestAnimationFrame(() => {
        bootstrapRaf2 = null;
        tryInit();
      });
    });

    return teardown;
    /* sites + raw lat/lng omitted: sitesSignature + coordsKey + accuracyKey avoid remounting on every GPS tick. */
  }, [clientReady, coordsKey, accuracyKey, sitesSignature]);

  if (mapFault) {
    return (
      <div
        className="timiq-leaflet-shell flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
        style={{ width: "100%" }}
      >
        {mapFault}
      </div>
    );
  }

  return (
    <div
      className="timiq-leaflet-shell overflow-hidden rounded border border-[var(--color-border-dark)]"
      ref={containerRef}
      style={{ height: "260px", width: "100%", minHeight: "260px" }}
    />
  );
}

/** Employee GPS position plus assigned active sites and geofence circles (nearest site emphasized). */
export function ClockSitesMap(props: ClockSitesMapProps) {
  const { onMapFault, ...innerProps } = props;
  return (
    <ClockSitesMapErrorBoundary onMapFault={onMapFault}>
      <ClockSitesMapInner {...innerProps} onMapFault={onMapFault} />
    </ClockSitesMapErrorBoundary>
  );
}
