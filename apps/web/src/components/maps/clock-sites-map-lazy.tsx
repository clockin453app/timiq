"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import type { ClockSitesMapProps } from "./clock-sites-map";
import { MapLoadingPlaceholder } from "./map-loading-placeholder";

export const ClockSitesMap = dynamic(
  () => import("./clock-sites-map").then((mod) => mod.ClockSitesMap),
  {
    ssr: false,
    loading: () => (
      <MapLoadingPlaceholder className="timiq-leaflet-shell flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]" />
    ),
  },
) as ComponentType<ClockSitesMapProps>;
