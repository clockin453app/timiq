"use client";

import { useLayoutEffect, useState } from "react";

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const remAfterDays = totalSec % 86400;
  const hours = Math.floor(remAfterDays / 3600);
  const minutes = Math.floor((remAfterDays % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours >= 1) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatElapsedHms(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function computeLabels(clockInIso: string): { compact: string; hms: string } {
  const started = Date.parse(clockInIso);
  if (Number.isNaN(started)) {
    return { compact: "", hms: "" };
  }
  const ms = Date.now() - started;
  return { compact: formatElapsed(ms), hms: formatElapsedHms(ms) };
}

/**
 * Live label for open shift duration (updates every second while active).
 * Uses layout effect so the first client paint after mount already shows elapsed time (avoids empty flash).
 */
export function useLiveShiftDuration(
  clockInIso: string | null | undefined,
  isActive: boolean,
): string {
  const parts = useLiveShiftDurationParts(clockInIso, isActive);
  return parts.compact;
}

export function useLiveShiftDurationParts(
  clockInIso: string | null | undefined,
  isActive: boolean,
): { compact: string; hms: string } {
  const [labels, setLabels] = useState<{ compact: string; hms: string }>({ compact: "", hms: "" });

  useLayoutEffect(() => {
    if (!isActive || !clockInIso) {
      setLabels({ compact: "", hms: "" });
      return undefined;
    }
    const started = Date.parse(clockInIso);
    if (Number.isNaN(started)) {
      setLabels({ compact: "", hms: "" });
      return undefined;
    }

    const tick = () => {
      setLabels(computeLabels(clockInIso));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isActive, clockInIso]);

  return labels;
}
