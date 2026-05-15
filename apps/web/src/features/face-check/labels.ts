export const FACE_CHECK_STATUSES = [
  "not_enrolled",
  "not_checked",
  "unavailable",
  "passed",
  "needs_review",
] as const;

export type FaceCheckStatusValue = (typeof FACE_CHECK_STATUSES)[number];

export type FaceCheckStatus = FaceCheckStatusValue | null | undefined;

export function asFaceCheckStatus(value: string | null | undefined): FaceCheckStatus {
  if (!value) {
    return undefined;
  }
  return FACE_CHECK_STATUSES.includes(value as FaceCheckStatusValue)
    ? (value as FaceCheckStatusValue)
    : undefined;
}

export function faceCheckStatusLabel(status: FaceCheckStatus): string {
  switch (status) {
    case "not_enrolled":
      return "Not enrolled";
    case "not_checked":
      return "Not checked";
    case "unavailable":
      return "Unavailable";
    case "passed":
      return "Passed";
    case "needs_review":
      return "Needs review";
    default:
      return "—";
  }
}

export function faceCheckAfterClockMessage(status: FaceCheckStatus): string | null {
  switch (status) {
    case "passed":
      return "Face check passed.";
    case "needs_review":
      return "Clock action submitted. Face check needs admin review.";
    case "unavailable":
      return "Clock action submitted. Face check could not be completed.";
    case "not_enrolled":
      return "Clock action submitted. Face check is not set up.";
    case "not_checked":
      return "Clock action submitted. Face check was not run.";
    default:
      return null;
  }
}
