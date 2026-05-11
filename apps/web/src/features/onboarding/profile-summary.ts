/** Field order for read-only onboarding summary on Profile (matches starter form payload keys). */
export const ONBOARDING_SUMMARY_FIELD_ORDER = [
  "first_name",
  "last_name",
  "phone",
  "job_title",
  "start_date",
  "emergency_contact_name",
  "emergency_contact_phone",
  "address_line1",
  "address_line2",
  "city",
  "postcode",
  "country",
  "national_insurance_number",
  "bank_account_holder",
  "bank_sort_code",
  "bank_account_number",
] as const;

const LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  job_title: "Job title",
  start_date: "Start date",
  emergency_contact_name: "Emergency contact name",
  emergency_contact_phone: "Emergency contact phone",
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  city: "City",
  postcode: "Postcode",
  country: "Country",
  national_insurance_number: "National Insurance number",
  bank_account_holder: "Bank account holder",
  bank_sort_code: "Sort code",
  bank_account_number: "Account number",
  utr: "UTR",
};

/** Shown masked on Profile until user chooses to reveal. */
export const SENSITIVE_ONBOARDING_FIELD_KEYS = new Set([
  "national_insurance_number",
  "bank_sort_code",
  "bank_account_number",
  "bank_account_holder",
  "utr",
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
  return "••••••••";
}
