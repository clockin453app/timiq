"use client";

import { useEffect, useId, useRef, useState } from "react";

import { fetchFaceReferenceImage } from "@/features/face-check/api";

import { employeeDisplayName, employeeInitials } from "./employee-identity";

type Identity = {
  id: string;
  email: string;
  profile_first_name?: string | null;
  profile_last_name?: string | null;
  face_reference_configured?: boolean;
};

export function EmployeePhotoViewer({
  user,
  open,
  onClose,
}: {
  user: Identity | null;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open || !user?.face_reference_configured) {
      setImageUrl(null);
      setError(user && !user.face_reference_configured ? "No employee photo enrolled." : "");
      setLoading(false);
      setZoom(1);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError("");
    setImageUrl(null);
    setZoom(1);
    void (async () => {
      try {
        const blob = await fetchFaceReferenceImage(user.id, { variant: "full" });
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setError("Could not load the employee photo.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [open, user]);

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || !user) {
    return null;
  }

  const name = employeeDisplayName(user);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 sm:p-6"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--color-text)]" id={titleId}>
              {name}
            </h2>
            <p className="truncate text-sm text-[var(--color-text-muted)]">{user.email}</p>
          </div>
          <button
            aria-label="Close photo viewer"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] text-lg font-semibold"
            ref={closeRef}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="relative flex min-h-[240px] flex-1 items-center justify-center overflow-auto bg-slate-950/90 p-4">
          {loading ? <p className="text-sm text-white">Loading photo…</p> : null}
          {!loading && error ? <p className="text-sm text-amber-100">{error}</p> : null}
          {!loading && !error && imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`Photo of ${name}`}
              className="max-h-[85vh] max-w-[90vw] object-contain transition-transform"
              src={imageUrl}
              style={{ transform: `scale(${zoom})` }}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            className="h-10 min-w-10 rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold"
            type="button"
            onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}
          >
            Zoom out
          </button>
          <button
            className="h-10 min-w-10 rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold"
            type="button"
            onClick={() => setZoom(1)}
          >
            Reset
          </button>
          <button
            className="h-10 min-w-10 rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold"
            type="button"
            onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}
          >
            Zoom in
          </button>
        </div>
      </div>
    </div>
  );
}
