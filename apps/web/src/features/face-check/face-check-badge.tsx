import { Badge } from "../../components/ui";
import { asFaceCheckStatus, faceCheckStatusLabel, type FaceCheckStatus } from "./labels";

function toneForStatus(status: FaceCheckStatus): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "passed":
      return "success";
    case "needs_review":
      return "danger";
    case "unavailable":
    case "not_checked":
      return "warning";
    case "not_enrolled":
    default:
      return "default";
  }
}

export function FaceCheckBadge({
  status,
}: {
  status: FaceCheckStatus | string | null | undefined;
}) {
  const normalized = typeof status === "string" ? asFaceCheckStatus(status) : status;
  if (!normalized) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  return <Badge tone={toneForStatus(normalized)}>{faceCheckStatusLabel(normalized)}</Badge>;
}
