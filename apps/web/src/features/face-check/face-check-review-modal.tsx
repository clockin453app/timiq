"use client";

import { useEffect, useState } from "react";

import { Button } from "../../components/ui";
import { useT, shiftStatusLabel } from "../../lib/i18n";
import { FaceCheckBadge } from "./face-check-badge";
import {
  fetchFaceReviewImage,
  fetchFaceReviewMetadata,
  type FaceReviewImageKind,
  type FaceReviewMetadata,
} from "./api";

function formatWhen(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatConfidence(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value * 100)}%`;
}

type ImageState = {
  url: string | null;
  loading: boolean;
  error: string;
};

const emptyImageState: ImageState = { url: null, loading: false, error: "" };

function imageUnavailableLabel(kind: FaceReviewImageKind): string {
  if (kind === "reference-image") {
    return "Reference photo not enrolled.";
  }
  if (kind === "clock-in-selfie") {
    return "Clock-in selfie not available.";
  }
  return "Clock-out selfie not available.";
}

function ReviewImage({
  title,
  state,
  unavailable,
}: {
  title: string;
  state: ImageState;
  unavailable: string | null;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</p>
      <div className="mt-2 flex min-h-[14rem] items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-sheet)] p-2">
        {state.loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading image…</p> : null}
        {!state.loading && state.url ? (
          // Protected endpoint blob URL; no storage path is exposed to the DOM.
          <img alt={title} className="max-h-[22rem] max-w-full rounded object-contain" src={state.url} />
        ) : null}
        {!state.loading && !state.url && state.error ? (
          <p className="text-sm text-[var(--color-danger-700)]">{state.error}</p>
        ) : null}
        {!state.loading && !state.url && !state.error && unavailable ? (
          <p className="text-sm text-[var(--color-text-muted)]">{unavailable}</p>
        ) : null}
      </div>
    </div>
  );
}

export function FaceCheckReviewModal({
  shiftId,
  onClose,
}: {
  shiftId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [metadata, setMetadata] = useState<FaceReviewMetadata | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<Record<FaceReviewImageKind, ImageState>>({
    "reference-image": emptyImageState,
    "clock-in-selfie": emptyImageState,
    "clock-out-selfie": emptyImageState,
  });

  useEffect(() => {
    if (!shiftId) {
      return;
    }
    const currentShiftId = shiftId;
    let cancelled = false;
    const urlsToRevoke: string[] = [];

    async function loadImage(kind: FaceReviewImageKind) {
      setImages((prev) => ({ ...prev, [kind]: { url: null, loading: true, error: "" } }));
      try {
        const blob = await fetchFaceReviewImage(currentShiftId, kind);
        if (cancelled) {
          return;
        }
        const url = URL.createObjectURL(blob);
        urlsToRevoke.push(url);
        setImages((prev) => ({ ...prev, [kind]: { url, loading: false, error: "" } }));
      } catch (err) {
        if (!cancelled) {
          setImages((prev) => ({
            ...prev,
            [kind]: {
              url: null,
              loading: false,
              error: err instanceof Error ? err.message : "Could not load image.",
            },
          }));
        }
      }
    }

    async function load() {
      setLoading(true);
      setError("");
      setMetadata(null);
      setImages({
        "reference-image": emptyImageState,
        "clock-in-selfie": emptyImageState,
        "clock-out-selfie": emptyImageState,
      });
      try {
        const data = await fetchFaceReviewMetadata(currentShiftId);
        if (cancelled) {
          return;
        }
        setMetadata(data);
        if (data.has_reference_photo) {
          void loadImage("reference-image");
        }
        if (data.has_clock_in_selfie) {
          void loadImage("clock-in-selfie");
        }
        if (data.has_clock_out_selfie) {
          void loadImage("clock-out-selfie");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load face check review.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      for (const url of urlsToRevoke) {
        URL.revokeObjectURL(url);
      }
    };
  }, [shiftId]);

  if (!shiftId) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto max-w-5xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">Face check review</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Images are private and shown only to authorised reviewers. Storage paths are not exposed.
            </p>
          </div>
          <Button onClick={onClose} type="button" variant="secondary">
            {t("common.close", "Close")}
          </Button>
        </div>

        {loading ? <p className="mt-4 text-sm text-[var(--color-text-muted)]">Loading review…</p> : null}
        {error ? <p className="mt-4 text-sm text-[var(--color-danger-700)]">{error}</p> : null}

        {metadata ? (
          <>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Employee</dt>
                <dd className="mt-1 text-[var(--color-text)]">
                  {metadata.employee.display_name}
                  {metadata.employee.email ? (
                    <span className="block text-xs text-[var(--color-text-muted)]">{metadata.employee.email}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Site</dt>
                <dd className="mt-1 text-[var(--color-text)]">{metadata.location_name}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Clock in</dt>
                <dd className="mt-1 text-[var(--color-text)]">{formatWhen(metadata.clock_in_at)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Clock out</dt>
                <dd className="mt-1 text-[var(--color-text)]">{formatWhen(metadata.clock_out_at)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Shift status</dt>
                <dd className="mt-1 text-[var(--color-text)]">{shiftStatusLabel(t, metadata.shift_status)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Face status</dt>
                <dd className="mt-1">
                  <FaceCheckBadge status={metadata.face_check_status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Confidence</dt>
                <dd className="mt-1 text-[var(--color-text)]">{formatConfidence(metadata.face_match_confidence)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Reason</dt>
                <dd className="mt-1 text-[var(--color-text)]">{metadata.face_check_reason || "—"}</dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <ReviewImage
                title="Reference photo"
                state={images["reference-image"]}
                unavailable={metadata.has_reference_photo ? null : imageUnavailableLabel("reference-image")}
              />
              <ReviewImage
                title="Clock-in selfie"
                state={images["clock-in-selfie"]}
                unavailable={metadata.has_clock_in_selfie ? null : imageUnavailableLabel("clock-in-selfie")}
              />
            </div>
            <div className="mt-3">
              <ReviewImage
                title="Clock-out selfie"
                state={images["clock-out-selfie"]}
                unavailable={metadata.has_clock_out_selfie ? null : imageUnavailableLabel("clock-out-selfie")}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
