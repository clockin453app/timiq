"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CLOCK_MAP_FALLBACK_MESSAGE, ClockSitesMap } from "../../components/maps";
import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  breakEnd,
  breakStart,
  clockInWithSelfie,
  clockOutWithSelfie,
  getClockStatus,
  type ClockAssignedSite,
  type ClockStatus,
} from "../../features/time-clock/api";
import {
  BACKEND_MAX_ACCURACY_M,
  type GpsCapture,
  type GpsStabilizationUpdate,
  isGpsClientSubmittable,
  stabilizeGpsFix,
} from "../../features/time-clock/gps";
import { ClockSelfieCameraOverlay } from "../../features/time-clock/clock-selfie-camera-overlay";
import { useLiveShiftDurationParts } from "../../features/time-clock/shift-duration";
import { cn } from "../../lib/cn";
import { haversineDistanceMeters } from "../../lib/geo";
import { isEmployee, useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { getMyEmployeeProfile } from "../../features/employee-profiles/api";
import { asFaceCheckStatus, faceCheckAfterClockMessage } from "../../features/face-check/labels";
import { useT } from "../../lib/i18n";

const EMPTY_ASSIGNED_SITES: ClockAssignedSite[] = [];

type ActiveSelfiePhase = "clock_in" | "clock_out";

type GpsFailure = null | "denied" | "failed" | "unsupported";

type FlowStatus = ClockStatus["current_status"];

function deriveFlowStatus(cs: ClockStatus): FlowStatus {
  if (cs.current_status) {
    return cs.current_status;
  }
  if (cs.active_location_count === 0) {
    return "no_assigned_sites";
  }
  if (cs.has_completed_shift_today && !cs.has_open_shift) {
    return "completed_today";
  }
  if (cs.has_open_shift && cs.current_break_open) {
    return "open_break";
  }
  if (cs.has_open_shift) {
    return "on_shift";
  }
  return "not_clocked_in";
}

function statusCardTitle(flow: FlowStatus, t: (key: string, fallback?: string) => string): string {
  switch (flow) {
    case "no_assigned_sites":
      return t("clock.status_no_assigned_sites", "No assigned sites");
    case "completed_today":
      return t("clock.status_completed_today", "Shift completed today");
    case "open_break":
      return t("clock.status_break_in_progress", "Break in progress");
    case "on_shift":
      return t("clock.status_on_shift", "On shift");
    case "not_clocked_in":
      return t("clock.status_not_clocked_in", "Not clocked in");
    default:
      return t("clock.status_default", "Clock");
  }
}

export function ClockClient() {
  const t = useT();
  const user = useCurrentUser();
  const clockInConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const clockOutConfirmButtonRef = useRef<HTMLButtonElement>(null);

  const [clockStatus, setClockStatus] = useState<ClockStatus | null>(null);
  const [geoCapture, setGeoCapture] = useState<GpsCapture | null>(null);
  const [selfieClockIn, setSelfieClockIn] = useState<File | null>(null);
  const [selfieClockOut, setSelfieClockOut] = useState<File | null>(null);

  const [activeSelfiePhase, setActiveSelfiePhase] = useState<ActiveSelfiePhase | null>(null);

  const [clockInPreviewUrl, setClockInPreviewUrl] = useState<string | null>(null);
  const [clockOutPreviewUrl, setClockOutPreviewUrl] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [gpsAcquisitionKey, setGpsAcquisitionKey] = useState(0);
  const [gpsAcquiring, setGpsAcquiring] = useState(false);
  const [gpsFailure, setGpsFailure] = useState<GpsFailure>(null);
  const [gpsBestAccuracy, setGpsBestAccuracy] = useState<number | null>(null);
  const [gpsSamples, setGpsSamples] = useState(0);
  const [gpsPhaseText, setGpsPhaseText] = useState<
    "idle" | "searching" | "improving" | "captured" | "too_low" | "denied" | "failed" | "unsupported"
  >("idle");

  /** unknown = before first client measure â€” do not mount Leaflet yet. */
  const [viewportClockMapMode, setViewportClockMapMode] = useState<"unknown" | "narrow" | "wide">(
    "unknown",
  );
  const [mapMountDeferred, setMapMountDeferred] = useState(false);
  const [clockMapSessionOff, setClockMapSessionOff] = useState(false);
  // Match server render: assume online until after mount, then sync from navigator (avoids hydration mismatch when offline).
  const [networkOnline, setNetworkOnline] = useState(true);
  const [faceReferenceConfigured, setFaceReferenceConfigured] = useState<boolean | null>(null);

  const handleClockMapFault = useCallback(() => {
    setClockMapSessionOff(true);
  }, []);

  const siteCountForGps = clockStatus === null ? undefined : clockStatus.active_location_count;

  const flowStatus: FlowStatus = useMemo(() => {
    if (!clockStatus) {
      return "not_clocked_in";
    }
    return deriveFlowStatus(clockStatus);
  }, [clockStatus]);

  const nearestSiteSummary = useMemo(() => {
    if (!geoCapture || !(clockStatus?.assigned_sites?.length)) {
      return null;
    }
    const { latitude, longitude } = geoCapture.payload;
    let best: ClockAssignedSite | null = null;
    let bestDistance = Infinity;
    for (const site of clockStatus.assigned_sites) {
      const d = haversineDistanceMeters(latitude, longitude, site.latitude, site.longitude);
      if (d < bestDistance) {
        bestDistance = d;
        best = site;
      }
    }
    if (!best) {
      return null;
    }
    const outside = bestDistance > best.geofence_radius_meters;
    return { site: best, distanceM: Math.round(bestDistance), outside };
  }, [geoCapture, clockStatus?.assigned_sites]);

  const gpsAcceptable = Boolean(geoCapture && isGpsClientSubmittable(geoCapture));

  useEffect(() => {
    if (!isEmployee(user) || !user.is_active || userHasLimitedAccess(user)) {
      setFaceReferenceConfigured(null);
      return;
    }
    let cancelled = false;
    void getMyEmployeeProfile()
      .then((profile) => {
        if (!cancelled) {
          setFaceReferenceConfigured(Boolean(profile.face_reference_configured));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFaceReferenceConfigured(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await getClockStatus();
      setClockStatus(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load clock status.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setViewportClockMapMode(mq.matches ? "narrow" : "wide");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setNetworkOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onUp = () => setNetworkOnline(true);
    const onDown = () => setNetworkOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  const stableGeoMapKey = useMemo(() => {
    if (!geoCapture) {
      return "";
    }
    const { latitude, longitude } = geoCapture.payload;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return "";
    }
    return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  }, [geoCapture]);

  useEffect(() => {
    const mapFlowOk = flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites";
    if (
      clockMapSessionOff ||
      viewportClockMapMode !== "wide" ||
      !mapFlowOk ||
      !stableGeoMapKey
    ) {
      setMapMountDeferred(false);
      return;
    }
    if (isRefreshing || isSubmitting) {
      setMapMountDeferred(false);
      return;
    }
    const id = window.setTimeout(() => setMapMountDeferred(true), 420);
    return () => {
      window.clearTimeout(id);
      setMapMountDeferred(false);
    };
  }, [
    clockMapSessionOff,
    viewportClockMapMode,
    flowStatus,
    stableGeoMapKey,
    isRefreshing,
    isSubmitting,
  ]);

  useEffect(() => {
    if (!selfieClockIn) {
      setClockInPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
      return;
    }
    const nextUrl = URL.createObjectURL(selfieClockIn);
    setClockInPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return nextUrl;
    });
  }, [selfieClockIn]);

  useEffect(() => {
    if (!selfieClockOut) {
      setClockOutPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
      return;
    }
    const nextUrl = URL.createObjectURL(selfieClockOut);
    setClockOutPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return nextUrl;
    });
  }, [selfieClockOut]);

  useEffect(() => {
    if (clockStatus?.has_open_shift) {
      setSelfieClockIn(null);
    }
  }, [clockStatus?.has_open_shift]);

  useEffect(() => {
    if (clockStatus?.has_completed_shift_today) {
      setSelfieClockIn(null);
      setSelfieClockOut(null);
    }
  }, [clockStatus?.has_completed_shift_today]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!geoCapture) {
        return;
      }
      if (gpsFailure === "denied" || gpsFailure === "unsupported") {
        return;
      }
      if ((clockStatus?.active_location_count ?? 0) === 0) {
        return;
      }
      if (!isGpsClientSubmittable(geoCapture)) {
        setGpsAcquisitionKey((key) => key + 1);
      }
    }, 8000);
    return () => window.clearInterval(id);
  }, [geoCapture, clockStatus?.active_location_count, gpsFailure]);

  function handleGpsUpdate(update: GpsStabilizationUpdate) {
    setGpsBestAccuracy(update.bestAccuracyMeters);
    setGpsSamples(update.samples);
    setGeoCapture(update.bestCapture);
    setGpsPhaseText(update.phase);
  }

  useEffect(() => {
    if (siteCountForGps === undefined) {
      return undefined;
    }

    if (siteCountForGps === 0) {
      setGeoCapture(null);
      setGpsAcquiring(false);
      setGpsFailure(null);
      setGpsBestAccuracy(null);
      setGpsSamples(0);
      setGpsPhaseText("idle");
      return undefined;
    }

    let cancelled = false;
    setGpsAcquiring(true);
    setGpsFailure(null);
    setGpsBestAccuracy(null);
    setGpsSamples(0);
    setGpsPhaseText("searching");

    (async () => {
      try {
        const capture = await stabilizeGpsFix({
          maxWaitMs: 25_000,
          preferredAccuracyM: 80,
          acceptAccuracyM: 100,
          onUpdate: (u) => {
            if (!cancelled) {
              handleGpsUpdate(u);
            }
          },
        });
        if (cancelled) {
          return;
        }
        setGeoCapture(capture);
        setGpsAcquiring(false);
        setGpsFailure(null);
        setGpsPhaseText(capture.payload.accuracy_meters <= 100 ? "captured" : "too_low");
        void refreshStatus();
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "";
        if (message === "PERMISSION_DENIED") {
          setGpsFailure("denied");
          setGpsPhaseText("denied");
        } else if (message === "UNSUPPORTED") {
          setGpsFailure("unsupported");
          setGpsPhaseText("unsupported");
        } else {
          setGpsFailure("failed");
          setGpsPhaseText("failed");
        }
        setGpsAcquiring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [siteCountForGps, gpsAcquisitionKey, refreshStatus]);

  function handleRetryGps() {
    setErrorMessage("");
    setGpsFailure(null);
    setGpsAcquisitionKey((key) => key + 1);
  }

  function openSelfieCapture(phase: ActiveSelfiePhase) {
    setErrorMessage("");
    setSuccessMessage("");
    setActiveSelfiePhase(phase);
  }

  function handleCancelSelfieCapture() {
    setActiveSelfiePhase(null);
  }

  function focusConfirmAfterSelfie(phase: ActiveSelfiePhase) {
    const targetRef = phase === "clock_in" ? clockInConfirmButtonRef : clockOutConfirmButtonRef;
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        const el = targetRef.current;
        if (!el) {
          return;
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      });
    }, 0);
  }

  function handleSelfieAccepted(file: File, phase: ActiveSelfiePhase) {
    setErrorMessage("");
    if (phase === "clock_in") {
      setSelfieClockIn(file);
    } else {
      setSelfieClockOut(file);
    }
    setSuccessMessage(
      phase === "clock_in"
        ? t("clock.confirm_selfie_in", "Selfie captured. Confirm clock in.")
        : t("clock.confirm_selfie_out", "Selfie captured. Confirm clock out."),
    );
    setActiveSelfiePhase(null);
    focusConfirmAfterSelfie(phase);
  }

  async function handleClockIn() {
    setErrorMessage("");
    setSuccessMessage("");
    if (!geoCapture || !isGpsClientSubmittable(geoCapture)) {
      setGpsAcquisitionKey((key) => key + 1);
      setErrorMessage("Getting a reliable GPS fixâ€¦ please wait, then try again.");
      return;
    }
    if (!selfieClockIn) {
      setErrorMessage("Capture a clock-in selfie before clocking in.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await clockInWithSelfie(geoCapture.payload, selfieClockIn);
      const faceNote = faceCheckAfterClockMessage(asFaceCheckStatus(result.face_check_status), t);
      setSuccessMessage(
        faceNote ? `Clock-in successful. ${faceNote}` : "Clock-in successful.",
      );
      setSelfieClockIn(null);
      setSelfieClockOut(null);
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock-in failed.");
      void refreshStatus();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClockOut() {
    setErrorMessage("");
    setSuccessMessage("");
    if (!geoCapture || !isGpsClientSubmittable(geoCapture)) {
      setGpsAcquisitionKey((key) => key + 1);
      setErrorMessage("Getting a reliable GPS fixâ€¦ please wait, then try again.");
      return;
    }
    if (!selfieClockOut) {
      setErrorMessage("Capture a clock-out selfie before clocking out.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await clockOutWithSelfie(geoCapture.payload, selfieClockOut);
      const faceNote = faceCheckAfterClockMessage(asFaceCheckStatus(result.face_check_status), t);
      setSuccessMessage(
        faceNote ? `Clock-out successful. ${faceNote}` : "Clock-out successful.",
      );
      setSelfieClockOut(null);
      setSelfieClockIn(null);
      setGeoCapture(null);
      setGpsAcquisitionKey((key) => key + 1);
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock-out failed.");
      void refreshStatus();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBreakStart() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);
    try {
      await breakStart();
      setSuccessMessage("Break started.");
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not start break.");
      void refreshStatus();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBreakEnd() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);
    try {
      await breakEnd();
      setSuccessMessage("Break ended.");
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not end break.");
      void refreshStatus();
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasOpenShift = Boolean(clockStatus?.has_open_shift);
  const noAssignedSites = Boolean(clockStatus && clockStatus.active_location_count === 0);
  const canClockInServer = Boolean(clockStatus?.can_clock_in);
  const canClockOutServer = Boolean(clockStatus?.can_clock_out);

  const currentShiftDurationParts = useLiveShiftDurationParts(
    clockStatus?.open_shift_clock_in_at,
    Boolean(clockStatus?.has_open_shift && clockStatus?.open_shift_clock_in_at),
  );

  const selfieGateIdle = activeSelfiePhase === null;

  const clockInEnabled =
    canClockInServer &&
    gpsAcceptable &&
    Boolean(selfieClockIn) &&
    !isSubmitting &&
    selfieGateIdle;

  const clockOutEnabled =
    canClockOutServer &&
    gpsAcceptable &&
    Boolean(selfieClockOut) &&
    !isSubmitting &&
    selfieGateIdle;

  const clockInDisabledReason = useMemo(() => {
    if (!clockStatus) {
      return "Loading statusâ€¦";
    }
    if (!canClockInServer) {
      return (
        clockStatus.clock_in_blocked_reason ??
        "You cannot clock in right now."
      );
    }
    if (gpsFailure === "denied") {
      return "Allow location access first.";
    }
    if (gpsFailure === "unsupported") {
      return "Geolocation is not supported in this browser.";
    }
    if (gpsFailure === "failed") {
      return "Could not get a reliable GPS fix. Use Retry location.";
    }
    if (gpsAcquiring && !gpsAcceptable) {
      return "Waiting for accurate GPS.";
    }
    if (!gpsAcceptable) {
      if (geoCapture) {
        return "Waiting for accurate GPS.";
      }
      return "Waiting for locationâ€¦";
    }
    if (nearestSiteSummary?.outside) {
      return "You may be outside the nearest assigned site; the server will confirm on submit.";
    }
    if (!selfieClockIn) {
      return "Take a clock-in selfie.";
    }
    if (!selfieGateIdle) {
      return "Finish or cancel the camera capture.";
    }
    return null;
  }, [
    clockStatus,
    canClockInServer,
    gpsFailure,
    gpsAcquiring,
    gpsAcceptable,
    geoCapture,
    nearestSiteSummary?.outside,
    selfieClockIn,
    selfieGateIdle,
  ]);

  const clockOutDisabledReason = useMemo(() => {
    if (!clockStatus) {
      return "Loading statusâ€¦";
    }
    if (!canClockOutServer) {
      return (
        clockStatus.clock_out_blocked_reason ??
        "You cannot clock out right now."
      );
    }
    if (gpsFailure === "denied") {
      return "Allow location access first.";
    }
    if (gpsFailure === "unsupported") {
      return "Geolocation is not supported in this browser.";
    }
    if (gpsFailure === "failed") {
      return "Could not get a reliable GPS fix. Use Retry location.";
    }
    if (gpsAcquiring && !gpsAcceptable) {
      return "Waiting for accurate GPS.";
    }
    if (!gpsAcceptable) {
      if (geoCapture) {
        return "Waiting for accurate GPS.";
      }
      return "Waiting for locationâ€¦";
    }
    if (!selfieClockOut) {
      return "Take a clock-out selfie.";
    }
    if (!selfieGateIdle) {
      return "Finish or cancel the camera capture.";
    }
    return null;
  }, [
    clockStatus,
    canClockOutServer,
    gpsFailure,
    gpsAcquiring,
    gpsAcceptable,
    geoCapture,
    selfieClockOut,
    selfieGateIdle,
  ]);

  const breakStartEnabled =
    hasOpenShift &&
    !Boolean(clockStatus?.current_break_open) &&
    !isSubmitting &&
    selfieGateIdle &&
    flowStatus === "on_shift";

  const breakEndEnabled =
    hasOpenShift &&
    Boolean(clockStatus?.current_break_open) &&
    !isSubmitting &&
    selfieGateIdle &&
    flowStatus === "open_break";

  const showGpsRetry = Boolean(gpsFailure);

  let gpsStatusLine = "";
  if (noAssignedSites) {
    gpsStatusLine = "No assigned active sites.";
  } else if (gpsFailure === "unsupported") {
    gpsStatusLine = "Geolocation is not supported in this browser.";
  } else if (gpsFailure === "denied") {
    gpsStatusLine = "Location permission denied.";
  } else if (gpsFailure === "failed") {
    gpsStatusLine = "Could not get a reliable GPS fix in time.";
  } else if (gpsAcquiring && gpsPhaseText === "searching") {
    gpsStatusLine = "Searching for locationâ€¦";
  } else if (gpsAcquiring && gpsPhaseText === "improving") {
    gpsStatusLine = "Improving GPS accuracyâ€¦";
  } else if (gpsAcceptable) {
    gpsStatusLine = "Location captured.";
  } else if (geoCapture && !gpsAcquiring) {
    gpsStatusLine = "GPS accuracy too low for secure clocking.";
  } else {
    gpsStatusLine = "Preparing locationâ€¦";
  }

  const locationOk = !noAssignedSites && gpsFailure !== "denied" && gpsFailure !== "unsupported";
  const assignedSitesFound = Boolean(clockStatus && clockStatus.active_location_count > 0);
  const gpsAccuracyOk = gpsAcceptable;
  const clockInSelfieOk = Boolean(selfieClockIn);
  const clockOutSelfieOk = Boolean(selfieClockOut);

  return (
    <Sheet>
      <PageHeader
        title={t("nav.clock", "Clock In / Out")}
        description={t(
          "clock.page_description",
          "GPS and a live camera selfie are required for each clock-in and clock-out.",
        )}
      />
      <SheetBody className="min-w-0 space-y-4 pb-6 sm:pb-8">
        {!networkOnline ? (
          <div className="rounded border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)]">
            <p className="font-semibold">{t("clock.offline_title")}</p>
            <p className="mt-1">{t("clock.offline_body")}</p>
          </div>
        ) : null}
        {faceReferenceConfigured === false ? (
          <div className="rounded border border-amber-700 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">
              {t("face_check.not_set_up_banner", "Face check is not set up")}
            </p>
            <p className="mt-1">
              {t(
                "clock.face_setup_banner_body",
                "Your clock action will still work, but your selfie cannot be compared until you upload a reference photo.",
              )}
            </p>
            <Link
              className="mt-2 inline-flex text-sm font-semibold text-amber-950 underline"
              href="/profile#face-check"
            >
              {t("face_check.set_up_link", "Set up face check")}
            </Link>
          </div>
        ) : null}
        {isRefreshing && !clockStatus ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading", "Loadingâ€¦")}</p>
        ) : null}

        {clockStatus && flowStatus === "no_assigned_sites" ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm">
            <p className="font-semibold text-[var(--color-text)]">{statusCardTitle(flowStatus, t)}</p>
            <p className="mt-2 text-[var(--color-text-muted)]">
              Ask your administrator to assign you to an active site before you can clock in.
            </p>
          </div>
        ) : null}

        {clockStatus && flowStatus === "completed_today" ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm">
            <p className="font-semibold text-[var(--color-text)]">{statusCardTitle(flowStatus, t)}</p>
            <p className="mt-2 text-[var(--color-text-muted)]">
              A second shift today is not allowed by current policy.
            </p>
          </div>
        ) : null}

        {clockStatus && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
          <div className="rounded-[var(--radius-md)] border-2 border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 sm:p-5">
            {flowStatus === "on_shift" || flowStatus === "open_break" ? (
              <div className="mb-4 space-y-1 border-b border-[var(--color-border)] pb-3 text-sm">
                {clockStatus.open_shift_location_name ? (
                  <p className="text-[var(--color-text-muted)]">
                    Site:{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {clockStatus.open_shift_location_name}
                    </span>
                  </p>
                ) : null}
                {clockStatus.open_shift_clock_in_at ? (
                  <p>
                    <span className="text-[var(--color-text-muted)]">On shift: </span>
                    <span className="font-mono font-semibold text-[var(--color-text)]" suppressHydrationWarning>
                      {currentShiftDurationParts.hms || currentShiftDurationParts.compact || "â€”"}
                    </span>
                    {flowStatus === "open_break" ? (
                      <span className="ml-2 text-[var(--color-warning-700)]">Â· On break</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}

            {flowStatus === "not_clocked_in" ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">
                    {t("clock.primary_capture_in", "Capture selfie to clock in")}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {t("clock.primary_gps_hint", "Allow location access and confirm when your selfie is ready.")}
                  </p>
                </div>
                <Button
                  className="w-full min-h-[3.25rem] text-base"
                  disabled={isSubmitting || activeSelfiePhase !== null}
                  onClick={() => openSelfieCapture("clock_in")}
                  type="button"
                >
                  {selfieClockIn
                    ? t("clock.retake_selfie_in", "Retake clock-in selfie")
                    : t("clock.primary_capture_in", "Capture selfie to clock in")}
                </Button>
                {selfieClockIn && clockInPreviewUrl ? (
                  <div className="rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={t("clock.alt_selfie_in", "Clock-in selfie preview")}
                      className="mx-auto max-h-36 max-w-full object-contain"
                      src={clockInPreviewUrl}
                    />
                  </div>
                ) : null}
                {selfieClockIn ? (
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {t("clock.confirm_selfie_in", "Selfie captured. Confirm clock in.")}
                  </p>
                ) : null}
                <Button
                  ref={clockInConfirmButtonRef}
                  className={cn(
                    "w-full min-h-[3.25rem] text-base font-semibold",
                    selfieClockIn &&
                      clockInEnabled &&
                      "ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-cell)]",
                  )}
                  disabled={!clockInEnabled}
                  onClick={handleClockIn}
                  type="button"
                >
                  {t("clock.action_clock_in", "Clock in")}
                </Button>
                {!clockInEnabled && clockInDisabledReason ? (
                  <p className="text-xs text-[var(--color-text-muted)]">{clockInDisabledReason}</p>
                ) : null}
              </div>
            ) : null}

            {flowStatus === "open_break" ? (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">
                  {t("clock.primary_end_break", "End break to clock out")}
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">{t("clock.end_break_before_out_hint")}</p>
                <Button
                  className="w-full min-h-[3rem] text-base"
                  disabled={!breakEndEnabled}
                  onClick={handleBreakEnd}
                  type="button"
                >
                  {t("clock.end_break", "End break")}
                </Button>
              </div>
            ) : null}

            {flowStatus === "on_shift" ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">
                    {t("clock.primary_capture_out", "Capture selfie to clock out")}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {t("clock.primary_gps_hint", "Allow location access and confirm when your selfie is ready.")}
                  </p>
                </div>
                <Button
                  className="w-full min-h-[3.25rem] text-base"
                  disabled={isSubmitting || activeSelfiePhase !== null}
                  onClick={() => openSelfieCapture("clock_out")}
                  type="button"
                >
                  {selfieClockOut
                    ? t("clock.retake_selfie_out", "Retake clock-out selfie")
                    : t("clock.primary_capture_out", "Capture selfie to clock out")}
                </Button>
                {selfieClockOut && clockOutPreviewUrl ? (
                  <div className="rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={t("clock.alt_selfie_out", "Clock-out selfie preview")}
                      className="mx-auto max-h-36 max-w-full object-contain"
                      src={clockOutPreviewUrl}
                    />
                  </div>
                ) : null}
                {selfieClockOut ? (
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {t("clock.confirm_selfie_out", "Selfie captured. Confirm clock out.")}
                  </p>
                ) : null}
                <Button
                  ref={clockOutConfirmButtonRef}
                  className={cn(
                    "w-full min-h-[3.25rem] text-base font-semibold",
                    selfieClockOut &&
                      clockOutEnabled &&
                      "ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-cell)]",
                  )}
                  disabled={!clockOutEnabled}
                  onClick={handleClockOut}
                  type="button"
                >
                  {t("clock.action_clock_out", "Clock out")}
                </Button>
                {!clockOutEnabled && clockOutDisabledReason ? (
                  <p className="text-xs text-[var(--color-text-muted)]">{clockOutDisabledReason}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {clockStatus && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
          <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5 text-sm">
            <p className="font-medium text-[var(--color-text)]">{gpsStatusLine}</p>
            {geoCapture ? (
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Accuracy {Math.round(geoCapture.payload.accuracy_meters)}m Â· Sites{" "}
                {clockStatus?.active_location_count ?? 0}
              </p>
            ) : null}
            {showGpsRetry ? (
              <Button
                className="mt-2"
                disabled={gpsAcquiring || isSubmitting || activeSelfiePhase !== null}
                onClick={handleRetryGps}
                type="button"
                variant="secondary"
              >
                Retry location
              </Button>
            ) : null}
          </div>
        ) : null}

        <details className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] text-sm">
          <summary className="cursor-pointer px-3 py-2.5 font-medium text-[var(--color-text)]">
            {t("clock.details_gps_checklist", "GPS details & checklist")}
          </summary>
          <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3">
            <ul className="space-y-2 text-[var(--color-text)]">
              <li className="flex flex-wrap items-start justify-between gap-2">
                <span>Location access</span>
                <span className={locationOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}>
                  {gpsFailure === "denied" ? "Permission needed" : locationOk ? "OK" : "â€”"}
                </span>
              </li>
              <li className="flex flex-wrap items-start justify-between gap-2">
                <span>Assigned site</span>
                <span
                  className={assignedSitesFound ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}
                >
                  {assignedSitesFound ? "Found" : "None"}
                </span>
              </li>
              <li className="flex flex-wrap items-start justify-between gap-2">
                <span>GPS accuracy (â‰¤{BACKEND_MAX_ACCURACY_M}m)</span>
                <span className={gpsAccuracyOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}>
                  {gpsAccuracyOk ? "OK" : gpsAcquiring ? "Improvingâ€¦" : geoCapture ? "Too low" : "â€”"}
                </span>
              </li>
              {flowStatus === "not_clocked_in" ? (
                <li className="flex flex-wrap items-start justify-between gap-2">
                  <span>{t("clock.req_clock_in_selfie", "Clock-in selfie")}</span>
                  <span
                    className={
                      clockInSelfieOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"
                    }
                  >
                    {clockInSelfieOk ? t("clock.req_captured", "Captured") : t("clock.req_needed", "Needed")}
                  </span>
                </li>
              ) : null}
              {(flowStatus === "on_shift" || flowStatus === "open_break") && canClockOutServer ? (
                <li className="flex flex-wrap items-start justify-between gap-2">
                  <span>{t("clock.req_clock_out_selfie", "Clock-out selfie")}</span>
                  <span
                    className={
                      clockOutSelfieOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"
                    }
                  >
                    {clockOutSelfieOk ? t("clock.req_captured", "Captured") : t("clock.req_needed", "Needed")}
                  </span>
                </li>
              ) : null}
            </ul>
            {gpsAcquiring || gpsBestAccuracy !== null ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Best accuracy: {gpsBestAccuracy !== null ? `${Math.round(gpsBestAccuracy)}m` : "â€”"} Â· Samples:{" "}
                {gpsSamples}
              </p>
            ) : null}
            {nearestSiteSummary ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Nearest site: <span className="font-semibold">{nearestSiteSummary.site.name}</span> (~
                {nearestSiteSummary.distanceM}m)
                {nearestSiteSummary.outside ? (
                  <span className="text-[var(--color-danger-700)]"> Â· May be outside geofence</span>
                ) : null}
              </p>
            ) : null}
          </div>
        </details>

        {geoCapture && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
          <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
            <p className="font-bold text-[var(--color-text)]">Map</p>
            {(clockStatus?.assigned_sites ?? []).length === 0 ? (
              <p className="mt-1 text-[var(--color-text-muted)]">No map data.</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Supporting view only â€” GPS validation still runs on the server.
              </p>
            )}
            <div className="mt-2 w-full min-w-0 max-w-full overflow-x-hidden">
              {viewportClockMapMode === "narrow" ? (
                <div className="flex min-h-[120px] w-full flex-col justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                  <p>{CLOCK_MAP_FALLBACK_MESSAGE}</p>
                  <p className="mt-2 text-xs">
                    Live map is omitted on small screens for stability. Your GPS and nearest site details stay above.
                  </p>
                </div>
              ) : clockMapSessionOff ? (
                <div className="flex min-h-[120px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                  {CLOCK_MAP_FALLBACK_MESSAGE}
                </div>
              ) : !mapMountDeferred ? (
                <div className="flex min-h-[80px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">
                  {isSubmitting || isRefreshing
                    ? "Map paused while the clock status updatesâ€¦"
                    : "Preparing mapâ€¦"}
                </div>
              ) : Number.isFinite(geoCapture.payload.latitude) &&
                Number.isFinite(geoCapture.payload.longitude) ? (
                <ClockSitesMap
                  accuracyMeters={geoCapture.payload.accuracy_meters}
                  employeeLatitude={geoCapture.payload.latitude}
                  employeeLongitude={geoCapture.payload.longitude}
                  onMapFault={handleClockMapFault}
                  sites={clockStatus?.assigned_sites ?? EMPTY_ASSIGNED_SITES}
                />
              ) : (
                <div className="flex min-h-[80px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-sm text-[var(--color-text-muted)]">
                  {CLOCK_MAP_FALLBACK_MESSAGE}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {flowStatus === "on_shift" && breakStartEnabled ? (
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-3 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              {t("clock.break_optional", "Break (optional)")}
            </p>
            <Button
              className="mt-2"
              disabled={!breakStartEnabled}
              onClick={handleBreakStart}
              type="button"
              variant="secondary"
            >
              {t("clock.start_break", "Start break")}
            </Button>
          </div>
        ) : null}
        {flowStatus === "on_shift" || flowStatus === "not_clocked_in" ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            {flowStatus === "on_shift"
              ? t("clock.hint_on_shift", "Clock in is not available while you are on shift.")
              : t("clock.hint_not_in", "Clock out is available after you start a shift.")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
          <Button disabled={isSubmitting || activeSelfiePhase !== null} onClick={() => void refreshStatus()} type="button" variant="secondary">
            {t("common.refresh_status", "Refresh status")}
          </Button>
        </div>

        {activeSelfiePhase ? (
          <ClockSelfieCameraOverlay
            open
            phase={activeSelfiePhase}
            onCancel={handleCancelSelfieCapture}
            onUsePhoto={handleSelfieAccepted}
            t={t}
          />
        ) : null}

        {errorMessage ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {successMessage}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
