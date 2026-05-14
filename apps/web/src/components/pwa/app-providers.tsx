"use client";

import type { ReactNode } from "react";

import { OfflineBanner } from "./offline-banner";
import { PwaRegister } from "./pwa-register";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <>
      <PwaRegister />
      <OfflineBanner />
      {children}
    </>
  );
}
