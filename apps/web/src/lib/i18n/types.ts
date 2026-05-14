export const APP_LOCALES = ["en-GB", "ro-RO", "pl-PL"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
