"use client";

import { useCallback, useEffect, useRef } from "react";

import { useCurrentUser } from "../../features/auth";
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import {
  fetchNotificationSummary,
  type NotificationSummary,
} from "../../features/notifications/api";
import { navBadgesFromSummary } from "../../features/notifications/nav-badges";
import {
  playNotificationSound,
  unlockNotificationAudioFromGesture,
} from "../../lib/sound/notification-sound";
import { readSoundNotificationsEnabled } from "../../lib/sound/sound-notifications-pref";

const POLL_MS = 28_000;

export function NotificationSoundListener() {
  const limited = userHasLimitedAccess(useCurrentUser());
  const scopeCompany: string | null = null;

  const initializedRef = useRef(false);
  const prevMessagesRef = useRef(0);
  const prevTotalRef = useRef(0);

  const handleSummary = useCallback((row: NotificationSummary) => {
    if (limited || !readSoundNotificationsEnabled()) {
      prevMessagesRef.current = navBadgesFromSummary(row.items)["/messages"] ?? 0;
      prevTotalRef.current = row.total_count ?? 0;
      initializedRef.current = true;
      return;
    }

    const messages = navBadgesFromSummary(row.items)["/messages"] ?? 0;
    const total = row.total_count ?? 0;

    if (!initializedRef.current) {
      prevMessagesRef.current = messages;
      prevTotalRef.current = total;
      initializedRef.current = true;
      return;
    }

    const messagesIncreased = messages > prevMessagesRef.current;
    const totalIncreased = total > prevTotalRef.current;

    if (messagesIncreased || (totalIncreased && !messagesIncreased)) {
      playNotificationSound();
    }

    prevMessagesRef.current = messages;
    prevTotalRef.current = total;
  }, [limited]);

  useEffect(() => {
    if (limited) {
      return undefined;
    }

    const onSummary = (event: Event) => {
      handleSummary((event as CustomEvent<NotificationSummary>).detail);
    };
    window.addEventListener("timiq:notification-summary", onSummary);

    const poll = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void fetchNotificationSummary(scopeCompany)
        .then(handleSummary)
        .catch(() => undefined);
    };

    void fetchNotificationSummary(scopeCompany)
      .then(handleSummary)
      .catch(() => undefined);

    const id = window.setInterval(poll, POLL_MS);
    return () => {
      window.removeEventListener("timiq:notification-summary", onSummary);
      window.clearInterval(id);
    };
  }, [handleSummary, limited, scopeCompany]);

  useEffect(() => {
    const unlock = () => unlockNotificationAudioFromGesture();
    window.addEventListener("pointerdown", unlock, { once: false, passive: true });
    window.addEventListener("keydown", unlock, { once: false, passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return null;
}
