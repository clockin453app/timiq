/** Field order for read-only onboarding summary on Profile (matches starter form payload keys). */
export const ONBOARDING_SUMMARY_FIELD_ORDER = [
  "first_name",
  "last_name",
  "birth_date",
  "phone",
  "street_address",
  "address_line2",
  "city",
  "postcode",
  "country",
  "emergency_contact_name",
  "emergency_contact_phone",
  "medical_condition",
  "medical_details",
  "position",
  "job_title",
  "cscs_number",
  "cscs_expiry",
  "employment_type",
  "right_to_work_uk",
  "national_insurance_number",
  "utr",
  "start_date",
  "contract_effective_date",
  "site_address",
  "bank_account_holder",
  "bank_sort_code",
  "bank_account_number",
  "company_trading_name",
  "company_registration_number",
  "contract_accepted",
  "contract_version",
  "signature_name",
] as const;

const LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  birth_date: "Date of birth",
  phone: "Phone",
  street_address: "Street address",
  address_line2: "Address line 2",
  city: "City",
  postcode: "Postcode",
  country: "Country",
  emergency_contact_name: "Emergency contact name",
  emergency_contact_phone: "Emergency contact phone",
  medical_condition: "Medical condition",
  medical_details: "Medical details",
  position: "Position / site role",
  job_title: "Additional job title",
  cscs_number: "CSCS number",
  cscs_expiry: "CSCS expiry",
  employment_type: "Employment / tax status",
  right_to_work_uk: "Right to work in UK",
  national_insurance_number: "National Insurance number",
  utr: "UTR",
  start_date: "Start date",
  contract_effective_date: "Contract effective date",
  site_address: "Site address",
  bank_account_holder: "Bank account holder",
  bank_sort_code: "Sort code",
  bank_account_number: "Account number",
  company_trading_name: "Company trading name",
  company_registration_number: "Company registration number",
  contract_accepted: "Contract accepted",
  contract_version: "Contract version",
  signature_name: "Signatory name",
};

/** Shown masked on Profile until user chooses to reveal. */
export const SENSITIVE_ONBOARDING_FIELD_KEYS = new Set([
  "national_insurance_number",
  "bank_sort_code",
  "bank_account_number",
  "bank_account_holder",
  "utr",
  "medical_details",
]);

export function onboardingSummaryFieldLabel(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

export function maskOnboardingFieldValue(
  key: string,
  raw: string | undefined,
  revealed: boolean,
): string {
  const value = (raw ?? "").trim();
  if (!value) {
    return "—";
  }
  if (key === "contract_accepted") {
    const t = value.toLowerCase();
    if (t === "true" || t === "yes" || t === "1" || t === "on") {
      return "Yes";
    }
    return value;
  }
  if (key === "medical_condition" || key === "right_to_work_uk") {
    const t = value.toLowerCase();
    if (t === "yes" || t === "true" || t === "1") {
      return "Yes";
    }
    if (t === "no" || t === "false" || t === "0") {
      return "No";
    }
  }
  if (revealed || !SENSITIVE_ONBOARDING_FIELD_KEYS.has(key)) {
    return value;
  }
  if (key === "bank_account_number") {
    if (value.length <= 4) {
      return "••••";
    }
    return `${"•".repeat(Math.min(6, value.length - 4))}${value.slice(-4)}`;
  }
  if (key === "bank_sort_code") {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 2) {
      return "••";
    }
    return `••-••-${digits.slice(-2)}`;
  }
  if (key === "national_insurance_number") {
    if (value.length <= 2) {
      return "••";
    }
    return `${value.slice(0, 2)}${"•".repeat(value.length - 2)}`;
  }
  if (key === "bank_account_holder") {
    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return "•••";
    }
    return parts
      .map((word) => (word.length <= 2 ? "••" : `${word[0]}${"•".repeat(word.length - 1)}`))
      .join(" ");
  }
  if (key === "utr") {
    if (value.length <= 3) {
      return "•••";
    }
    return `${"•".repeat(value.length - 3)}${value.slice(-3)}`;
  }
  if (key === "medical_details") {
    if (value.length <= 12) {
      return "••••••••";
    }
    return `${value.slice(0, 4)}${"•".repeat(Math.min(24, value.length - 8))}${value.slice(-4)}`;
  }
  return "••••••••";
}
