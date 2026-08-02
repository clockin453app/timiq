"use client";

import dynamic from "next/dynamic";

import { MapLoadingPlaceholder } from "./map-loading-placeholder";

/**
 * Client-only LocationGeofenceMap. Resolves named export via `{ default }` so
 * next/dynamic always receives a valid module shape (avoids stuck loading / invalid element).
 */
export const LocationGeofenceMap = dynamic(
  () =>
    import("./location-geofence-map").then((mod) => ({
      default: mod.LocationGeofenceMap,
    })),
  {
    ssr: false,
    loading: () => (
      <MapLoadingPlaceholder className="timiq-leaflet-shell flex h-[220px] min-h-[220px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 text-center text-sm text-[var(--color-text-muted)]" />
    ),
  },
);
