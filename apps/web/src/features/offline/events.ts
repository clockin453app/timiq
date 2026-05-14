export const TIMIQ_OFFLINE_QUEUE_CHANGED = "timiq:offline-queue-changed";

export function dispatchOfflineQueueChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(TIMIQ_OFFLINE_QUEUE_CHANGED));
}
