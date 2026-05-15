import type { AppLocale } from "./types";
import { ES_STRINGS } from "./es";
import { PL_STRINGS } from "./pl";
import { RO_STRINGS } from "./ro";
import { RU_STRINGS } from "./ru";

export { RO_STRINGS, PL_STRINGS, ES_STRINGS, RU_STRINGS };

export const LOCALE_OVERRIDES: Record<Exclude<AppLocale, "en-GB">, Record<string, string>> = {
  "ro-RO": RO_STRINGS,
  "pl-PL": PL_STRINGS,
  "es-ES": ES_STRINGS,
  "ru-RU": RU_STRINGS,
};
