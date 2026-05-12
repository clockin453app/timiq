"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { ClockAssignedSite } from "../../features/time-clock/api";
import { nearestSiteId } from "../../lib/geo";
import { OSM_TILE_ATTRIBUTION, OSM_TILE_LAYER_URL } from "./leaflet-default-tiles";

const MAP_FALLBACK_MESSAGE =
  "Map temporarily unavailable. GPS validation still active.";

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
};

type BoundaryState = { hasError: boolean };

/** Catches React render/lifecycle errors from the map subtree only (not async Leaflet handlers). */
class ClockSitesMapErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* optional: log to monitoring */
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="timiq-leaflet-shell flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
          style={{ width: "100%" }}
        >
          {MAP_FALLBACK_MESSAGE}
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
    return `${employeeLatitude.toFixed(4)},${employeeLongitude.toFixed(4)}`;
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
}: ClockSitesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapFault, setMapFault] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);

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

    const safeInvalidate = () => {
      if (!alive || !map) {
        return;
      }
      const el = map.getContainer();
      if (!el.isConnected) {
        return;
      }
      try {
        map.invalidateSize({ animate: false });
      } catch {
        /* Leaflet can throw if panes are mid-teardown */
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
        safeInvalidate();
      }, 120);
    };

    const onWinResize = () => scheduleInvalidate();
    const onOrientation = () => window.requestAnimationFrame(() => scheduleInvalidate());
    const onVisViewport = () => scheduleInvalidate();

    const teardown = () => {
      alive = false;
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
        window.requestAnimationFrame(tryInit);
        return;
      }

      try {
        map = L.map(el, { preferCanvas: false }).setView([employeeLatitude, employeeLongitude], 15);
      } catch {
        setMapFault(MAP_FALLBACK_MESSAGE);
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
        setMapFault(MAP_FALLBACK_MESSAGE);
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
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          scheduleInvalidate();
        });
      });
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryInit);
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
  return (
    <ClockSitesMapErrorBoundary>
      <ClockSitesMapInner {...props} />
    </ClockSitesMapErrorBoundary>
  );
}
