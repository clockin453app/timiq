"use client";

import dynamic from "next/dynamic";

import { MapLoadingPlaceholder } from "./map-loading-placeholder";

/**
 * Client-only ClockSitesMap. Resolves named export via `{ default }` so
 * next/dynamic always receives a valid module shape (avoids stuck loading / invalid element).
 */
export const ClockSitesMap = dynamic(
  () =>
    import("./clock-sites-map").then((mod) => ({
      default: mod.ClockSitesMap,
    })),
  {
    ssr: false,
    loading: () => (
      <MapLoadingPlaceholder className="timiq-leaflet-shell flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]" />
    ),
  },
);
