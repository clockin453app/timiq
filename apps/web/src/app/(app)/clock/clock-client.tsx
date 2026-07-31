"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Sheet, SheetBody } from "@/components/ui";
import {
  ClockLocationSummary,
  ClockMapGpsDetails,
  type LocationBadge,
} from "@/features/time-clock/clock-location-panel";
import {
  breakEnd,
  breakStart,
  clockInWithSelfie,
  clockOutWithSelfie,
  getClockStatus,
  type ClockAssignedSite,
  type ClockStatus,
} from "@/features/time-clock/api";
import { writeClockOutSummary } from "@/features/time-clock/clock-out-summary";
import { fetchAuthoritativeTodayWorkedSeconds } from "@/features/time-clock/fetch-today-worked-seconds";
import {
  BACKEND_MAX_ACCURACY_M,
  type GpsCapture,
  type GpsStabilizationUpdate,
  isGpsClientSubmittable,
  stabilizeGpsFix,
} from "@/features/time-clock/gps";
import { ClockSelfieCameraOverlay } from "@/features/time-clock/clock-selfie-camera-overlay";
import { useLiveShiftDurationParts } from "@/features/time-clock/shift-duration";
import { cn } from "@/lib/cn";
import { uiClasses } from "@/lib/ui-classes";
import { haversineDistanceMeters } from "@/lib/geo";
import { isEmployee, useCurrentUser } from "@/features/auth";
import { userHasLimitedAccess } from "@/features/auth/limited-access";
import { getMyEmployeeProfile } from "@/features/employee-profiles/api";
import { asFaceCheckStatus, faceCheckAfterClockMessage } from "@/features/face-check/labels";
import { useT } from "@/lib/i18n";

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

