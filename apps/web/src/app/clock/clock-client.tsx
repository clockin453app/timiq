"use client";

import { createPortal } from "react-dom";
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
import { useLiveShiftDuration } from "../../features/time-clock/shift-duration";
import { haversineDistanceMeters } from "../../lib/geo";
import { useT } from "../../lib/i18n";

const EMPTY_ASSIGNED_SITES: ClockAssignedSite[] = [];

type ActiveSelfiePhase = "clock_in" | "clock_out";

type GpsFailure = null | "denied" | "failed" | "unsupported";

type FlowStatus = ClockStatus["current_status"];

const CAMERA_UNSUPPORTED = "Your browser does not support camera capture.";
const CAMERA_REQUIRED = "Camera permission is required to clock in or out.";

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  /** unknown = before first client measure — do not mount Leaflet yet. */
  const [viewportClockMapMode, setViewportClockMapMode] = useState<"unknown" | "narrow" | "wide">(
    "unknown",
  );
  const [mapMountDeferred, setMapMountDeferred] = useState(false);
  const [clockMapSessionOff, setClockMapSessionOff] = useState(false);
  // Match server render: assume online until after mount, then sync from navigator (avoids hydration mismatch when offline).
  const [networkOnline, setNetworkOnline] = useState(true);

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
    return () => {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

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
    if (!activeSelfiePhase) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      const element = videoRef.current;
      if (element) {
        element.srcObject = null;
      }
      return;
    }

    let cancelled = false;

    async function attachCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMessage(CAMERA_UNSUPPORTED);
        setActiveSelfiePhase(null);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        streamRef.current = stream;
        const element = videoRef.current;
        if (element) {
          element.srcObject = stream;
          await element.play().catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setErrorMessage(CAMERA_REQUIRED);
        } else {
          setErrorMessage(CAMERA_REQUIRED);
        }
        setActiveSelfiePhase(null);
      }
    }

    void attachCamera();

    return () => {
      cancelled = true;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      const element = videoRef.current;
      if (element) {
        element.srcObject = null;
      }
    };
  }, [activeSelfiePhase]);

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

  function handleConfirmSelfieCapture() {
    const phase = activeSelfiePhase;
    if (!phase) {
      return;
    }

    setErrorMessage("");
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      setErrorMessage("Camera is not ready yet. Wait a moment or try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setErrorMessage("Could not capture from camera.");
      return;
    }

    context.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorMessage("Could not capture from camera.");
          return;
        }
        const file = new File([blob], `live-clock-selfie-${phase}-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        if (phase === "clock_in") {
          setSelfieClockIn(file);
        } else {
          setSelfieClockOut(file);
        }
        setSuccessMessage(
          phase === "clock_in" ? "Clock-in selfie captured." : "Clock-out selfie captured.",
        );
        setActiveSelfiePhase(null);
        void refreshStatus();
      },
      "image/jpeg",
      0.92,
    );
  }

  async function handleClockIn() {
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
      await clockInWithSelfie(geoCapture.payload, selfieClockIn);
      setSuccessMessage("Clock-in successful.");
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
      setErrorMessage("Getting a reliable GPS fix… please wait, then try again.");
      return;
    }
    if (!selfieClockOut) {
      setErrorMessage("Capture a clock-out selfie before clocking out.");
      return;
    }

    setIsSubmitting(true);
    try {
      await clockOutWithSelfie(geoCapture.payload, selfieClockOut);
      setSuccessMessage("Clock-out successful.");
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

  const currentShiftDuration = useLiveShiftDuration(
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
      return "Waiting for location…";
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
      return "Loading status…";
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
      return "Waiting for location…";
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
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-4 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
            Current status
          </p>
          {isRefreshing && !clockStatus ? (
            <p className="mt-2 text-[var(--color-text-muted)]">{t("common.loading", "Loading…")}</p>
          ) : null}
          {clockStatus ? (
            <>
              <p className="mt-2 text-xl font-semibold text-[var(--color-text)]">
                {statusCardTitle(flowStatus, t)}
              </p>
              {flowStatus === "on_shift" || flowStatus === "open_break" ? (
                <div className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                  {clockStatus.open_shift_location_name ? (
                    <p>
                      Site:{" "}
                      <span className="font-medium text-[var(--color-text)]">
                        {clockStatus.open_shift_location_name}
                      </span>
                    </p>
                  ) : null}
                  {clockStatus.open_shift_clock_in_at && currentShiftDuration ? (
                    <p>
                      Time on shift:{" "}
                      <span className="font-mono font-medium text-[var(--color-text)]">
                        {currentShiftDuration}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {flowStatus === "completed_today" ? (
                <p className="mt-2 text-[var(--color-text-muted)]">
                  A second shift today is not allowed by current policy.
                </p>
              ) : null}
              {flowStatus === "no_assigned_sites" ? (
                <p className="mt-2 text-[var(--color-text-muted)]">
                  Ask your administrator to assign you to an active site before you can clock in.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {clockStatus && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-4 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Requirements
            </p>
            <ul className="mt-3 space-y-2 text-[var(--color-text)]">
              <li className="flex flex-wrap items-start justify-between gap-2">
                <span>Location access</span>
                <span className={locationOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}>
                  {gpsFailure === "denied" ? "Permission needed" : locationOk ? "OK" : "—"}
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
                <span>GPS accuracy (≤{BACKEND_MAX_ACCURACY_M}m)</span>
                <span className={gpsAccuracyOk ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}>
                  {gpsAccuracyOk ? "OK" : gpsAcquiring ? "Improving…" : geoCapture ? "Too low" : "—"}
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
              {flowStatus === "open_break" ? (
                <li className="flex flex-wrap items-start justify-between gap-2">
                  <span>{t("clock.action_break", "Break")}</span>
                  <span className="text-[var(--color-warning-700)]">
                    {t("clock.req_break_end_before_out", "End break before clock out")}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-header)] p-3 text-sm break-words">
          <p className="font-bold text-[var(--color-text)]">GPS</p>
          <p className="mt-1 break-words text-[var(--color-text-muted)]">{gpsStatusLine}</p>
          <p className="mt-1 break-words text-[var(--color-text-muted)]">
            Active assigned locations: {clockStatus?.active_location_count ?? 0}
          </p>
          {geoCapture ? (
            <p className="mt-1 text-[var(--color-text-muted)]">
              GPS accuracy: {Math.round(geoCapture.payload.accuracy_meters)}m (must be ≤ {BACKEND_MAX_ACCURACY_M}m)
            </p>
          ) : null}
          {gpsAcquiring || gpsBestAccuracy !== null ? (
            <p className="mt-1 text-[var(--color-text-muted)]">
              Best accuracy so far: {gpsBestAccuracy !== null ? `${Math.round(gpsBestAccuracy)}m` : "—"} · Samples:{" "}
              {gpsSamples}
            </p>
          ) : null}
          {nearestSiteSummary ? (
            <div className="mt-2 space-y-1 break-words text-[var(--color-text-muted)]">
              <p className="break-words">
                Nearest assigned site: <span className="font-semibold">{nearestSiteSummary.site.name}</span> (
                about {nearestSiteSummary.distanceM}m to center, radius{" "}
                {nearestSiteSummary.site.geofence_radius_meters}m)
              </p>
              {nearestSiteSummary.outside ? (
                <p className="text-[var(--color-danger-700)]">
                  Your position may be outside that site; the server will confirm the geofence on submit.
                </p>
              ) : null}
            </div>
          ) : null}
          {!noAssignedSites && geoCapture && geoCapture.payload.accuracy_meters > BACKEND_MAX_ACCURACY_M ? (
            <div className="mt-2 border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <p className="font-semibold text-[var(--color-text)]">GPS accuracy is too low for secure clocking.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Move near open sky or a window and retry.</li>
                <li>On mobile, enable Precise Location for your browser.</li>
              </ul>
            </div>
          ) : null}
          {showGpsRetry ? (
            <div className="mt-2">
              <Button
                disabled={gpsAcquiring || isSubmitting || activeSelfiePhase !== null}
                onClick={handleRetryGps}
                type="button"
                variant="secondary"
              >
                Retry location
              </Button>
            </div>
          ) : null}
        </div>

        {geoCapture && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
          <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
            <p className="font-bold text-[var(--color-text)]">Map</p>
            {(clockStatus?.assigned_sites ?? []).length === 0 ? (
              <p className="mt-1 text-[var(--color-text-muted)]">No map data.</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Supporting view only — GPS validation still runs on the server.
              </p>
            )}
            <div className="mt-2 w-full min-w-0 max-w-full overflow-x-hidden">
              {viewportClockMapMode === "narrow" ? (
                <div className="flex min-h-[120px] w-full flex-col justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                  <p>{CLOCK_MAP_FALLBACK_MESSAGE}</p>
                  <p className="mt-2 text-xs">
                    Live map is omitted on small screens for stability. Your GPS and nearest site
                    details stay in the section above.
                  </p>
                </div>
              ) : clockMapSessionOff ? (
                <div className="flex min-h-[120px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                  {CLOCK_MAP_FALLBACK_MESSAGE}
                </div>
              ) : !mapMountDeferred ? (
                <div className="flex min-h-[80px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">
                  {isSubmitting || isRefreshing
                    ? "Map paused while the clock status updates…"
                    : "Preparing map…"}
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

        {clockStatus && flowStatus !== "completed_today" && flowStatus !== "no_assigned_sites" ? (
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-4 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              {flowStatus === "not_clocked_in"
                ? t("clock.action_clock_in", "Clock in")
                : flowStatus === "open_break"
                  ? t("clock.action_break", "Break")
                  : t("clock.action_clock_out", "Clock out")}
            </p>

            {flowStatus === "not_clocked_in" ? (
              <div className="mt-3 space-y-4">
                <p className="text-xs text-[var(--color-text-muted)]">{t("clock.step_clock_in_intro")}</p>
                <Button
                  className="w-full min-h-[3rem] text-base sm:w-auto"
                  disabled={isSubmitting || activeSelfiePhase !== null}
                  onClick={() => openSelfieCapture("clock_in")}
                  type="button"
                >
                  {selfieClockIn ? t("clock.retake_selfie_in") : t("clock.take_selfie_in")}
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
                <div className="space-y-2">
                  <Button
                    className="w-full min-h-[3rem] text-base"
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
              </div>
            ) : null}

            {flowStatus === "open_break" ? (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-[var(--color-text-muted)]">{t("clock.end_break_before_out_hint")}</p>
                <Button
                  className="w-full min-h-[3rem] text-base"
                  disabled={!breakEndEnabled}
                  onClick={handleBreakEnd}
                  type="button"
                >
                  {t("clock.end_break", "End break")}
                </Button>
                {!breakEndEnabled && isSubmitting ? (
                  <p className="text-xs text-[var(--color-text-muted)]">{t("clock.working", "Working…")}</p>
                ) : null}
              </div>
            ) : null}

            {flowStatus === "on_shift" ? (
              <div className="mt-3 space-y-4">
                <Button
                  className="w-full min-h-[3rem] text-base sm:w-auto"
                  disabled={isSubmitting || activeSelfiePhase !== null}
                  onClick={() => openSelfieCapture("clock_out")}
                  type="button"
                >
                  {selfieClockOut ? t("clock.retake_selfie_out") : t("clock.take_selfie_out")}
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
                <div className="space-y-2">
                  <Button
                    className="w-full min-h-[3rem] text-base"
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
                {breakStartEnabled ? (
                  <Button disabled={!breakStartEnabled} onClick={handleBreakStart} type="button" variant="secondary">
                    {t("clock.start_break", "Start break")}
                  </Button>
                ) : null}
              </div>
            ) : null}
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

        {typeof document !== "undefined" && activeSelfiePhase
          ? createPortal(
              <div
                aria-modal="true"
                className="fixed inset-0 z-[2000] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3"
                role="dialog"
              >
                <div className="mx-auto w-full max-w-[min(24rem,calc(100vw-1.5rem))] min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-md">
                  <p className="text-sm font-bold text-[var(--color-text)]">
                    {activeSelfiePhase === "clock_in"
                      ? t("clock.dialog_title_in", "Clock-in selfie")
                      : t("clock.dialog_title_out", "Clock-out selfie")}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("clock.dialog_hint")}</p>
                  <div className="mt-2 overflow-hidden rounded border border-[var(--color-border-dark)] bg-black">
                    <video
                      ref={videoRef}
                      autoPlay
                      className="aspect-video max-h-44 w-full object-cover"
                      muted
                      playsInline
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={handleConfirmSelfieCapture} type="button">
                      {t("clock.capture", "Capture")}
                    </Button>
                    <Button onClick={handleCancelSelfieCapture} type="button" variant="secondary">
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

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
