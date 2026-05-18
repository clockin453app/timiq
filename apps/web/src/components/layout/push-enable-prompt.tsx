"use client";

import { useCallback, useEffect, useState } from "react";

import { useCurrentUser } from "../../features/auth";
import {
  fetchPushPublicKey,
  postPushSubscribe,
} from "../../features/notifications/api";
import {
  createBrowserPushSubscription,
  getActivePushSubscription,
  isPushSupported,
  notificationPermission,
} from "../../features/notifications/push";
import { getSettingsEffective, getSettingsMe } from "../../features/settings/api";

function dismissalKey(userId: string): string {
  return `timiq:push-prompt-dismissed:${userId}`;
}

export function PushEnablePrompt() {
  const user = useCurrentUser();
  const [publicKey, setPublicKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const evaluate = useCallback(async () => {
    setMessage("");
    if (!isPushSupported()) {
      setVisible(false);
      return;
    }
    if (notificationPermission() === "denied") {
      setVisible(false);
      return;
    }
    if (window.localStorage.getItem(dismissalKey(user.id)) === "1") {
      setVisible(false);
      return;
    }

    const [config, me, effective] = await Promise.all([
      fetchPushPublicKey(),
      getSettingsMe(),
      getSettingsEffective(null),
    ]);
    if (!config.enabled || !config.public_key || !me.push_notifications_enabled || !effective.notification_push_effective) {
      setVisible(false);
      return;
    }

    const sub = await getActivePushSubscription();
    setPublicKey(config.public_key);
    setVisible(!sub);
  }, [user.id]);

  useEffect(() => {
    void evaluate().catch(() => {
      setVisible(false);
    });
  }, [evaluate]);

  function dismiss() {
    window.localStorage.setItem(dismissalKey(user.id), "1");
    setVisible(false);
  }

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await createBrowserPushSubscription(publicKey);
      await postPushSubscribe(payload);
      setVisible(false);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not enable push notifications.";
      setMessage(text);
      if (notificationPermission() === "denied") {
        setVisible(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--layout-mobile-bottom-nav-height)+0.75rem)] z-[2200] mx-auto max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-lg md:bottom-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--color-text)]">Enable push notifications</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            Get TimIQ attendance and work alerts on this device. Your browser will ask for permission.
          </p>
          {message ? <p className="mt-2 text-xs text-[var(--color-danger-700)]">{message}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)]"
            disabled={busy}
            onClick={dismiss}
            type="button"
          >
            Not now
          </button>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] px-3 py-1.5 text-xs font-bold text-[var(--color-text)]"
            disabled={busy}
            onClick={() => void enable()}
            type="button"
          >
            {busy ? "Enabling..." : "Allow"}
          </button>
        </div>
      </div>
    </div>
  );
}
