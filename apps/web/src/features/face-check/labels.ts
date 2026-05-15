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
      return "Check pending";
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
    case "not_enrolled":
      return "Face check: no reference photo on file. You can add one in Profile.";
    case "unavailable":
      return "Face check: selfie saved. Automated matching is not enabled yet.";
    case "passed":
      return "Face check: passed.";
    case "needs_review":
      return "Face check: flagged for review.";
    case "not_checked":
      return "Face check: not run for this shift.";
    default:
      return null;
  }
}
