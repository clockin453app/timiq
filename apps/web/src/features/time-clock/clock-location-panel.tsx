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
  viewportClockMapMode,
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
        {t("clock.location_panel_title", "Location & assigned site")}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        {t(
          "clock.location_panel_hint",
          "Allow location access and stay within your assigned site radius before clocking.",
        )}
      </p>

      <div className="mt-4 rounded border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5 text-sm">
        <p className="font-medium text-[var(--color-text)]">{gpsStatusLine}</p>
        {geoCapture ? (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {t("clock.location_accuracy_sites", "Accuracy {{meters}}m · {{count}} assigned site(s)", {
              meters: Math.round(geoCapture.payload.accuracy_meters),
              count: clockStatus.active_location_count ?? 0,
            })}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {t("clock.location_sites_count", "{{count}} assigned active site(s)", {
              count: clockStatus.active_location_count ?? 0,
            })}
          </p>
        )}
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
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          {t("clock.nearest_site", "Nearest site")}:{" "}
          <span className="font-semibold text-[var(--color-text)]">{nearestSiteSummary.site.name}</span> (~
          {nearestSiteSummary.distanceM}m, {nearestSiteSummary.site.geofence_radius_meters}m radius)
          {nearestSiteSummary.outside ? (
            <span className="text-[var(--color-danger-700)]">
              {" "}
              · {t("clock.may_be_outside_geofence", "May be outside geofence")}
            </span>
          ) : (
            <span className="text-[var(--color-success-700)]">
              {" "}
              · {t("clock.within_geofence_hint", "Within radius")}
            </span>
          )}
        </p>
      ) : null}

      {sites.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-xs text-[var(--color-text-muted)]">
          {sites.map((site) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded border border-[var(--color-border)] bg-[var(--color-sheet)] px-2.5 py-1.5"
              key={site.id}
            >
              <span className="font-medium text-[var(--color-text)]">{site.name}</span>
              <span className="tabular-nums">
                {t("clock.site_radius_m", "{{radius}}m radius", { radius: site.geofence_radius_meters })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 w-full min-w-0 max-w-full overflow-x-hidden">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          {t("clock.map_heading", "Map")}
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {t("clock.map_supporting_note", "Supporting view only — GPS validation still runs on the server.")}
        </p>
        <div className="mt-2 w-full min-w-0">
          {viewportClockMapMode === "narrow" ? (
            <div className="flex min-h-[120px] w-full flex-col justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
              <p>{CLOCK_MAP_FALLBACK_MESSAGE}</p>
              <p className="mt-2 text-xs">
                {t(
                  "clock.map_narrow_hint",
                  "Live map is omitted on small screens for stability. Site radius details stay above.",
                )}
              </p>
            </div>
          ) : clockMapSessionOff ? (
            <div className="flex min-h-[120px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
              {CLOCK_MAP_FALLBACK_MESSAGE}
            </div>
          ) : !mapMountDeferred ? (
            <div className="flex min-h-[80px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">
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
            <div className="flex min-h-[80px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-sm text-[var(--color-text-muted)]">
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
