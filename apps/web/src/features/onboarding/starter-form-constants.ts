export const STARTER_POSITION_OPTIONS = [
  "Bricklayer",
  "Labourer",
  "Fixer",
  "Supervisor/Foreman",
] as const;

export const STARTER_EMPLOYMENT_TYPES = [
  "Self-employed",
  "Ltd Company",
  "Agency",
  "PAYE",
] as const;

/** Keys persisted via draft PATCH (snake_case, string values). */
export const STARTER_FORM_DRAFT_KEYS = [
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
  "bank_account_number",
  "bank_sort_code",
  "bank_account_holder",
  "company_trading_name",
  "company_registration_number",
  "contract_accepted",
  "contract_version",
  "signature_name",
] as const;

export type StarterFormDraftKey = (typeof STARTER_FORM_DRAFT_KEYS)[number];
