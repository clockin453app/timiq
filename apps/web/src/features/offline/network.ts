export function isNavigatorOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/** Heuristic for failed fetch / offline (no response body cached). */
export function isLikelyNetworkFailure(err: unknown): boolean {
  if (isNavigatorOffline()) {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /network|fetch|failed to connect|load failed|Failed to fetch|aborted/i.test(msg);
}
