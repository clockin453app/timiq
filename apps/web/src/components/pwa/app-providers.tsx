"use client";

import type { ReactNode } from "react";

import { I18nProvider } from "../../lib/i18n";
import { OfflineBanner } from "./offline-banner";
import { PwaRegister } from "./pwa-register";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <I18nProvider>
      <PwaRegister />
      <OfflineBanner />
      {children}
    </I18nProvider>
  );
}
