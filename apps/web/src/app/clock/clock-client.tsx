"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { ClockSitesMap } from "../../components/maps";
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
import { haversineDistanceMeters } from "../../lib/geo";

const EMPTY_ASSIGNED_SITES: ClockAssignedSite[] = [];

type ActiveSelfiePhase = "clock_in" | "clock_out";

type GpsFailure = null | "denied" | "failed" | "unsupported";

const CAMERA_UNSUPPORTED =
  "Your browser does not support camera capture.";
const CAMERA_REQUIRED =
  "Camera permission is required to clock in or out.";

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function ClockClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [clockStatus, setClockStatus] = useState<ClockStatus | null>(null);
  const [geoCapture, setGeoCapture] = useState<GpsCapture | null>(null);
  const [selfieClockIn, setSelfieClockIn] = useState<File | null>(null);
  const [selfieClockOut, setSelfieClockOut] = useState<File | null>(null);

  const [activeSelfiePhase, setActiveSelfiePhase] = useState<ActiveSelfiePhase | null>(
    null,
  );

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

  /** Avoid re-running GPS acquisition when only the `clockStatus` object reference changes. */
  const siteCountForGps = clockStatus === null ? undefined : clockStatus.active_location_count;

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

    attachCamera();

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

  async function refreshStatus() {
    setIsRefreshing(true);
    try {
      const data = await getClockStatus();
      setClockStatus(data);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not load clock status.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

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
        setGpsPhaseText(
          capture.payload.accuracy_meters <= 100 ? "captured" : "too_low",
        );
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
  }, [siteCountForGps, gpsAcquisitionKey]);

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
          phase === "clock_in"
            ? "Clock-in selfie captured."
            : "Clock-out selfie captured.",
        );
        setActiveSelfiePhase(null);
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
      setGeoCapture(null);
      setGpsAcquisitionKey((key) => key + 1);
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock-in failed.");
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
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasOpenShift = Boolean(clockStatus?.has_open_shift);
  const noAssignedSites = Boolean(clockStatus && clockStatus.active_location_count === 0);

  const clockInEnabled =
    gpsAcceptable &&
    Boolean(selfieClockIn) &&
    !hasOpenShift &&
    !isSubmitting &&
    !gpsAcquiring &&
    activeSelfiePhase === null;

  const clockOutEnabled =
    gpsAcceptable &&
    Boolean(selfieClockOut) &&
    hasOpenShift &&
    !Boolean(clockStatus?.current_break_open) &&
    !isSubmitting &&
    !gpsAcquiring &&
    activeSelfiePhase === null;

  const takeClockInLabel = selfieClockIn ? "Retake clock-in selfie" : "Take clock-in selfie";
  const takeClockOutLabel = selfieClockOut
    ? "Retake clock-out selfie"
    : "Take clock-out selfie";

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

  return (
    <Sheet>
      <PageHeader
        title="Clock In / Out"
        description="GPS and a live camera selfie are required for each clock-in and clock-out."
      />
      <SheetBody>
        <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
          {isRefreshing ? "Loading status..." : null}
          {!isRefreshing && clockStatus
            ? `Current status: ${clockStatus.status.replace("_", " ")}`
            : null}
        </div>

        <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
          <p className="font-bold text-[var(--color-text)]">Current shift</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            {clockStatus?.has_open_shift
              ? `Open shift ID: ${clockStatus.open_shift_id}`
              : "No open shift"}
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Break status: {clockStatus?.current_break_open ? "Open break" : "No open break"}
          </p>
        </div>

        <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
          <p className="font-bold text-[var(--color-text)]">GPS</p>
          <p className="mt-1 text-[var(--color-text-muted)]">{gpsStatusLine}</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Active assigned locations: {clockStatus?.active_location_count ?? 0}
          </p>
          {geoCapture ? (
            <p className="mt-1 text-[var(--color-text-muted)]">
              GPS accuracy: {Math.round(geoCapture.payload.accuracy_meters)}m (must be ≤{" "}
              {BACKEND_MAX_ACCURACY_M}m)
            </p>
          ) : null}
          {gpsAcquiring || gpsBestAccuracy !== null ? (
            <p className="mt-1 text-[var(--color-text-muted)]">
              Best accuracy so far: {gpsBestAccuracy !== null ? `${Math.round(gpsBestAccuracy)}m` : "—"} · Samples: {gpsSamples}
            </p>
          ) : null}
          {nearestSiteSummary ? (
            <div className="mt-2 space-y-1 text-[var(--color-text-muted)]">
              <p>
                Nearest assigned site: <span className="font-semibold">{nearestSiteSummary.site.name}</span> (
                about {nearestSiteSummary.distanceM}m to center, radius{" "}
                {nearestSiteSummary.site.geofence_radius_meters}m)
              </p>
              {nearestSiteSummary.outside ? (
                <p className="text-[var(--color-danger-700)]">
                  Your position may be outside that site; the server will confirm the geofence on submit.
                </p>
              ) : null}
              {!nearestSiteSummary.outside && geoCapture && geoCapture.payload.accuracy_meters > BACKEND_MAX_ACCURACY_M ? (
                <p className="text-[var(--color-warning-700)]">
                  You appear near the site, but GPS accuracy is too low to verify securely.
                </p>
              ) : null}
            </div>
          ) : null}
          {!noAssignedSites && geoCapture && geoCapture.payload.accuracy_meters > BACKEND_MAX_ACCURACY_M ? (
            <div className="mt-2 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <p className="font-semibold text-[var(--color-text)]">GPS accuracy is too low for secure clocking.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Move near open sky or a window and retry.</li>
                <li>On mobile, enable Precise Location for your browser.</li>
                <li>Desktop/laptop GPS may be inaccurate; use mobile if possible.</li>
                <li>If you are on site but still blocked, ask an admin to use manual clock-out with a reason.</li>
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

        {geoCapture ? (
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
            <p className="font-bold text-[var(--color-text)]">Map</p>
            {(clockStatus?.assigned_sites ?? []).length === 0 ? (
              <p className="mt-1 text-[var(--color-text-muted)]">
                No assigned active locations. Your administrator must assign you to an active site before you can
                clock in at a geofence.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Blue dot: your latest GPS fix. Rings: assigned active sites (teal = nearest site center).
              </p>
            )}
            <div className="mt-2 w-full min-w-0 max-w-full">
              <ClockSitesMap
                accuracyMeters={geoCapture.payload.accuracy_meters}
                employeeLatitude={geoCapture.payload.latitude}
                employeeLongitude={geoCapture.payload.longitude}
                sites={clockStatus?.assigned_sites ?? EMPTY_ASSIGNED_SITES}
              />
            </div>
          </div>
        ) : null}

        <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
          <p className="font-bold text-[var(--color-text)]">Selfies</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Camera opens only when you take or retake a selfie. Permission is requested at that time.
          </p>

          {!hasOpenShift ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isSubmitting || activeSelfiePhase !== null}
                  onClick={() => openSelfieCapture("clock_in")}
                  type="button"
                >
                  {takeClockInLabel}
                </Button>
              </div>
              {selfieClockIn && clockInPreviewUrl ? (
                <div className="mt-2 rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Clock-in selfie preview"
                    className="mx-auto max-h-28 max-w-full object-contain"
                    src={clockInPreviewUrl}
                  />
                  <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
                    Clock-in selfie captured
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Clock-in selfie: not captured
                </p>
              )}
            </div>
          ) : null}

          {hasOpenShift ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isSubmitting || activeSelfiePhase !== null}
                  onClick={() => openSelfieCapture("clock_out")}
                  type="button"
                >
                  {takeClockOutLabel}
                </Button>
              </div>
              {selfieClockOut && clockOutPreviewUrl ? (
                <div className="mt-2 rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Clock-out selfie preview"
                    className="mx-auto max-h-28 max-w-full object-contain"
                    src={clockOutPreviewUrl}
                  />
                  <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
                    Clock-out selfie captured
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Clock-out selfie: not captured
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={!clockInEnabled} onClick={handleClockIn} type="button">
            Clock in
          </Button>
          <Button disabled={!clockOutEnabled} onClick={handleClockOut} type="button">
            Clock out
          </Button>
          <Button
            disabled={
              isSubmitting ||
              activeSelfiePhase !== null ||
              !clockStatus?.has_open_shift ||
              Boolean(clockStatus?.current_break_open)
            }
            onClick={handleBreakStart}
            type="button"
          >
            Break start
          </Button>
          <Button
            disabled={
              isSubmitting ||
              activeSelfiePhase !== null ||
              !clockStatus?.has_open_shift ||
              !Boolean(clockStatus?.current_break_open)
            }
            onClick={handleBreakEnd}
            type="button"
          >
            Break end
          </Button>
          <Button
            disabled={isSubmitting || activeSelfiePhase !== null}
            onClick={refreshStatus}
            type="button"
          >
            Refresh status
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
                    {activeSelfiePhase === "clock_in" ? "Clock-in selfie" : "Clock-out selfie"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Position your face in frame, then tap Capture.
                  </p>
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
                      Capture
                    </Button>
                    <Button onClick={handleCancelSelfieCapture} type="button">
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        {errorMessage ? (
          <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {successMessage}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
