"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { isAdministrator, type AuthUser } from "../auth";
import type { Company } from "./api";

export const SELECTED_COMPANY_STORAGE_KEY = "timiq.selectedCompanyId";

export function readStoredCompanyId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SELECTED_COMPANY_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredCompanyId(companyId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!companyId) {
      window.localStorage.removeItem(SELECTED_COMPANY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, companyId);
  } catch {
    // Ignore storage failures.
  }
}

export type AdministratorCompanyScope = {
  companies: Company[];
  companyId: string | null;
  setCompanyId: (id: string) => void;
  needsCompanySelection: boolean;
  companyName: string | null;
  scopeLabel: string | null;
};

export function useAdministratorCompanyScope(
  user: AuthUser | null,
  companies: Company[],
): AdministratorCompanyScope {
  const admin = user !== null && isAdministrator(user);
  const [companyId, setCompanyIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!admin) {
      setHydrated(true);
      return;
    }
    const stored = readStoredCompanyId();
    setCompanyIdState(stored);
    setHydrated(true);
  }, [admin]);

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.is_active),
    [companies],
  );

  useEffect(() => {
    if (!admin || !hydrated) {
      return;
    }
    if (companyId && activeCompanies.some((c) => c.id === companyId)) {
      return;
    }
    const stored = readStoredCompanyId();
    if (stored && activeCompanies.some((c) => c.id === stored)) {
      setCompanyIdState(stored);
      return;
    }
    if (companyId && !activeCompanies.some((c) => c.id === companyId)) {
      setCompanyIdState(null);
      writeStoredCompanyId(null);
    }
  }, [admin, hydrated, companyId, activeCompanies]);

  const setCompanyId = useCallback((id: string) => {
    const next = id.trim() || null;
    setCompanyIdState(next);
    writeStoredCompanyId(next);
  }, []);

  const companyName = useMemo(() => {
    if (!companyId) {
      return null;
    }
    return activeCompanies.find((c) => c.id === companyId)?.name ?? null;
  }, [companyId, activeCompanies]);

  const needsCompanySelection = admin && hydrated && !companyId;

  const scopeLabel = useMemo(() => {
    if (!admin) {
      return null;
    }
    if (needsCompanySelection) {
      return "Select a company to view company data.";
    }
    if (companyName) {
      return `Showing data for ${companyName}.`;
    }
    return null;
  }, [admin, needsCompanySelection, companyName]);

  return {
    companies: activeCompanies,
    companyId,
    setCompanyId,
    needsCompanySelection,
    companyName,
    scopeLabel,
  };
}
