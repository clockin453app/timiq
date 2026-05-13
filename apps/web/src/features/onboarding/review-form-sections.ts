/** Grouped display keys for admin onboarding review (no storage paths). */

export const ONBOARDING_REVIEW_SECTIONS: readonly { title: string; keys: readonly string[] }[] = [
  {
    title: "Personal",
    keys: ["first_name", "last_name", "birth_date", "phone"],
  },
  {
    title: "Address",
    keys: ["street_address", "address_line1", "address_line2", "city", "postcode", "country"],
  },
  {
    title: "Emergency contact",
    keys: ["emergency_contact_name", "emergency_contact_phone"],
  },
  {
    title: "Medical",
    keys: ["medical_condition", "medical_details"],
  },
  {
    title: "Position & CSCS",
    keys: ["position", "job_title", "cscs_number", "cscs_expiry"],
  },
  {
    title: "Employment & tax",
    keys: ["employment_type", "right_to_work_uk", "national_insurance_number", "utr"],
  },
  {
    title: "Bank details",
    keys: ["bank_account_holder", "bank_sort_code", "bank_account_number"],
  },
  {
    title: "Contractor company",
    keys: ["company_trading_name", "company_registration_number"],
  },
  {
    title: "Contract & site",
    keys: ["start_date", "contract_effective_date", "site_address", "contract_accepted", "contract_version"],
  },
  {
    title: "Signature (form)",
    keys: ["signature_name"],
  },
] as const;

const LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  birth_date: "Date of birth",
  phone: "Phone",
  street_address: "Street address",
  address_line1: "Address line 1 (legacy)",
  address_line2: "Address line 2",
  city: "City",
  postcode: "Postcode",
  country: "Country",
  emergency_contact_name: "Emergency contact name",
  emergency_contact_phone: "Emergency contact phone",
  medical_condition: "Medical condition (yes/no)",
  medical_details: "Medical details",
  position: "Position / site role",
  job_title: "Additional job title",
  cscs_number: "CSCS number",
  cscs_expiry: "CSCS expiry",
  employment_type: "Employment / tax status",
  right_to_work_uk: "Right to work in UK",
  national_insurance_number: "National Insurance number",
  utr: "UTR",
  bank_account_holder: "Bank account holder",
  bank_sort_code: "Sort code",
  bank_account_number: "Account number",
  company_trading_name: "Company trading name",
  company_registration_number: "Company registration number",
  start_date: "Start date",
  contract_effective_date: "Contract effective date",
  site_address: "Site address",
  contract_accepted: "Contract accepted",
  contract_version: "Contract version",
  signature_name: "Signatory name",
};

export function onboardingReviewFieldLabel(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

export function formatOnboardingFieldValue(key: string, raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) {
    return "—";
  }
  if (key === "contract_accepted") {
    const t = v.toLowerCase();
    if (t === "true" || t === "yes" || t === "1" || t === "on") {
      return "Yes";
    }
    return v;
  }
  if (key === "medical_condition" || key === "right_to_work_uk") {
    const t = v.toLowerCase();
    if (t === "yes" || t === "true" || t === "1") {
      return "Yes";
    }
    if (t === "no" || t === "false" || t === "0") {
      return "No";
    }
  }
  return v;
}
