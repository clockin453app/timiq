"use client";

import { useEffect } from "react";

import { getSettingsMe } from "../../features/settings/api";
import { useCurrentUser } from "../../features/auth/auth-context";
import { normalizeAppLocale } from "./locales";
import { useI18n } from "./context";

/** Loads saved locale from user preferences after authentication. */
export function AuthenticatedLocaleSync() {
  const user = useCurrentUser();
  const { setLocale } = useI18n();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getSettingsMe();
        if (!cancelled) {
          setLocale(normalizeAppLocale(me.locale));
        }
      } catch {
        if (!cancelled) {
          setLocale("en-GB");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, setLocale]);

  return null;
}
