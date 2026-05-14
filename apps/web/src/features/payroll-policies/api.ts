import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type CompanyTimePolicyFields = {
  standard_start_time: string;
  break_deduction_after_minutes: number | null;
  break_deduction_minutes: number;
  rounding_increment_minutes: number;
  rounding_mode: string;
};

export type SitePayrollPolicyRow = {
  id: string;
  company_id: string;
  location_id: string;
  is_enabled: boolean;
  standard_start_time: string | null;
  allow_early_clock_in: boolean | null;
  break_deduction_after_minutes: number | null;
  break_deduction_minutes: number | null;
  rounding_increment_minutes: number | null;
  rounding_mode: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SitePayrollPolicyListItem = {
  location_id: string;
  location_name: string;
  is_active: boolean;
  has_policy_row: boolean;
  is_enabled: boolean;
};

export type SitePayrollPolicyListResponse = {
  company_id: string;
  items: SitePayrollPolicyListItem[];
};

export type SitePayrollPolicyEffectiveResponse = {
  location_id: string;
  location_name: string;
  company_id: string;
  company_fallback: CompanyTimePolicyFields;
  override: SitePayrollPolicyRow | null;
  merged_effective: CompanyTimePolicyFields;
  policy_source: string;
};

export type SitePayrollPolicyUpsertRequest = {
  is_enabled: boolean;
  standard_start_time?: string | null;
  allow_early_clock_in?: boolean | null;
  break_deduction_after_minutes?: number | null;
  break_deduction_minutes?: number | null;
  rounding_increment_minutes?: number | null;
  rounding_mode?: string | null;
  notes?: string | null;
};

function companyQuery(companyId: string | undefined): string {
  if (!companyId) {
    return "";
  }
  return `?company_id=${encodeURIComponent(companyId)}`;
}

export async function listSitePayrollPolicies(
  companyId: string | undefined,
): Promise<SitePayrollPolicyListResponse> {
  const response = await fetch(
    `${API_URL}/api/payroll-policies/sites${companyQuery(companyId)}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    const raw = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (raw as { detail?: unknown }).detail,
        "Could not load site payroll rules.",
      ),
    );
  }
  return response.json() as Promise<SitePayrollPolicyListResponse>;
}

export async function getSitePayrollPolicyEffective(
  locationId: string,
  companyId: string | undefined,
): Promise<SitePayrollPolicyEffectiveResponse> {
  const response = await fetch(
    `${API_URL}/api/payroll-policies/sites/${encodeURIComponent(locationId)}${companyQuery(companyId)}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    const raw = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (raw as { detail?: unknown }).detail,
        "Could not load this site's rules.",
      ),
    );
  }
  return response.json() as Promise<SitePayrollPolicyEffectiveResponse>;
}

export async function putSitePayrollPolicy(
  locationId: string,
  body: SitePayrollPolicyUpsertRequest,
  companyId: string | undefined,
): Promise<SitePayrollPolicyEffectiveResponse> {
  const response = await fetch(
    `${API_URL}/api/payroll-policies/sites/${encodeURIComponent(locationId)}${companyQuery(companyId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const raw = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (raw as { detail?: unknown }).detail,
        "Could not save site payroll rules.",
      ),
    );
  }
  return response.json() as Promise<SitePayrollPolicyEffectiveResponse>;
}

export async function deleteSitePayrollPolicy(
  locationId: string,
  companyId: string | undefined,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/payroll-policies/sites/${encodeURIComponent(locationId)}${companyQuery(companyId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (response.ok || response.status === 204) {
    return;
  }
  const raw = await response.json().catch(() => ({}));
  throw new Error(
    fastApiDetailToMessage(
      (raw as { detail?: unknown }).detail,
      "Could not remove site payroll rules.",
    ),
  );
}
