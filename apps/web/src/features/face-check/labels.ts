import type { FaceCheckStatus, FaceCheckStatusValue } from "./labels-types";

export { FACE_CHECK_STATUSES, asFaceCheckStatus } from "./labels-types";
export type { FaceCheckStatus, FaceCheckStatusValue } from "./labels-types";

type TranslateFn = (key: string, fallback?: string) => string;

const STATUS_KEYS: Record<FaceCheckStatusValue, string> = {
  not_enrolled: "face_check.status.not_enrolled",
  not_checked: "face_check.status.not_checked",
  unavailable: "face_check.status.unavailable",
  passed: "face_check.status.passed",
  needs_review: "face_check.status.needs_review",
};

const STATUS_FALLBACKS: Record<FaceCheckStatusValue, string> = {
  not_enrolled: "Not enrolled",
  not_checked: "Not checked",
  unavailable: "Unavailable",
  passed: "Passed",
  needs_review: "Needs review",
};

const AFTER_KEYS: Record<FaceCheckStatusValue, string> = {
  passed: "face_check.after.passed",
  needs_review: "face_check.after.needs_review",
  unavailable: "face_check.after.unavailable",
  not_enrolled: "face_check.after.not_enrolled",
  not_checked: "face_check.after.not_checked",
};

const AFTER_FALLBACKS: Record<FaceCheckStatusValue, string> = {
  passed: "Face check passed.",
  needs_review: "Clock action submitted. Face check needs admin review.",
  unavailable: "Clock action submitted. Face check could not be completed.",
  not_enrolled: "Clock action submitted. Face check is not set up.",
  not_checked: "Clock action submitted. Face check was not run.",
};

export function faceCheckStatusLabel(status: FaceCheckStatus, t?: TranslateFn): string {
  if (!status) {
    return "—";
  }
  const key = STATUS_KEYS[status];
  const fallback = STATUS_FALLBACKS[status];
  return t ? t(key, fallback) : fallback;
}

export function faceCheckAfterClockMessage(status: FaceCheckStatus, t?: TranslateFn): string | null {
  if (!status || !(status in AFTER_KEYS)) {
    return null;
  }
  const key = AFTER_KEYS[status as FaceCheckStatusValue];
  const fallback = AFTER_FALLBACKS[status as FaceCheckStatusValue];
  return t ? t(key, fallback) : fallback;
}
