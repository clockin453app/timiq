import type { AppLocale } from "./types";
import { APP_LOCALES } from "./types";

export function normalizeAppLocale(raw: string | null | undefined): AppLocale {
  const s = (raw ?? "").trim();
  if ((APP_LOCALES as readonly string[]).includes(s)) {
    return s as AppLocale;
  }
  return "en-GB";
}
