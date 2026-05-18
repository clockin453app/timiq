"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { useCurrentUser } from "../../features/auth";
import { postPresenceHeartbeat } from "../../features/presence/api";

const CLIENT_INSTANCE_KEY = "timiq:presence-client-instance-id";
const HEARTBEAT_INTERVAL_MS = 60_000;
const VISIBLE_THROTTLE_MS = 15_000;

function getClientInstanceId(userId: string): string {
  const scopedKey = `${CLIENT_INSTANCE_KEY}:${userId}`;
  const existing = window.sessionStorage.getItem(scopedKey);
  if (existing) {
    return existing;
  }
  const value =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(scopedKey, value);
  return value;
}

export function PresenceHeartbeat() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const lastSentAtRef = useRef(0);

  const sendHeartbeat = useCallback(
    async (force = false) => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const now = Date.now();
      if (!force && now - lastSentAtRef.current < VISIBLE_THROTTLE_MS) {
        return;
      }
      lastSentAtRef.current = now;
      try {
        await postPresenceHeartbeat({
          client_instance_id: getClientInstanceId(user.id),
          current_path: pathname || "/",
          user_agent: window.navigator.userAgent || null,
        });
      } catch {
        /* Presence is diagnostic only; transient failures should not interrupt the app. */
      }
    },
    [pathname, user.id],
  );

  useEffect(() => {
    void sendHeartbeat(true);
    const interval = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sendHeartbeat]);

  return null;
}
