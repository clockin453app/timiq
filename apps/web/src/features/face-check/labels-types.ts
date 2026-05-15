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