function formatShiftClockInTime(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const CLOCK_ACTION_ENABLED =
  "border-[var(--color-success-700)] bg-[var(--color-success-700)] text-white hover:border-[#066649] hover:bg-[#066649]";
const CLOCK_OUT_ENABLED =
  "border-[var(--color-danger-700)] bg-[var(--color-danger-700)] text-white hover:border-[#7f1d1d] hover:bg-[#7f1d1d]";
const CLOCK_ACTION_DISABLED =
  "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)] hover:border-[var(--color-border-dark)] hover:bg-[var(--color-header)] disabled:opacity-100";

const CAPTURE_SELFIE_CAMERA_ICON = "/icons/clock/capture-selfie-camera.svg";

export function ClockClient() {
  const t = useT();
  const router = useRouter();
  const user = useCurrentUser();
  const clockInConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const clockOutConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const redirectingRef = useRef(false);

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

  /** unknown = before first client measure - do not mount Leaflet yet. */
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
    if (clockMapSessionOff || !mapFlowOk || !stableGeoMapKey) {
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
    if (isSubmitting || redirectingRef.current) {
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    if (!geoCapture || !isGpsClientSubmittable(geoCapture)) {
      setGpsAcquisitionKey((key) => key + 1);
      setErrorMessage("Getting a reliable GPS fix… please wait, then try again.");
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
      redirectingRef.current = true;
      router.replace("/dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock-in failed.");
      void refreshStatus();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClockOut() {
    if (isSubmitting || redirectingRef.current) {
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    if (!geoCapture || !isGpsClientSubmittable(geoCapture)) {
      setGpsAcquisitionKey((key) => key + 1);
      setErrorMessage("Getting a reliable GPS fix… please wait, then try again.");
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

      const clockedOutAt = new Date().toISOString();
      const totalWorkedSecondsToday = await fetchAuthoritativeTodayWorkedSeconds();

      if (
        totalWorkedSecondsToday !== null &&
        Number.isFinite(totalWorkedSecondsToday) &&
        totalWorkedSecondsToday >= 0
      ) {
        writeClockOutSummary({
          totalWorkedSecondsToday,
          clockedOutAt,
          createdAt: Date.now(),
        });
      }

      redirectingRef.current = true;
      router.replace("/dashboard");
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
      return "Loading status…";
    }
    if (!canClockInServer) {
      return (
        clockStatus.clock_in_blocked_reason ??
        "You cannot clock in right now."
      );
    }
    if (gpsFailure === "denied") {
      return t("clock.location_access_required", "Location access required");
    }
    if (gpsFailure === "unsupported") {
      return "Geolocation is not supported in this browser.";
    }
    if (gpsFailure === "failed") {
      return t("clock.location_access_required", "Location access required");
    }
    if (gpsAcquiring && !gpsAcceptable) {
      return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
    }
    if (!gpsAcceptable) {
      if (geoCapture) {
        return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
      }
      return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
    }
    if (nearestSiteSummary?.outside) {
      return t(
        "clock.readiness_move_within_radius",
        "Move within the allowed site radius",
      );
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
    t,
  ]);

  const clockOutDisabledReason = useMemo(() => {
    if (!clockStatus) {
      return "Loading status…";
    }
    if (!canClockOutServer) {
      return (
        clockStatus.clock_out_blocked_reason ??
        "You cannot clock out right now."
      );
    }
    if (gpsFailure === "denied") {
      return t("clock.location_access_required", "Location access required");
    }
    if (gpsFailure === "unsupported") {
      return "Geolocation is not supported in this browser.";
    }
    if (gpsFailure === "failed") {
      return t("clock.location_access_required", "Location access required");
    }
    if (gpsAcquiring && !gpsAcceptable) {
      return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
    }
    if (!gpsAcceptable) {
      if (geoCapture) {
        return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
      }
      return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
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
    t,
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
    gpsStatusLine = "Searching for location…";
  } else if (gpsAcquiring && gpsPhaseText === "improving") {
    gpsStatusLine = "Improving GPS accuracy…";
  } else if (gpsAcceptable) {
    gpsStatusLine = "Location captured.";
  } else if (geoCapture && !gpsAcquiring) {
    gpsStatusLine = "GPS accuracy too low for secure clocking.";
  } else {
    gpsStatusLine = "Preparing location…";
  }

  const locationOk = !noAssignedSites && gpsFailure !== "denied" && gpsFailure !== "unsupported";
  const assignedSitesFound = Boolean(clockStatus && clockStatus.active_location_count > 0);
  const gpsAccuracyOk = gpsAcceptable;
  const clockInSelfieOk = Boolean(selfieClockIn);
  const clockOutSelfieOk = Boolean(selfieClockOut);

  const locationBadge: LocationBadge = (() => {
    if (gpsFailure === "denied" || gpsFailure === "failed" || gpsFailure === "unsupported") {
      return "unavailable";
    }
    if (gpsAcquiring || gpsPhaseText === "improving" || gpsPhaseText === "searching") {
      return "improving";
    }
    if (!geoCapture) {
      return "preparing";
    }
    if (!gpsAcceptable) {
      return "improving";
    }
    if (nearestSiteSummary?.outside) {
      return "outside";
    }
    if (nearestSiteSummary) {
      return "inside";
    }
    return gpsAcceptable ? "inside" : "preparing";
  })();

  const shiftStartedLabel = formatShiftClockInTime(clockStatus?.open_shift_clock_in_at);

  const actionReadinessLine = (() => {
    if (flowStatus === "on_shift" || flowStatus === "open_break") {
      if (shiftStartedLabel) {
        return t("clock.readiness_shift_started", "Shift started at {{time}}", {
          time: shiftStartedLabel,
        });
      }
      return t("clock.status_on_shift", "On shift");
    }
    if (!selfieClockIn) {
      return t("clock.readiness_selfie_required", "Selfie required before clocking in");
    }
    if (gpsAcquiring || !gpsAcceptable) {
      return t("clock.readiness_waiting_gps", "Waiting for accurate GPS");
    }
    if (nearestSiteSummary?.outside) {
      return t("clock.readiness_move_within", "Move within {{meters}} m of the site", {
        meters: nearestSiteSummary.site.geofence_radius_meters,
      });
    }
    if (clockInEnabled) {
      return t("clock.readiness_ready_in", "Ready to clock in");
    }
    return clockInDisabledReason;
  })();

  const sharedLocationProps = {
    clockStatus,
    flowStatus,
    geoCapture,
    gpsStatusLine,
    showGpsRetry,
    gpsAcquiring,
    gpsFailure,
    locationBadge,
    isSubmitting,
    isRefreshing,
    selfieCaptureActive: activeSelfiePhase !== null,
    nearestSiteSummary,
    onRetryGps: handleRetryGps,
    t,
  };

  return (
    <Sheet>
      <h1 className="sr-only">{t("nav.clock", "Clock In / Out")}</h1>
      <SheetBody className="timiq-mobile-form-pad min-w-0 space-y-2.5 overflow-x-hidden px-3 pb-[max(1.5rem,calc(var(--layout-mobile-bottom-nav-height)+var(--layout-mobile-keyboard-pad)))] pt-3 sm:space-y-3 sm:px-5 sm:pb-8 sm:pt-4 xl:pb-6">
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
          <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading", "Loading…")}</p>
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

        <div className="min-w-0 space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
          <div className="min-w-0 space-y-2.5 lg:order-1">
            <ClockLocationSummary {...sharedLocationProps} />
          </div>

          {clockStatus && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
            <div
              className={cn(
                "min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2.5 shadow-[var(--shadow-xs)] sm:p-3",
                "sticky z-20 lg:order-2 lg:static lg:z-auto",
                "bottom-[calc(var(--layout-mobile-bottom-nav-height)+0.5rem)] lg:bottom-auto",
              )}
              data-testid="clock-primary-actions"
            >
              <div aria-live="polite" className="sr-only">
                {actionReadinessLine}
              </div>

              {(flowStatus === "on_shift" || flowStatus === "open_break") &&
              (shiftStartedLabel || clockStatus.open_shift_clock_in_at) ? (
                <p
                  className="mb-2 text-[13px] leading-snug text-[var(--color-text)]"
                  data-testid="clock-active-shift-summary"
                >
                  {shiftStartedLabel ? (
                    <span className="font-medium">
                      {t("clock.readiness_shift_started", "Shift started at {{time}}", {
                        time: shiftStartedLabel,
                      })}
                    </span>
                  ) : null}
                  {shiftStartedLabel && clockStatus.open_shift_clock_in_at ? (
                    <span className="text-[var(--color-text-muted)]"> · </span>
                  ) : null}
                  {clockStatus.open_shift_clock_in_at ? (
                    <span>
                      <span className="text-[var(--color-text-muted)]">
                        {t("clock.duration_label", "Duration")}{" "}
                      </span>
                      <span
                        className="font-mono font-semibold tabular-nums text-[var(--color-text)]"
                        suppressHydrationWarning
                      >
                        {currentShiftDurationParts.hms || currentShiftDurationParts.compact || "—"}
                      </span>
                      {flowStatus === "open_break" ? (
                        <span className="text-[var(--color-warning-700)]">
                          {" "}
                          · {t("clock.on_break", "On break")}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {flowStatus === "not_clocked_in" ? (
                <div className="space-y-3" data-clock-mode="clock-in">
                  {!selfieClockIn || activeSelfiePhase === "clock_in" ? (
                    <>
                      <button
                        aria-label={t(
                          "clock.capture_selfie_to_clock_in",
                          "Capture selfie to clock in",
                        )}
                        className={cn(
                          "flex w-full min-h-[8.5rem] flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-[#93C5FD] bg-[#EFF6FF] px-4 py-5 text-center",
                          "hover:bg-[#DBEAFE]",
                          uiClasses.focusRing,
                          "focus-visible:ring-2 focus-visible:ring-[var(--color-brand-blue-600)] focus-visible:ring-offset-2",
                        )}
                        data-testid="clock-capture-selfie"
                        disabled={isSubmitting || activeSelfiePhase !== null}
                        onClick={() => openSelfieCapture("clock_in")}
                        type="button"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt=""
                          aria-hidden="true"
                          className="h-[5rem] w-[5rem] object-contain"
                          height={80}
                          src={CAPTURE_SELFIE_CAMERA_ICON}
                          width={80}
                        />
                        <span className="text-[15px] font-semibold text-[var(--color-brand-navy)] sm:text-[16px]">
                          {t("clock.capture_selfie_to_clock_in", "Capture selfie to clock in")}
                        </span>
                        <span className="text-[13px] text-[var(--color-text-muted)]">
                          {t(
                            "clock.capture_selfie_support",
                            "Use your live camera to continue",
                          )}
                        </span>
                      </button>
                      {gpsFailure === "denied" ||
                      gpsFailure === "failed" ||
                      gpsFailure === "unsupported" ||
                      gpsAcquiring ||
                      !gpsAcceptable ||
                      nearestSiteSummary?.outside ? (
                        <p
                          className="text-[13px] font-medium leading-snug text-[var(--color-text)]"
                          data-testid="clock-action-readiness"
                          id="clock-in-readiness"
                        >
                          {gpsFailure === "denied" ||
                          gpsFailure === "failed" ||
                          gpsFailure === "unsupported"
                            ? t("clock.location_access_required", "Location access required")
                            : gpsAcquiring || !gpsAcceptable
                              ? t("clock.readiness_waiting_gps", "Waiting for accurate GPS")
                              : t(
                                  "clock.readiness_move_within",
                                  "Move within {{meters}} m of the site",
                                  {
                                    meters: nearestSiteSummary!.site.geofence_radius_meters,
                                  },
                                )}
                        </p>
                      ) : (
                        <p className="sr-only" id="clock-in-readiness">
                          {t("clock.capture_selfie_to_clock_in", "Capture selfie to clock in")}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
                        {clockInPreviewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={t("clock.alt_selfie_in", "Clock-in selfie preview")}
                            className="mx-auto max-h-28 max-w-full object-contain"
                            src={clockInPreviewUrl}
                          />
                        ) : null}
                        <p className="text-center text-[14px] font-semibold text-[var(--color-text)]">
                          {t("clock.selfie_captured", "Selfie captured")}
                        </p>
                        <Button
                          className="w-full"
                          data-testid="clock-retake-selfie"
                          disabled={isSubmitting || activeSelfiePhase !== null}
                          onClick={() => openSelfieCapture("clock_in")}
                          type="button"
                          variant="secondary"
                        >
                          {t("clock.retake_selfie", "Retake selfie")}
                        </Button>
                      </div>
                      <Button
                        ref={clockInConfirmButtonRef}
                        aria-describedby={
                          !clockInEnabled && clockInDisabledReason
                            ? "clock-in-disabled-reason"
                            : "clock-in-readiness"
                        }
                        className={cn(
                          "min-h-[3.15rem] w-full text-[15px] font-semibold",
                          clockInEnabled ? CLOCK_ACTION_ENABLED : CLOCK_ACTION_DISABLED,
                          clockInEnabled &&
                            "ring-2 ring-[var(--color-success-700)] ring-offset-2 ring-offset-[var(--color-cell)]",
                        )}
                        data-clock-action="clock-in"
                        data-clock-enabled={clockInEnabled ? "true" : "false"}
                        data-testid="clock-in-button"
                        disabled={!clockInEnabled}
                        onClick={handleClockIn}
                        type="button"
                        variant="secondary"
                      >
                        {t("clock.action_clock_in", "Clock in")}
                      </Button>
                      <p
                        className="sr-only"
                        data-testid="clock-action-readiness"
                        id="clock-in-readiness"
                      >
                        {actionReadinessLine}
                      </p>
                      {!clockInEnabled && clockInDisabledReason ? (
                        <p
                          className="text-[12px] text-[var(--color-text-muted)]"
                          id="clock-in-disabled-reason"
                        >
                          {clockInDisabledReason}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {flowStatus === "open_break" ? (
                <div className="space-y-3">
                  <p className="text-[13px] font-medium text-[var(--color-text)]">
                    {t("clock.primary_end_break", "End break to clock out")}
                  </p>
                  <Button
                    className="min-h-[3rem] w-full text-[15px]"
                    disabled={!breakEndEnabled}
                    onClick={handleBreakEnd}
                    type="button"
                  >
                    {t("clock.end_break", "End break")}
                  </Button>
                </div>
              ) : null}

              {flowStatus === "on_shift" ? (
                <div className="space-y-3" data-clock-mode="clock-out">
                  {!selfieClockOut || activeSelfiePhase === "clock_out" ? (
                    <>
                      <button
                        aria-label={t(
                          "clock.capture_selfie_to_clock_out",
                          "Capture selfie to clock out",
                        )}
                        className={cn(
                          "flex w-full min-h-[8.5rem] flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-[#93C5FD] bg-[#EFF6FF] px-4 py-5 text-center",
                          "hover:bg-[#DBEAFE]",
                          uiClasses.focusRing,
                          "focus-visible:ring-2 focus-visible:ring-[var(--color-brand-blue-600)] focus-visible:ring-offset-2",
                        )}
                        data-testid="clock-capture-selfie"
                        disabled={isSubmitting || activeSelfiePhase !== null}
                        onClick={() => openSelfieCapture("clock_out")}
                        type="button"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt=""
                          aria-hidden="true"
                          className="h-[5rem] w-[5rem] object-contain"
                          height={80}
                          src={CAPTURE_SELFIE_CAMERA_ICON}
                          width={80}
                        />
                        <span className="text-[15px] font-semibold text-[var(--color-brand-navy)] sm:text-[16px]">
                          {t("clock.capture_selfie_to_clock_out", "Capture selfie to clock out")}
                        </span>
                        <span className="text-[13px] text-[var(--color-text-muted)]">
                          {t(
                            "clock.capture_selfie_support",
                            "Use your live camera to continue",
                          )}
                        </span>
                      </button>
                      {gpsFailure === "denied" ||
                      gpsFailure === "failed" ||
                      gpsFailure === "unsupported" ||
                      gpsAcquiring ||
                      !gpsAcceptable ? (
                        <p
                          className="text-[13px] font-medium leading-snug text-[var(--color-text)]"
                          data-testid="clock-action-readiness"
                          id="clock-out-readiness"
                        >
                          {gpsFailure === "denied" ||
                          gpsFailure === "failed" ||
                          gpsFailure === "unsupported"
                            ? t("clock.location_access_required", "Location access required")
                            : t("clock.readiness_waiting_gps", "Waiting for accurate GPS")}
                        </p>
                      ) : (
                        <p className="sr-only" id="clock-out-readiness">
                          {t("clock.capture_selfie_to_clock_out", "Capture selfie to clock out")}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
                        {clockOutPreviewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={t("clock.alt_selfie_out", "Clock-out selfie preview")}
                            className="mx-auto max-h-28 max-w-full object-contain"
                            src={clockOutPreviewUrl}
                          />
                        ) : null}
                        <p className="text-center text-[14px] font-semibold text-[var(--color-text)]">
                          {t("clock.selfie_captured", "Selfie captured")}
                        </p>
                        <Button
                          className="w-full"
                          data-testid="clock-retake-selfie"
                          disabled={isSubmitting || activeSelfiePhase !== null}
                          onClick={() => openSelfieCapture("clock_out")}
                          type="button"
                          variant="secondary"
                        >
                          {t("clock.retake_selfie", "Retake selfie")}
                        </Button>
                      </div>
                      <Button
                        ref={clockOutConfirmButtonRef}
                        aria-describedby={
                          !clockOutEnabled && clockOutDisabledReason
                            ? "clock-out-disabled-reason"
                            : "clock-out-readiness"
                        }
                        className={cn(
                          "min-h-[3.15rem] w-full text-[15px] font-semibold",
                          clockOutEnabled ? CLOCK_OUT_ENABLED : CLOCK_ACTION_DISABLED,
                          clockOutEnabled &&
                            "ring-2 ring-[var(--color-danger-700)] ring-offset-2 ring-offset-[var(--color-cell)]",
                        )}
                        data-clock-action="clock-out"
                        data-clock-enabled={clockOutEnabled ? "true" : "false"}
                        data-testid="clock-out-button"
                        disabled={!clockOutEnabled}
                        onClick={handleClockOut}
                        type="button"
                        variant="secondary"
                      >
                        {t("clock.action_clock_out", "Clock out")}
                      </Button>
                      <p
                        className="sr-only"
                        data-testid="clock-action-readiness"
                        id="clock-out-readiness"
                      >
                        {clockOutEnabled
                          ? t("clock.confirm_selfie_out", "Selfie captured. Confirm clock out.")
                          : clockOutDisabledReason}
                      </p>
                      {!clockOutEnabled && clockOutDisabledReason ? (
                        <p
                          className="text-[12px] text-[var(--color-text-muted)]"
                          id="clock-out-disabled-reason"
                        >
                          {clockOutDisabledReason}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {errorMessage ? (
                <div
                  className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]"
                  role="alert"
                >
                  {errorMessage}
                </div>
              ) : null}
              {successMessage ? (
                <div
                  className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm"
                  role="status"
                >
                  {successMessage}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="min-w-0 space-y-3 lg:col-span-2 lg:order-3">
            <ClockMapGpsDetails
              {...sharedLocationProps}
              assignedSites={clockStatus?.assigned_sites ?? EMPTY_ASSIGNED_SITES}
              clockMapSessionOff={clockMapSessionOff}
              mapMountDeferred={mapMountDeferred}
              onMapFault={handleClockMapFault}
              viewportClockMapMode={viewportClockMapMode}
            />

            <details className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] text-sm" data-testid="clock-help-checklist">
              <summary className="cursor-pointer px-3 py-2.5 font-medium text-[var(--color-text)]">
                {t("clock.help_and_checklist", "Help and checklist")}
              </summary>
              <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3">
                <ul className="space-y-2 text-[var(--color-text)]">
                  <li className="flex flex-wrap items-start justify-between gap-2">
                    <span>{t("clock.check_location_access", "Location access")}</span>
                    <span
                      className={
                        locationOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"
                      }
                    >
                      {gpsFailure === "denied"
                        ? t("clock.permission_needed", "Permission needed")
                        : locationOk
                          ? "OK"
                          : "—"}
                    </span>
                  </li>
                  <li className="flex flex-wrap items-start justify-between gap-2">
                    <span>{t("clock.check_assigned_site", "Assigned site")}</span>
                    <span
                      className={
                        assignedSitesFound
                          ? "text-[var(--color-success-700)]"
                          : "text-[var(--color-text-muted)]"
                      }
                    >
                      {assignedSitesFound ? t("clock.req_found", "Found") : t("clock.req_none", "None")}
                    </span>
                  </li>
                  <li className="flex flex-wrap items-start justify-between gap-2">
                    <span>
                      {t("clock.gps_accuracy_within", "GPS accuracy (≤{{meters}}m)", {
                        meters: BACKEND_MAX_ACCURACY_M,
                      })}
                    </span>
                    <span
                      className={
                        gpsAccuracyOk
                          ? "text-[var(--color-success-700)]"
                          : "text-[var(--color-text-muted)]"
                      }
                    >
                      {gpsAccuracyOk
                        ? "OK"
                        : gpsAcquiring
                          ? t("clock.improving_short", "Improving…")
                          : geoCapture
                            ? t("clock.too_low", "Too low")
                            : "—"}
                    </span>
                  </li>
                  {flowStatus === "not_clocked_in" ? (
                    <li className="flex flex-wrap items-start justify-between gap-2">
                      <span>{t("clock.req_clock_in_selfie", "Clock-in selfie")}</span>
                      <span
                        className={
                          clockInSelfieOk
                            ? "text-[var(--color-success-700)]"
                            : "text-[var(--color-text-muted)]"
                        }
                      >
                        {clockInSelfieOk
                          ? t("clock.req_captured", "Captured")
                          : t("clock.req_needed", "Needed")}
                      </span>
                    </li>
                  ) : null}
                  {(flowStatus === "on_shift" || flowStatus === "open_break") && canClockOutServer ? (
                    <li className="flex flex-wrap items-start justify-between gap-2">
                      <span>{t("clock.req_clock_out_selfie", "Clock-out selfie")}</span>
                      <span
                        className={
                          clockOutSelfieOk
                            ? "text-[var(--color-success-700)]"
                            : "text-[var(--color-text-muted)]"
                        }
                      >
                        {clockOutSelfieOk
                          ? t("clock.req_captured", "Captured")
                          : t("clock.req_needed", "Needed")}
                      </span>
                    </li>
                  ) : null}
                </ul>
                {gpsAcquiring || gpsBestAccuracy !== null ? (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {t("clock.best_accuracy_samples", "Best accuracy")}:{" "}
                    {gpsBestAccuracy !== null ? `${Math.round(gpsBestAccuracy)}m` : "—"} ·{" "}
                    {t("clock.samples", "Samples")}: {gpsSamples}
                  </p>
                ) : null}
                {gpsFailure === "denied" ? (
                  <p className="text-[13px] text-[var(--color-text)]">
                    {t(
                      "clock.help_denied_detail",
                      "Open your browser site settings, allow Location for TimIQ, reload the page, then tap Refresh GPS.",
                    )}
                  </p>
                ) : null}
              </div>
            </details>

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

            <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
              <Button
                disabled={isSubmitting || activeSelfiePhase !== null}
                onClick={() => void refreshStatus()}
                type="button"
                variant="secondary"
              >
                {t("common.refresh_status", "Refresh status")}
              </Button>
            </div>
          </div>
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
      </SheetBody>
    </Sheet>
  );
}
