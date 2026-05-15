/** All locales with translation bundles (build/i18n:check). */
export const APP_LOCALES = ["en-GB", "ro-RO", "pl-PL", "es-ES", "ru-RU"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/**
 * Locales users may select in the UI (I18N safe mode).
 * ro/pl/es/ru remain in repo for future page-by-page wiring — not exposed until reviewed.
 */
export const SELECTABLE_APP_LOCALES = ["en-GB"] as const satisfies readonly AppLocale[];
export type SelectableAppLocale = (typeof SELECTABLE_APP_LOCALES)[number];
