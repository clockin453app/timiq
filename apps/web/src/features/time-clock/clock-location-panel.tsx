"use client";

import { useEffect, useId, useState } from "react";

import { ClockSitesMap } from "../../components/maps/clock-sites-map-lazy";
import { CLOCK_MAP_FALLBACK_MESSAGE } from "../../components/maps/map-messages";
import { Button } from "../../components/ui";
import { cn } from "../../lib/cn";
import type { GpsCapture } from "./gps";
import type { ClockAssignedSite, ClockStatus } from "./api";

type FlowStatus = ClockStatus["current_status"];

export type NearestSiteSummary = {
  site: ClockAssignedSite;
  distanceM: number;
  outside: boolean;
};

export type LocationBadge =
  | "inside"
  | "outside"
  | "improving"
  | "unavailable"
  | "preparing";

type GpsFailure = null | "denied" | "failed" | "unsupported";

type SharedLocationProps = {
  clockStatus: ClockStatus | null;
  flowStatus: FlowStatus;
  geoCapture: GpsCapture | null;
  gpsStatusLine: string;
  showGpsRetry: boolean;
  gpsAcquiring: boolean;
  gpsFailure: GpsFailure;
  locationBadge: LocationBadge;
  isSubmitting: boolean;
  isRefreshing: boolean;
  selfieCaptureActive: boolean;
  nearestSiteSummary: NearestSiteSummary | null;
  onRetryGps: () => void;
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
};

type ClockMapGpsDetailsProps = SharedLocationProps & {
  viewportClockMapMode: "unknown" | "narrow" | "wide";
  clockMapSessionOff: boolean;
  mapMountDeferred: boolean;
  assignedSites: ClockAssignedSite[];
  onMapFault: () => void;
};

function badgeLabel(badge: LocationBadge, t: SharedLocationProps["t"]): string {
  switch (badge) {
    case "inside":
      return t("clock.badge_inside_radius", "Inside radius");
    case "outside":
      return t("clock.badge_outside_radius", "Outside radius");
    case "improving":
      return t("clock.badge_improving", "Improving accuracy");
    case "unavailable":
      return t("clock.badge_location_unavailable", "Location unavailable");
    default:
      return t("clock.badge_preparing", "Preparing location");
  }
}

function badgeClasses(badge: LocationBadge): string {
  switch (badge) {
    case "inside":
      return "border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[var(--color-success-700)]";
    case "outside":
      return "border-[var(--color-danger-700)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]";
    case "improving":
      return "border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]";
    case "unavailable":
      return "border-[var(--color-danger-700)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]";
    default:
      return "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
  }
}

function recoveryHint(
  badge: LocationBadge,
  gpsFailure: GpsFailure,
  nearestSiteSummary: NearestSiteSummary | null,
  t: SharedLocationProps["t"],
): string | null {
  if (gpsFailure === "denied") {
    return t(
      "clock.recovery_denied",
      "Allow location access in your browser settings, then tap Refresh GPS.",
    );
  }
  if (gpsFailure === "unsupported") {
    return t(
      "clock.recovery_unsupported",
      "Use a browser that supports location services, or open TimIQ on your phone.",
    );
  }
  if (gpsFailure === "failed") {
    return t(
      "clock.recovery_failed",
      "Move outdoors with a clear sky view, then tap Refresh GPS.",
    );
  }
  if (badge === "improving") {
    return t(
      "clock.recovery_improving",
      "Stay still for a moment while GPS accuracy improves.",
    );
  }
  if (badge === "outside" && nearestSiteSummary) {
    return t(
      "clock.recovery_outside",
      "Move within {{meters}} m of {{site}}, then refresh GPS.",
      {
        meters: nearestSiteSummary.site.geofence_radius_meters,
        site: nearestSiteSummary.site.name,
      },
    );
  }
  return null;
}

/** Compact site + GPS status shown above primary clock actions. */
export function ClockLocationSummary({
  clockStatus,
  flowStatus,
  geoCapture,
  gpsStatusLine,
  showGpsRetry,
  gpsAcquiring,
  gpsFailure,
  locationBadge,
  isSubmitting,
  selfieCaptureActive,
  nearestSiteSummary,
  onRetryGps,
  t,
}: SharedLocationProps) {
  if (!clockStatus || flowStatus === "completed_today" || flowStatus === "no_assigned_sites") {
    return null;
  }

  const siteName =
    nearestSiteSummary?.site.name ??
    clockStatus.open_shift_location_name ??
    t("clock.nearest_site_pending", "Assigned site");

  const distanceLine = nearestSiteSummary
    ? t(
        "clock.distance_radius_line",
        "{{distance}} m away · allowed radius {{radius}} m",
        {
          distance: nearestSiteSummary.distanceM,
          radius: nearestSiteSummary.site.geofence_radius_meters,
        },
      )
    : gpsStatusLine;

  const hint = recoveryHint(locationBadge, gpsFailure, nearestSiteSummary, t);
  const accuracy =
    geoCapture && Number.isFinite(geoCapture.payload.accuracy_meters)
      ? Math.round(geoCapture.payload.accuracy_meters)
      : null;

  return (
    <section
      aria-labelledby="clock-location-summary-title"
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2.5 py-2 sm:px-3 sm:py-2.5"
      data-testid="clock-location-summary"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-sm font-semibold text-[var(--color-text)]"
            id="clock-location-summary-title"
          >
            {siteName}
          </h2>
          <p className="mt-0.5 break-words text-[13px] leading-snug text-[var(--color-text-muted)]">
            {distanceLine}
          </p>
          {accuracy !== null ? (
            <p className="mt-0.5 text-[12px] text-[var(--color-text-soft)]">
              {t("clock.gps_accuracy_short", "GPS accuracy {{meters}} m", { meters: accuracy })}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-[12px] font-semibold",
            badgeClasses(locationBadge),
          )}
          data-location-badge={locationBadge}
        >
          {locationBadge === "improving" ? (
            <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
          ) : null}
          {badgeLabel(locationBadge, t)}
        </span>
      </div>

      {hint ? (
        <p className="mt-1.5 text-[13px] leading-snug text-[var(--color-text)]" role="status">
          {hint}
        </p>
      ) : null}

      <div className="mt-1.5">
        <Button
          className="min-h-9 w-full sm:w-auto"
          data-testid="clock-refresh-gps"
          disabled={gpsAcquiring || isSubmitting || selfieCaptureActive}
          onClick={onRetryGps}
          type="button"
          variant="secondary"
        >
          {showGpsRetry
            ? t("clock.retry_location", "Retry location")
            : t("clock.refresh_gps", "Refresh GPS")}
        </Button>
      </div>
    </section>
  );
}

