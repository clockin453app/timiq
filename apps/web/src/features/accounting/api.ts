import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export const ACCOUNTING_PROVIDER_OPTIONS = [
  { value: "none", label: "Not connected" },
  { value: "quickbooks_desktop", label: "QuickBooks Desktop" },
  { value: "xero", label: "Xero" },
  { value: "sage", label: "Sage" },
  { value: "csv_export_only", label: "CSV export only (manual)" },
  { value: "other", label: "Other" },
] as const;

export type AccountingSettings = {
  company_id: string;
  provider_key: string;
  notes: string | null;
  updated_by_user_id: string | null;
  updated_at: string | null;
};

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

function settingsUrl(companyId: string | null): string {
  const base = `${API_URL}/api/accounting/settings`;
  if (!companyId) {
    return base;
  }
  const q = new URLSearchParams({ company_id: companyId });
  return `${base}?${q.toString()}`;
}

export async function fetchAccountingSettings(companyId: string | null): Promise<AccountingSettings> {
  const response = await fetch(settingsUrl(companyId), { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load accounting settings.");
  }
  return response.json() as Promise<AccountingSettings>;
}

export type AccountingSettingsUpsert = {
  company_id?: string | null;
  provider_key: string;
  notes?: string | null;
};

export async function saveAccountingSettings(body: AccountingSettingsUpsert): Promise<AccountingSettings> {
  const response = await fetch(`${API_URL}/api/accounting/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not save accounting settings.");
  }
  return response.json() as Promise<AccountingSettings>;
}

export const EXPORT_CSV_PROVIDERS = ["generic_csv", "xero", "quickbooks", "sage"] as const;
export type ExportCsvProvider = (typeof EXPORT_CSV_PROVIDERS)[number];

export type AccountingProvidersResponse = {
  providers: {
    id: ExportCsvProvider;
    label: string;
    export_types: { id: string; label: string }[];
  }[];
  disclaimer: string;
};

export type AccountingExportRun = {
  id: string;
  company_id: string;
  provider: string;
  export_type: string;
  date_from: string;
  date_to: string;
  status: string;
  created_by_user_id: string | null;
  created_at: string;
  row_count: number;
  total_amount: string | null;
  file_name: string;
  notes: string | null;
};

export type AccountingExportMapping = {
  company_id: string;
  provider: string;
  nominal_code_wages: string | null;
  nominal_code_cis: string | null;
  nominal_code_materials: string | null;
  nominal_code_tools: string | null;
  nominal_code_equipment: string | null;
  nominal_code_subcontractor: string | null;
  tax_code: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function fetchAccountingProviders(): Promise<AccountingProvidersResponse> {
  const response = await fetch(`${API_URL}/api/accounting/providers`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load export providers.");
  }
  return response.json() as Promise<AccountingProvidersResponse>;
}

export async function listAccountingExportRuns(companyId: string | null, limit = 50): Promise<AccountingExportRun[]> {
  const search = new URLSearchParams({ limit: String(limit) });
  if (companyId) {
    search.set("company_id", companyId);
  }
  const response = await fetch(`${API_URL}/api/accounting/export-runs?${search.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load export history.");
  }
  const data = (await response.json()) as { items: AccountingExportRun[] };
  return data.items;
}

function parseFilenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(header);
  if (m) {
    try {
      return decodeURIComponent((m[1] || m[2]).trim());
    } catch {
      return (m[1] || m[2]).trim() || fallback;
    }
  }
  return fallback;
}

export type PayrollAccountingExportBody = {
  provider: ExportCsvProvider;
  company_id?: string | null;
  date_from: string;
  date_to: string;
  export_type: "payroll_items" | "payroll_summary";
  include_approved: boolean;
  include_paid: boolean;
  include_pending: boolean;
  include_email: boolean;
};

export async function downloadPayrollAccountingCsv(
  body: PayrollAccountingExportBody,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/accounting/payroll/export.csv`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Payroll export failed.");
  }
  const blob = await response.blob();
  const name = parseFilenameFromContentDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadBudgetAccountingCsv(
  budgetId: string,
  provider: ExportCsvProvider,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/accounting/budgets/${encodeURIComponent(budgetId)}/export.csv`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  if (!response.ok) {
    await parseError(response, "Budget export failed.");
  }
  const blob = await response.blob();
  const name = parseFilenameFromContentDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportMappingUrl(companyId: string | null, provider: ExportCsvProvider): string {
  const search = new URLSearchParams({ provider });
  if (companyId) {
    search.set("company_id", companyId);
  }
  return `${API_URL}/api/accounting/export-settings?${search.toString()}`;
}

export async function fetchExportMapping(
  companyId: string | null,
  provider: ExportCsvProvider,
): Promise<AccountingExportMapping> {
  const response = await fetch(exportMappingUrl(companyId, provider), { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load export mapping.");
  }
  return response.json() as Promise<AccountingExportMapping>;
}

export type ExportMappingPatchBody = {
  company_id?: string | null;
  provider: ExportCsvProvider;
  nominal_code_wages?: string | null;
  nominal_code_cis?: string | null;
  nominal_code_materials?: string | null;
  nominal_code_tools?: string | null;
  nominal_code_equipment?: string | null;
  nominal_code_subcontractor?: string | null;
  tax_code?: string | null;
};

export async function patchExportMapping(body: ExportMappingPatchBody): Promise<AccountingExportMapping> {
  const response = await fetch(`${API_URL}/api/accounting/export-settings`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not save export mapping.");
  }
  return response.json() as Promise<AccountingExportMapping>;
}
