"use client";

import { useEffect, useState, type ReactNode } from "react";

import { fetchFinanceModuleStatus } from "./finance-module";

type FinanceModuleGateProps = {
  children: ReactNode;
};

/** Blocks Finance pages when FINANCE_MODULE_ENABLED is off on the API. */
export function FinanceModuleGate({ children }: FinanceModuleGateProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchFinanceModuleStatus(controller.signal).then((status) => {
      if (!controller.signal.aborted) {
        setEnabled(status.enabled);
      }
    });
    return () => controller.abort();
  }, []);

  if (enabled === null) {
    return (
      <main style={{ padding: "1.5rem" }}>
        <p>Checking Finance availability…</p>
      </main>
    );
  }

  if (!enabled) {
    return (
      <main style={{ padding: "1.5rem" }}>
        <h1>Finance unavailable</h1>
        <p>Company Finance is turned off for this environment.</p>
      </main>
    );
  }

  return <>{children}</>;
}
