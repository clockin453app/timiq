import type { AppLocale } from "./types";

/** Replace `{{name}}` style placeholders. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export function lookupString(
  locale: AppLocale,
  key: string,
  en: Record<string, string>,
  overrides: Record<string, string> | undefined,
  fallback?: string,
): string {
  if (locale !== "en-GB") {
    const o = overrides?.[key];
    if (o != null && o !== "") {
      return o;
    }
  }
  const v = en[key];
  if (v != null) {
    return v;
  }
  return fallback ?? key;
}
