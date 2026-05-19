"use client";

import { CLOCK_MAP_FALLBACK_MESSAGE, ClockSitesMap } from "../../components/maps";
import { Button } from "../../components/ui";
import type { GpsCapture } from "./gps";
import type { ClockAssignedSite, ClockStatus } from "./api";

type FlowStatus = ClockStatus["current_status"];

type NearestSiteSummary = {
  site: ClockAssignedSite;
  distanceM: number;
  outside: boolean;
};

type ClockLocationPanelProps = {
  clockStatus: ClockStatus | null;
  flowStatus: FlowStatus;
  geoCapture: GpsCapture | null;
  gpsStatusLine: string;
  showGpsRetry: boolean;
  gpsAcquiring: boolean;
  isSubmitting: boolean;
  isRefreshing: boolean;
  selfieCaptureActive: boolean;
  nearestSiteSummary: NearestSiteSummary | null;
  viewportClockMapMode: "unknown" | "narrow" | "wide";
  clockMapSessionOff: boolean;
  mapMountDeferred: boolean;
  assignedSites: ClockAssignedSite[];
  onRetryGps: () => void;
  onMapFault: () => void;
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
};

export function ClockLocationPanel({
  assignedSites,
  clockMapSessionOff,
  clockStatus,
  flowStatus,
  geoCapture,
  gpsAcquiring,
  gpsStatusLine,
  isRefreshing,
  isSubmitting,
  mapMountDeferred,
  nearestSiteSummary,
  onMapFault,
  onRetryGps,
  selfieCaptureActive,
  showGpsRetry,
  t,
}: ClockLocationPanelProps) {
  if (!clockStatus || flowStatus === "completed_today" || flowStatus === "no_assigned_sites") {
    return null;
  }

  const sites = assignedSites.length > 0 ? assignedSites : (clockStatus.assigned_sites ?? []);

  return (
    <section
      aria-labelledby="clock-location-panel-title"
      className="min-w-0 rounded-[var(--radius-md)] border-2 border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 sm:p-5"
    >
      <h2 className="text-lg font-semibold text-[var(--color-text)]" id="clock-location-panel-title">
        {t("clock.location_panel_title", "Location & site")}
      </h2>

      <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5 text-sm">
        <p className="font-medium text-[var(--color-text)]">{gpsStatusLine}</p>
        {geoCapture ? (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {t("clock.location_accuracy_sites", "Accuracy {{meters}}m · {{count}} site(s)", {
              meters: Math.round(geoCapture.payload.accuracy_meters),
              count: clockStatus.active_location_count ?? 0,
            })}
          </p>
        ) : null}
        {showGpsRetry ? (
          <Button
            className="mt-2"
            disabled={gpsAcquiring || isSubmitting || selfieCaptureActive}
            onClick={onRetryGps}
            type="button"
            variant="secondary"
          >
            {t("clock.retry_location", "Retry location")}
          </Button>
        ) : null}
      </div>

      {nearestSiteSummary ? (
        <p className="mt-3 text-sm text-[var(--color-text)]">
          <span className="font-semibold">{nearestSiteSummary.site.name}</span>
          <span className="text-[var(--color-text-muted)]">
            {" "}
            · {nearestSiteSummary.distanceM}m / {nearestSiteSummary.site.geofence_radius_meters}m
          </span>
          {nearestSiteSummary.outside ? (
            <span className="font-semibold text-[var(--color-danger-700)]">
              {" "}
              · {t("clock.may_be_outside_geofence", "Outside radius")}
            </span>
          ) : (
            <span className="font-semibold text-[var(--color-success-700)]">
              {" "}
              · {t("clock.within_geofence_hint", "Within radius")}
            </span>
          )}
        </p>
      ) : null}

      <div className="mt-4 w-full min-w-0 max-w-full overflow-x-hidden">
        <div className="w-full min-w-0">
          {clockMapSessionOff ? (
            <div className="flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
              {CLOCK_MAP_FALLBACK_MESSAGE}
            </div>
          ) : !mapMountDeferred ? (
            <div className="flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">
              {isSubmitting || isRefreshing
                ? t("clock.map_paused", "Map paused while the clock status updates…")
                : t("clock.map_preparing", "Preparing map…")}
            </div>
          ) : geoCapture &&
            Number.isFinite(geoCapture.payload.latitude) &&
            Number.isFinite(geoCapture.payload.longitude) ? (
            <ClockSitesMap
              accuracyMeters={geoCapture.payload.accuracy_meters}
              employeeLatitude={geoCapture.payload.latitude}
              employeeLongitude={geoCapture.payload.longitude}
              onMapFault={onMapFault}
              sites={sites}
            />
          ) : (
            <div className="flex min-h-[260px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-sm text-[var(--color-text-muted)]">
              {gpsAcquiring
                ? t("clock.map_waiting_gps", "Waiting for GPS to show the map…")
                : CLOCK_MAP_FALLBACK_MESSAGE}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
