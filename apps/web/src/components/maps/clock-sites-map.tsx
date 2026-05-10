"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";

import type { ClockAssignedSite } from "../../features/time-clock/api";
import { nearestSiteId } from "../../lib/geo";
import { OSM_TILE_ATTRIBUTION, OSM_TILE_LAYER_URL } from "./leaflet-default-tiles";

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

/** Employee GPS position plus assigned active sites and geofence circles (nearest site emphasized). */
export function ClockSitesMap({
  employeeLatitude,
  employeeLongitude,
  accuracyMeters,
  sites,
}: ClockSitesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nearestId = useMemo(
    () => nearestSiteId(employeeLatitude, employeeLongitude, sites),
    [employeeLatitude, employeeLongitude, sites],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const map = L.map(container).setView([employeeLatitude, employeeLongitude], 15);

    L.tileLayer(OSM_TILE_LAYER_URL, {
      attribution: OSM_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    L.circleMarker([employeeLatitude, employeeLongitude], {
      radius: 7,
      color: "#1e293b",
      weight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 0.95,
    })
      .addTo(map)
      .bindPopup("Your captured GPS position");

    if (accuracyMeters !== undefined && accuracyMeters > 0 && accuracyMeters < 5000) {
      L.circle([employeeLatitude, employeeLongitude], {
        radius: accuracyMeters,
        color: "#94a3b8",
        weight: 1,
        dashArray: "4 6",
        fillOpacity: 0,
      }).addTo(map);
    }

    const bounds = L.latLngBounds([[employeeLatitude, employeeLongitude]]);

    sites.forEach((site) => {
      const isNearest = site.id === nearestId;
      const circle = L.circle([site.latitude, site.longitude], {
        radius: site.geofence_radius_meters,
        color: isNearest ? "#0f766e" : "#64748b",
        weight: isNearest ? 2 : 1,
        fillColor: isNearest ? "#14b8a6" : "#94a3b8",
        fillOpacity: isNearest ? 0.14 : 0.08,
      }).addTo(map);

      circle.bindPopup(
        `${site.name}${isNearest ? " (nearest assigned site)" : ""}<br />Radius ${site.geofence_radius_meters}m`,
      );

      L.marker([site.latitude, site.longitude], {
        icon: siteMarkerIcon(isNearest),
        zIndexOffset: isNearest ? 500 : 250,
      })
        .addTo(map)
        .bindPopup(
          `${site.name}${isNearest ? " (nearest assigned site)" : ""}<br />Site center`,
        );

      bounds.extend([site.latitude, site.longitude]);
    });

    if (sites.length > 0) {
      map.fitBounds(bounds.pad(0.12));
    }

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
    };
  }, [employeeLatitude, employeeLongitude, accuracyMeters, sites, nearestId]);

  return (
    <div
      className="timiq-leaflet-shell overflow-hidden rounded border border-[var(--color-border-dark)]"
      ref={containerRef}
      style={{ height: "260px", width: "100%" }}
    />
  );
}
