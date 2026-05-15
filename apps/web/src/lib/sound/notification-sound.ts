import {
  prefersQuietNotifications,
  readSoundNotificationsEnabled,
} from "./sound-notifications-pref";

const THROTTLE_MS = 4000;

let lastPlayedAt = 0;
let audioContext: AudioContext | null = null;
let userGestureUnlocked = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return null;
  }
  if (!audioContext) {
    audioContext = new Ctx();
  }
  return audioContext;
}

export function unlockNotificationAudioFromGesture(): void {
  userGestureUnlocked = true;
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
}

function playSoftChime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

/** Short in-app chime; safe to call from polling — errors are swallowed. */
export function playNotificationSound(): void {
  if (!readSoundNotificationsEnabled() || prefersQuietNotifications()) {
    return;
  }
  if (!userGestureUnlocked) {
    return;
  }
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return;
  }

  const nowMs = Date.now();
  if (nowMs - lastPlayedAt < THROTTLE_MS) {
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  const run = () => {
    try {
      playSoftChime(ctx);
      lastPlayedAt = nowMs;
    } catch {
      /* ignore */
    }
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(run).catch(() => undefined);
    return;
  }
  run();
}
