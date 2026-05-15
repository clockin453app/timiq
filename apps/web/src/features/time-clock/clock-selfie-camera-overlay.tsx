"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "../../components/ui";

export type ClockSelfiePhase = "clock_in" | "clock_out";

type TranslateFn = (key: string, fallback?: string) => string;

type Props = {
  phase: ClockSelfiePhase;
  open: boolean;
  onCancel: () => void;
  onUsePhoto: (file: File, phase: ClockSelfiePhase) => void;
  t: TranslateFn;
};

const CAMERA_UNSUPPORTED =
  "Your device does not support camera capture. Use a phone or browser with a front camera.";
const CAMERA_PERMISSION =
  "Camera permission is required to capture a selfie. Allow camera access in your browser settings, then tap Retry.";

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function ClockSelfieCameraOverlay({ phase, open, onCancel, onUsePhoto, t }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingFileRef = useRef<File | null>(null);

  const [step, setStep] = useState<"live" | "preview">("live");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<"permission" | "unsupported" | "failed" | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [attachKey, setAttachKey] = useState(0);

  const title =
    phase === "clock_in"
      ? t("clock.dialog_title_in", "Clock-in selfie")
      : t("clock.dialog_title_out", "Clock-out selfie");

  const releasePreview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    pendingFileRef.current = null;
  }, [previewUrl]);

  const stopCamera = useCallback(() => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    const element = videoRef.current;
    if (element) {
      element.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const resetOverlay = useCallback(() => {
    releasePreview();
    stopCamera();
    setStep("live");
    setCameraError(null);
  }, [releasePreview, stopCamera]);

  useEffect(() => {
    if (!open) {
      resetOverlay();
      return;
    }
    setStep("live");
    setCameraError(null);
    setAttachKey((k) => k + 1);
  }, [open, phase, resetOverlay]);

  useEffect(() => {
    if (!open || step !== "live" || cameraError) {
      return;
    }

    let cancelled = false;

    async function attachCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("unsupported");
        return;
      }

      setCameraReady(false);
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
          setCameraReady(true);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setCameraError("permission");
        } else {
          setCameraError("failed");
        }
        stopCamera();
      }
    }

    void attachCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, step, cameraError, attachKey, stopCamera]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  useEffect(() => {
    return () => {
      releasePreview();
      stopCamera();
    };
  }, [releasePreview, stopCamera]);

  function handleCaptureFrame() {
    setCameraError(null);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      setCameraError("failed");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("failed");
      return;
    }

    context.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("failed");
          return;
        }
        stopCamera();
        const file = new File([blob], `live-clock-selfie-${phase}-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        pendingFileRef.current = file;
        setPreviewUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
          }
          return URL.createObjectURL(blob);
        });
        setStep("preview");
      },
      "image/jpeg",
      0.92,
    );
  }

  function handleRetake() {
    releasePreview();
    setStep("live");
    setCameraError(null);
    setAttachKey((k) => k + 1);
  }

  function handleUsePhoto() {
    const file = pendingFileRef.current;
    if (!file) {
      return;
    }
    onUsePhoto(file, phase);
    resetOverlay();
  }

  function handleRetryCamera() {
    setCameraError(null);
    setStep("live");
    setAttachKey((k) => k + 1);
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  const errorMessage =
    cameraError === "permission"
      ? CAMERA_PERMISSION
      : cameraError === "unsupported"
        ? CAMERA_UNSUPPORTED
        : cameraError === "failed"
          ? "Could not start the camera. Try again or use another device."
          : null;

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-[2000] flex flex-col overflow-hidden bg-black/95 text-white"
      role="dialog"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-white/70">
            {step === "preview"
              ? t("clock.camera_review_hint", "Review your photo, then use it or retake.")
              : t("clock.camera_live_hint", "Position your face in the frame, then capture.")}
          </p>
        </div>
        <button
          aria-label={t("common.close", "Close")}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20"
          type="button"
          onClick={onCancel}
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {errorMessage ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="max-w-md text-sm text-white/90">{errorMessage}</p>
            {cameraError === "permission" || cameraError === "failed" ? (
              <Button onClick={handleRetryCamera} type="button" variant="secondary">
                {t("common.retry", "Retry")}
              </Button>
            ) : null}
          </div>
        ) : step === "preview" && previewUrl ? (
          <div className="flex h-full items-center justify-center bg-black p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={t("clock.camera_preview_alt", "Selfie preview")}
              className="max-h-full max-w-full object-contain"
              src={previewUrl}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-black">
            <video
              ref={videoRef}
              autoPlay
              className="h-full w-full max-h-[min(72dvh,720px)] object-cover"
              muted
              playsInline
            />
            {!cameraReady ? (
              <p className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/80">
                {t("clock.camera_starting", "Starting camera…")}
              </p>
            ) : null}
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-black/80 px-4 py-4">
        {errorMessage ? (
          <Button className="w-full" onClick={onCancel} type="button" variant="secondary">
            {t("common.cancel", "Cancel")}
          </Button>
        ) : step === "preview" ? (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2 sm:flex-row">
            <Button className="w-full flex-1" onClick={handleRetake} type="button" variant="secondary">
              {t("clock.camera_retake", "Retake")}
            </Button>
            <Button className="w-full flex-1" onClick={handleUsePhoto} type="button">
              {t("clock.camera_use_photo", "Use photo")}
            </Button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2 sm:flex-row">
            <Button
              className="w-full flex-1 min-h-[3rem] text-base"
              disabled={!cameraReady}
              onClick={handleCaptureFrame}
              type="button"
            >
              {t("clock.capture", "Capture selfie")}
            </Button>
            <Button className="w-full flex-1" onClick={onCancel} type="button" variant="secondary">
              {t("common.cancel", "Cancel")}
            </Button>
          </div>
        )}
      </footer>
    </div>,
    document.body,
  );
}
