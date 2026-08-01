"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import {
  downloadUploadedRamsPdf,
  fetchUploadedRamsPdfBlob,
  openUploadedRamsPdfInNewTab,
} from "@/features/rams/api";

type Props = {
  assessmentId: string;
  /** Bump or change to reload preview after a PDF replace. */
  reloadKey?: string | number;
  filenameHint?: string | null;
  fileSizeBytes?: number | null;
  className?: string;
  iframeClassName?: string;
  /**
   * When true, always show the desktop iframe embed (admin wide layouts).
   * Default: embed only from md breakpoint up; mobile uses Open/Download only.
   */
  forceEmbed?: boolean;
  /** When false, hide the open-in-tab control (download remains). Default true. */
  showOpenAction?: boolean;
};

function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Uploaded RAMS PDF reading surface.
 * Mobile: document card with authenticated Open full / Download (no tiny iframe).
 * Desktop: optional blob iframe preview plus the same actions.
 */
export function UploadedRamsPdfPreview({
  assessmentId,
  reloadKey,
  filenameHint,
  fileSizeBytes,
  className,
  iframeClassName,
  forceEmbed = false,
  showOpenAction = true,
}: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState<"open" | "download" | null>(null);
  const [embedDesktop, setEmbedDesktop] = useState(forceEmbed);

  useEffect(() => {
    if (forceEmbed) {
      setEmbedDesktop(true);
      return;
    }
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setEmbedDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [forceEmbed]);

  useEffect(() => {
    if (!embedDesktop) {
      setObjectUrl(null);
      setLoading(false);
      setError("");
      return;
    }

    let disposed = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError("");
    setObjectUrl(null);

    void fetchUploadedRamsPdfBlob(assessmentId)
      .then((blob) => {
        if (disposed) return;
        createdUrl = URL.createObjectURL(blob);
        if (disposed) {
          URL.revokeObjectURL(createdUrl);
          createdUrl = null;
          return;
        }
        setObjectUrl(createdUrl);
      })
      .catch((err) => {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "Could not load PDF preview.");
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [assessmentId, reloadKey, embedDesktop]);

  const sizeLabel = formatFileSize(fileSizeBytes);
  const displayName = filenameHint?.trim() || "Uploaded RAMS PDF";

  async function handleOpen() {
    setActionBusy("open");
    setError("");
    try {
      await openUploadedRamsPdfInNewTab(assessmentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open PDF.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDownload() {
    setActionBusy("download");
    setError("");
    try {
      await downloadUploadedRamsPdf(assessmentId, filenameHint ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download PDF.");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className={className ?? "space-y-3"}>
      <div className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-cell)] p-3 sm:p-4">
        <div className="min-w-0 space-y-1">
          <p className="break-all text-sm font-semibold text-[var(--color-text)]">{displayName}</p>
          {sizeLabel ? <p className="text-xs text-[var(--color-text-soft)]">{sizeLabel}</p> : null}
          <p className="text-xs text-[var(--color-text-soft)]">
            Open the full PDF to read every page before signing. Acknowledgement remains your declaration that you have
            read and understood the document.
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          {showOpenAction ? (
            <Button
              className="w-full min-w-0 sm:w-auto"
              disabled={actionBusy !== null}
              onClick={() => void handleOpen()}
              size="sm"
              type="button"
            >
              {actionBusy === "open" ? "Opening…" : "Open PDF"}
            </Button>
          ) : null}
          <Button
            className="w-full min-w-0 sm:w-auto"
            disabled={actionBusy !== null}
            onClick={() => void handleDownload()}
            size="sm"
            type="button"
            variant="secondary"
          >
            {actionBusy === "download" ? "Downloading…" : "Download PDF"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
          <p className="font-semibold">PDF unavailable</p>
          <p className="break-words">{error}</p>
          <p className="text-xs">Use Download PDF to retry.</p>
        </div>
      ) : null}

      {embedDesktop ? (
        <div className="space-y-2">
          {loading ? <p className="text-sm text-[var(--color-text-soft)]">Loading desktop PDF preview…</p> : null}
          {objectUrl && !error ? (
            <iframe
              className={
                iframeClassName ??
                "h-[28rem] w-full min-w-0 max-w-full rounded border border-[var(--color-border)] bg-white"
              }
              src={objectUrl}
              title="Uploaded RAMS PDF preview"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
