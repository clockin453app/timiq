"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ClockSitesMap } from "../../components/maps";
import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  breakEnd,
  breakStart,
  clockInWithSelfie,
  clockOutWithSelfie,
  getClockStatus,
  isGpsCaptureStale,
  type ClockAssignedSite,
  type ClockStatus,
  type GeolocationRequest,
} from "../../features/time-clock/api";

const EMPTY_ASSIGNED_SITES: ClockAssignedSite[] = [];

type GeoCapture = {
  payload: GeolocationRequest;
  capturedAtMs: number;
};

type ActiveSelfiePhase = "clock_in" | "clock_out";

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
  const [geoCapture, setGeoCapture] = useState<GeoCapture | null>(null);
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

  const gpsStale = useMemo(
    () => (geoCapture ? isGpsCaptureStale(geoCapture.capturedAtMs) : false),
    [geoCapture],
  );

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

  function captureGpsPosition(): Promise<GeoCapture> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported in this browser."));
        return;
      }

      const capturedAtMs = Date.now();

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            capturedAtMs,
            payload: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy_meters: position.coords.accuracy,
              timestamp_utc: new Date(capturedAtMs).toISOString(),
            },
          });
        },
        () => reject(new Error("Unable to capture GPS location.")),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        },
      );
    });
  }

  async function handleCaptureGps() {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const capture = await captureGpsPosition();
      setGeoCapture(capture);
      setSuccessMessage("GPS captured.");
      await refreshStatus();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to capture GPS location.",
      );
    }
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
    if (!geoCapture) {
      setErrorMessage("Capture GPS before clocking in.");
      return;
    }
    if (gpsStale) {
      setErrorMessage("GPS data is stale. Capture GPS again.");
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
    if (!geoCapture) {
      setErrorMessage("Capture GPS before clocking out.");
      return;
    }
    if (gpsStale) {
      setErrorMessage("GPS data is stale. Capture GPS again.");
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
  const clockInEnabled =
    Boolean(geoCapture && selfieClockIn && !gpsStale) &&
    !hasOpenShift &&
    !isSubmitting &&
    activeSelfiePhase === null;
  const clockOutEnabled =
    Boolean(geoCapture && selfieClockOut && !gpsStale) &&
    hasOpenShift &&
    !Boolean(clockStatus?.current_break_open) &&
    !isSubmitting &&
    activeSelfiePhase === null;

  const takeClockInLabel = selfieClockIn ? "Retake clock-in selfie" : "Take clock-in selfie";
  const takeClockOutLabel = selfieClockOut
    ? "Retake clock-out selfie"
    : "Take clock-out selfie";

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
          <p className="mt-1 text-[var(--color-text-muted)]">
            Active assigned locations: {clockStatus?.active_location_count ?? 0}
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            GPS captured: {geoCapture ? "Yes" : "No"}
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            GPS freshness:{" "}
            {geoCapture ? (gpsStale ? "Stale — capture again" : "OK") : "Not captured"}
          </p>
          <div className="mt-2">
            <Button disabled={isSubmitting || activeSelfiePhase !== null} onClick={handleCaptureGps} type="button">
              Capture GPS
            </Button>
          </div>
        </div>

        {geoCapture ? (
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
            <p className="font-bold text-[var(--color-text)]">Map</p>
            {(clockStatus?.assigned_sites ?? []).length === 0 ? (
              <p className="mt-1 text-[var(--color-text-muted)]">
                No assigned active locations. Your administrator must assign you to an active site before you can clock in at a geofence.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Blue dot: your captured GPS. Rings: assigned active sites (teal = nearest site center).
              </p>
            )}
            <div className="mt-2">
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

        {activeSelfiePhase ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3"
            role="dialog"
          >
            <div className="w-full max-w-sm rounded border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-md">
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
          </div>
        ) : null}

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
