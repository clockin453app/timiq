import type { AppLocale } from "./types";
import { APP_LOCALES } from "./types";

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
