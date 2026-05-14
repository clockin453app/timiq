"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { useCurrentUser } from "../auth/auth-context";
import { TIMIQ_OFFLINE_QUEUE_CHANGED } from "./events";
import { isNavigatorOffline } from "./network";
import { countOfflineQueueForUser, processOfflineQueue } from "./sync";

const FOCUS_SYNC_MS = 2500;

export function OfflineQueueSyncHost() {
  const user = useCurrentUser();
  const t = useT();
  // Defer any UI that depends on navigator / IndexedDB until after mount to avoid SSR vs client HTML mismatch.
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [failed, setFailed] = useState(0);
  const [syncing, setSyncing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lastAutoSyncRef = useRef(0);

  const refreshCounts = useCallback(async () => {
    try {
      const c = await countOfflineQueueForUser(user.id);
      setQueued(c.queued);
      setFailed(c.failed);
      setSyncing(c.syncing);
    } catch {
      setQueued(0);
      setFailed(0);
      setSyncing(0);
    }
  }, [user.id]);

  const runSync = useCallback(async () => {
    if (isNavigatorOffline()) {
      return;
    }
    setBusy(true);
    try {
      await processOfflineQueue(user.id);
    } finally {
      setBusy(false);
      await refreshCounts();
    }
  }, [refreshCounts, user.id]);

  useEffect(() => {
    setMounted(true);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    void refreshCounts();
  }, [mounted, refreshCounts]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const onQueue = () => void refreshCounts();
    window.addEventListener(TIMIQ_OFFLINE_QUEUE_CHANGED, onQueue);
    return () => window.removeEventListener(TIMIQ_OFFLINE_QUEUE_CHANGED, onQueue);
  }, [mounted, refreshCounts]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const onUp = () => {
      setOnline(true);
      void runSync();
    };
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, [mounted, runSync]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const onFocus = () => {
      const now = Date.now();
      if (now - lastAutoSyncRef.current < FOCUS_SYNC_MS) {
        return;
      }
      lastAutoSyncRef.current = now;
      if (!isNavigatorOffline()) {
        void runSync();
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible" && !isNavigatorOffline()) {
        onFocus();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mounted, runSync]);

  if (!mounted) {
    return null;
  }

  const totalPending = queued + failed + syncing;
  const showBar = !online || totalPending > 0 || busy;

  if (!showBar) {
    return null;
  }

  return (
    <div
      className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)] shadow-sm"
      role="region"
      aria-label={t("offline.aria_sync_status", "Offline sync status")}
    >
      <div className="mx-auto flex max-w-[min(72rem,100%)] flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          {!online ? (
            <p className="font-medium text-[var(--color-warning-700)]">
              {t("offline.sync_offline_hint", "Offline — queued work will sync when you reconnect.")}
            </p>
          ) : null}
          {online && totalPending > 0 ? (
            <p>
              {busy || syncing > 0 ? (
                <span className="font-medium">{t("offline.sync_working", "Syncing… ")}</span>
              ) : (
                <span className="font-medium">{t("offline.sync_queued", "Offline queue:")} </span>
              )}
              {queued > 0 ? (
                <span>{t("offline.sync_queued_n", "{{n}} queued", { n: queued })}</span>
              ) : null}
              {queued > 0 && failed > 0 ? <span> · </span> : null}
              {failed > 0 ? (
                <span className="text-[var(--color-danger-700)]">
                  {t("offline.sync_failed", "{{n}} failed (retry with Sync now)", { n: failed })}
                </span>
              ) : null}
            </p>
          ) : null}
          {online && totalPending === 0 && busy ? (
            <p className="font-medium">{t("offline.sync_checking", "Checking queue…")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button disabled={busy || isNavigatorOffline()} onClick={() => void runSync()} size="sm" type="button">
            {busy ? t("common.syncing", "Syncing…") : t("common.sync_now", "Sync now")}
          </Button>
          {totalPending > 0 ? (
            <Button onClick={() => setExpanded((v) => !v)} size="sm" type="button" variant="secondary">
              {expanded ? t("common.hide", "Hide") : t("common.details", "Details")}
            </Button>
          ) : null}
        </div>
      </div>
      {expanded && totalPending > 0 ? (
        <p className="mx-auto mt-2 max-w-[min(72rem,100%)] text-xs text-[var(--color-text-muted)]">
          {t(
            "offline.sync_details",
            "Site progress updates are sent to the server when you are online. Failed items keep a copy on this device until they succeed or you discard them from a future release. Duplicates are unlikely unless the server accepted a request but the device did not get the response.",
          )}
        </p>
      ) : null}
    </div>
  );
}
