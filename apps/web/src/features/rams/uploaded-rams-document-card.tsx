"use client";

import Link from "next/link";

import { Button } from "@/components/ui";
import { downloadUploadedRamsPdf } from "@/features/rams/api";
import type { RamsReadingProgress } from "@/features/rams/api";

type Props = {
  assessmentId: string;
  filename?: string | null;
  version?: number | null;
  fileSizeBytes?: number | null;
  readingProgress?: RamsReadingProgress | null;
  className?: string;
};

function readingStatusLabel(progress: RamsReadingProgress | null | undefined): string {
  if (!progress || progress.status === "not_started") return "Not opened";
  if (progress.status === "completed") return "Completed";
  return "In progress";
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compact uploaded-RAMS document card — no embedded PDF preview.
 */
export function UploadedRamsDocumentCard({
  assessmentId,
  filename,
  version,
  fileSizeBytes,
  readingProgress,
  className,
}: Props) {
  const sizeLabel = formatFileSize(fileSizeBytes);
  const totalPages = readingProgress?.total_pages ?? null;
  const viewed = readingProgress?.viewed_count ?? 0;

  return (
    <section className={className ?? "space-y-3 rounded border border-[var(--color-border)] bg-white p-4"}>
      <h3 className="text-base font-semibold text-[var(--color-text)]">Uploaded RAMS PDF</h3>
      <dl className="space-y-1 text-xs text-[var(--color-text-soft)]">
        <div className="min-w-0">
          <dt className="sr-only">Filename</dt>
          <dd className="break-all font-medium text-[var(--color-text)]">{filename ?? "RAMS PDF"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {version != null ? <span>Version {version}</span> : null}
          {totalPages != null ? <span>{totalPages} pages</span> : null}
          {sizeLabel ? <span>{sizeLabel}</span> : null}
        </div>
        <div>
          <span className="font-medium text-[var(--color-text)]">Reading status:</span>{" "}
          {readingStatusLabel(readingProgress)}
          {readingProgress?.status === "in_progress" && totalPages != null
            ? ` (${viewed} of ${totalPages} pages viewed)`
            : null}
        </div>
      </dl>
      <p className="text-xs text-[var(--color-text-soft)]">
        Open the in-app RAMS reader to progress through every page. Downloading alone does not unlock acknowledgement.
      </p>
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link
          className="inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-primary)] px-3 text-sm font-semibold text-white sm:w-auto"
          href={`/rams/${assessmentId}/read`}
        >
          Open RAMS
        </Link>
        <Button
          className="w-full min-h-[44px] sm:w-auto"
          onClick={() => void downloadUploadedRamsPdf(assessmentId, filename ?? undefined)}
          size="sm"
          type="button"
          variant="secondary"
        >
          Download PDF
        </Button>
      </div>
    </section>
  );
}
