"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { downloadUploadedRamsPdf, fetchUploadedRamsPdfBlob } from "@/features/rams/api";

type Props = {
  assessmentId: string;
  /** Bump or change to reload preview after a PDF replace. */
  reloadKey?: string | number;
  filenameHint?: string | null;
  className?: string;
  iframeClassName?: string;
};

/**
 * Inline PDF preview via authenticated fetch → blob object URL.
 * Avoids cross-origin iframe auth failures (session cookie not sent on API iframe navigations).
 */
export function UploadedRamsPdfPreview({
  assessmentId,
  reloadKey,
  filenameHint,
  className,
  iframeClassName,
}: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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
  }, [assessmentId, reloadKey]);

  return (
    <div className={className ?? "space-y-2"}>
      {loading ? <p className="text-sm text-[var(--color-text-soft)]">Loading PDF preview…</p> : null}
      {error ? (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
          <p className="font-semibold">PDF preview unavailable</p>
          <p>{error}</p>
          <p className="text-xs">Use Download PDF to open the document. Preview requires an authenticated session.</p>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              void downloadUploadedRamsPdf(assessmentId, filenameHint ?? undefined).catch((err) =>
                setError(err instanceof Error ? err.message : "Could not download PDF."),
              )
            }
          >
            Download PDF
          </Button>
        </div>
      ) : null}
      {objectUrl && !error ? (
        <iframe
          className={
            iframeClassName ??
            "h-[28rem] w-full min-w-0 rounded border border-[var(--color-border)] bg-white"
          }
          src={objectUrl}
          title="Uploaded RAMS PDF"
        />
      ) : null}
    </div>
  );
}
