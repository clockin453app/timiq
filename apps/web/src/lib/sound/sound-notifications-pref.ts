const STORAGE_KEY = "timiq.soundNotificationsEnabled";

export function readSoundNotificationsEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSoundNotificationsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent("timiq:sound-notifications-pref", { detail: { enabled } }),
    );
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Respect system reduced-motion as a proxy for reduced sensory noise. */
export function prefersQuietNotifications(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