/** Collapsible map + technical GPS details. Collapsed by default on mobile. */
export function ClockMapGpsDetails({
  assignedSites,
  clockMapSessionOff,
  clockStatus,
  flowStatus,
  geoCapture,
  gpsAcquiring,
  gpsFailure,
  gpsStatusLine,
  isRefreshing,
  isSubmitting,
  mapMountDeferred,
  nearestSiteSummary,
  onMapFault,
  selfieCaptureActive,
  t,
  viewportClockMapMode,
}: ClockMapGpsDetailsProps) {
  const panelId = useId();
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    if (viewportClockMapMode === "wide") {
      setMapOpen(true);
    } else if (viewportClockMapMode === "narrow") {
      setMapOpen(false);
    }
  }, [viewportClockMapMode]);

  if (!clockStatus || flowStatus === "completed_today" || flowStatus === "no_assigned_sites") {
    return null;
  }

  const sites = assignedSites.length > 0 ? assignedSites : (clockStatus.assigned_sites ?? []);
  const canMountMap = mapOpen && mapMountDeferred && !clockMapSessionOff;

  return (
    <section
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)]"
      data-testid="clock-map-gps-details"
      data-map-default-collapsed={viewportClockMapMode === "narrow" ? "true" : "false"}
    >
      <button
        aria-controls={panelId}
        aria-expanded={mapOpen}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-[var(--color-text)]"
        data-testid="clock-map-disclosure"
        onClick={() => setMapOpen((open) => !open)}
        type="button"
      >
        <span>{t("clock.view_map_gps_details", "View map and GPS details")}</span>
        <span aria-hidden className="text-[var(--color-text-muted)]">
          {mapOpen ? "−" : "+"}
        </span>
      </button>

      {mapOpen ? (
        <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3" id={panelId}>
          <p className="text-[13px] text-[var(--color-text-muted)]" id="clock-map-accessible-summary">
            {nearestSiteSummary
              ? t(
                  "clock.map_summary",
                  "{{site}}: {{distance}} m away, allowed radius {{radius}} m. {{status}}",
                  {
                    site: nearestSiteSummary.site.name,
                    distance: nearestSiteSummary.distanceM,
                    radius: nearestSiteSummary.site.geofence_radius_meters,
                    status: nearestSiteSummary.outside
                      ? t("clock.badge_outside_radius", "Outside radius")
                      : t("clock.badge_inside_radius", "Inside radius"),
                  },
                )
              : gpsStatusLine}
          </p>

          {geoCapture ? (
            <dl className="grid grid-cols-1 gap-1 text-[12px] text-[var(--color-text-muted)] sm:grid-cols-2">
              <div>
                <dt className="inline font-medium text-[var(--color-text)]">
                  {t("clock.gps_coords", "Coordinates")}:{" "}
                </dt>
                <dd className="inline font-mono">
                  {geoCapture.payload.latitude.toFixed(5)}, {geoCapture.payload.longitude.toFixed(5)}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-[var(--color-text)]">
                  {t("clock.gps_accuracy_label", "Accuracy")}:{" "}
                </dt>
                <dd className="inline">{Math.round(geoCapture.payload.accuracy_meters)} m</dd>
              </div>
              <div>
                <dt className="inline font-medium text-[var(--color-text)]">
                  {t("clock.location_permission", "Location permission")}:{" "}
                </dt>
                <dd className="inline">
                  {gpsFailure === "denied"
                    ? t("clock.permission_denied", "Denied")
                    : gpsFailure
                      ? t("clock.permission_error", "Error")
                      : t("clock.permission_granted", "Granted / available")}
                </dd>
              </div>
            </dl>
          ) : null}

          <div
            aria-labelledby="clock-map-accessible-summary"
            className="w-full min-w-0 max-w-full overflow-x-hidden"
            role="region"
          >
            <div className="w-full min-w-0">
              {clockMapSessionOff ? (
                <div className="flex h-[240px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)] sm:h-[260px]">
                  {CLOCK_MAP_FALLBACK_MESSAGE}
                </div>
              ) : !canMountMap ? (
                <div className="flex h-[240px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-xs text-[var(--color-text-muted)] sm:h-[260px]">
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
                <div className="flex h-[240px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-sm text-[var(--color-text-muted)] sm:h-[260px]">
                  {gpsAcquiring
                    ? t("clock.map_waiting_gps", "Waiting for GPS to show the map…")
                    : CLOCK_MAP_FALLBACK_MESSAGE}
                </div>
              )}
            </div>
          </div>

          {selfieCaptureActive ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {t("clock.map_paused_camera", "Map interactions pause while the camera is open.")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
