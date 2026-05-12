"use client";

import { useEffect, useState } from "react";

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

/**
 * Live label for open shift duration (updates every second while active).
 */
export function useLiveShiftDuration(
  clockInIso: string | null | undefined,
  isActive: boolean,
): string {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!isActive || !clockInIso) {
      setLabel("");
      return undefined;
    }
    const started = Date.parse(clockInIso);
    if (Number.isNaN(started)) {
      setLabel("");
      return undefined;
    }

    const tick = () => {
      setLabel(formatElapsed(Date.now() - started));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isActive, clockInIso]);

  return label;
}
