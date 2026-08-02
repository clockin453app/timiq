"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import type { LocationGeofenceMapProps } from "./location-geofence-map";
import { MapLoadingPlaceholder } from "./map-loading-placeholder";

export const LocationGeofenceMap = dynamic(
  () =>
    import("./location-geofence-map").then((mod) => mod.LocationGeofenceMap),
  {
    ssr: false,
    loading: () => (
      <MapLoadingPlaceholder className="timiq-leaflet-shell flex h-[220px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 text-center text-sm text-[var(--color-text-muted)]" />
    ),
  },
) as ComponentType<LocationGeofenceMapProps>;
