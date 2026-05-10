"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";

import { OSM_TILE_ATTRIBUTION, OSM_TILE_LAYER_URL } from "./leaflet-default-tiles";

function centerDivIcon() {
  return L.divIcon({
    className: "timiq-leaflet-marker-host",
    html: '<div class="timiq-leaflet-marker-pin"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export type LocationGeofenceMapProps = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onLatLngChange: (latitude: number, longitude: number) => void;
};

/** Interactive OSM map: click or drag marker updates coordinates; radius drives geofence circle. */
export function LocationGeofenceMap({
  latitude,
  longitude,
  radiusMeters,
  onLatLngChange,
}: LocationGeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onLatLngChangeRef = useRef(onLatLngChange);
  onLatLngChangeRef.current = onLatLngChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const map = L.map(container).setView([latitude, longitude], 15);

    L.tileLayer(OSM_TILE_LAYER_URL, {
      attribution: OSM_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const circle = L.circle([latitude, longitude], {
      radius: radiusMeters,
      color: "#475569",
      weight: 2,
      fillColor: "#64748b",
      fillOpacity: 0.12,
    }).addTo(map);

    const marker = L.marker([latitude, longitude], {
      draggable: true,
      icon: centerDivIcon(),
    }).addTo(map);

    map.on("click", (event) => {
      const { lat, lng } = event.latlng;
      marker.setLatLng([lat, lng]);
      circle.setLatLng([lat, lng]);
      onLatLngChangeRef.current(lat, lng);
    });

    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      circle.setLatLng([lat, lng]);
      onLatLngChangeRef.current(lat, lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) {
      return;
    }

    marker.setLatLng([latitude, longitude]);
    circle.setLatLng([latitude, longitude]);
    circle.setRadius(radiusMeters);
    map.setView([latitude, longitude], map.getZoom(), { animate: false });
  }, [latitude, longitude, radiusMeters]);

  return (
    <div
      className="timiq-leaflet-shell overflow-hidden rounded border border-[var(--color-border-dark)]"
      ref={containerRef}
      style={{ height: "220px", width: "100%" }}
    />
  );
}
