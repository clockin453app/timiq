import type { AppLocale } from "./types";
import { APP_LOCALES, SELECTABLE_APP_LOCALES } from "./types";

const LOCALE_ALIASES: Record<string, AppLocale> = {
  en: "en-GB",
  "en-gb": "en-GB",
  ro: "ro-RO",
  "ro-ro": "ro-RO",
  pl: "pl-PL",
  "pl-pl": "pl-PL",
  es: "es-ES",
  "es-es": "es-ES",
  ru: "ru-RU",
  "ru-ru": "ru-RU",
};

export function normalizeAppLocale(raw: string | null | undefined): AppLocale {
  const s = (raw ?? "").trim();
  if ((APP_LOCALES as readonly string[]).includes(s)) {
    return s as AppLocale;
  }
  const alias = LOCALE_ALIASES[s.toLowerCase()];
  if (alias) {
    return alias;
  }
  return "en-GB";
}

export function isSelectableAppLocale(locale: AppLocale): boolean {
  return (SELECTABLE_APP_LOCALES as readonly string[]).includes(locale);
}

/** UI + localStorage: coerce hidden/incomplete locales to English. */
export function normalizeSelectableLocale(raw: string | null | undefined): AppLocale {
  const normalized = normalizeAppLocale(raw);
  return isSelectableAppLocale(normalized) ? normalized : "en-GB";
}
