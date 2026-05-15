"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { EN_STRINGS } from "./en";
import { LOCALE_STORAGE_KEY } from "./locale-storage";
import { LOCALE_OVERRIDES } from "./overrides";
import { normalizeSelectableLocale } from "./locales";
import { interpolate, lookupString } from "./translate-core";
import type { AppLocale } from "./types";

function readStoredLocale(): AppLocale {
  if (typeof window === "undefined") {
    return "en-GB";
  }
  try {
    const next = normalizeSelectableLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw !== next) {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    }
    return next;
  } catch {
    return "en-GB";
  }
}

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => readStoredLocale());

  const setLocale = useCallback((next: AppLocale) => {
    const normalized = normalizeSelectableLocale(next);
    setLocaleState(normalized);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const t = useCallback(
    (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      const overrides = locale === "en-GB" ? undefined : LOCALE_OVERRIDES[locale];
      const raw = lookupString(locale, key, EN_STRINGS, overrides, fallback);
      return interpolate(raw, vars);
    },
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return ctx;
}

export function useT(): I18nContextValue["t"] {
  return useI18n().t;
}
