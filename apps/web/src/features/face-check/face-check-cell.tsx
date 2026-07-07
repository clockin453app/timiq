import { useT } from "../../lib/i18n";
import { FaceCheckBadge } from "./face-check-badge";
import { asFaceCheckStatus, faceCheckStatusLabel, type FaceCheckStatus } from "./labels";

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatMatchConfidence(confidence: number, t: ReturnType<typeof useT>): string {
  return t("face_check.match_confidence", "{{percent}} match", {
    percent: formatConfidence(confidence),
  });
}

export function FaceCheckCell({
  status,
  confidence,
}: {
  status: FaceCheckStatus | string | null | undefined;
  confidence?: number | null;
}) {
  const t = useT();
  const normalized = typeof status === "string" ? asFaceCheckStatus(status) : status;
  if (!normalized) {
    return <span className="text-[var(--color-text-muted)]">{faceCheckStatusLabel(undefined, t)}</span>;
  }

  const pct =
    confidence !== null && confidence !== undefined && !Number.isNaN(confidence)
      ? formatConfidence(confidence)
      : null;

  if (normalized === "needs_review" && pct) {
    return (
      <div className="flex flex-col gap-0.5">
        <FaceCheckBadge status={normalized} />
        <span className="text-[10px] font-medium text-[var(--color-danger-700)]">
          {formatMatchConfidence(confidence!, t)}
        </span>
      </div>
    );
  }

  if (normalized === "passed" && pct) {
    return (
      <div className="flex flex-col gap-0.5">
        <FaceCheckBadge status={normalized} />
        <span className="text-[10px] text-[var(--color-text-muted)]">{pct}</span>
      </div>
    );
  }

  return <FaceCheckBadge status={normalized} />;
}
