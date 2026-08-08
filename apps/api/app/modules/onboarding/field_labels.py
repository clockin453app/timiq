"""Shared field/document labels for onboarding print + PDF (no storage paths)."""

from __future__ import annotations

# Display order for form responses (unknown keys appended alphabetically).
FORM_RESPONSE_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Personal", ("first_name", "last_name", "birth_date", "phone")),
    ("Address", ("street_address", "address_line1", "address_line2", "city", "postcode", "country")),
    ("Emergency contact", ("emergency_contact_name", "emergency_contact_phone")),
    ("Medical", ("medical_condition", "medical_details")),
    ("Position & CSCS", ("position", "job_title", "cscs_number", "cscs_expiry")),
    ("Employment & tax", ("employment_type", "right_to_work_uk", "national_insurance_number", "utr")),
    ("Bank details", ("bank_account_holder", "bank_sort_code", "bank_account_number")),
    ("Contractor company", ("company_trading_name", "company_registration_number")),
    ("Contract & site", ("start_date", "contract_effective_date", "site_address", "contract_accepted", "contract_version")),
    ("Signature (form)", ("signature_name",)),
)

FIELD_LABELS: dict[str, str] = {
    "first_name": "First name",
    "last_name": "Last name",
    "birth_date": "Date of birth",
    "phone": "Phone",
    "street_address": "Street address",
    "address_line1": "Address line 1 (legacy)",
    "address_line2": "Address line 2",
    "city": "City",
    "postcode": "Postcode",
    "country": "Country",
    "emergency_contact_name": "Emergency contact name",
    "emergency_contact_phone": "Emergency contact phone",
    "medical_condition": "Medical condition (yes/no)",
    "medical_details": "Medical details",
    "position": "Position / site role",
    "job_title": "Additional job title",
    "cscs_number": "CSCS number",
    "cscs_expiry": "CSCS expiry",
    "employment_type": "Employment / tax status",
    "right_to_work_uk": "Right to work in UK",
    "national_insurance_number": "National Insurance number",
    "utr": "UTR",
    "bank_account_holder": "Bank account holder",
    "bank_sort_code": "Sort code",
    "bank_account_number": "Account number",
    "company_trading_name": "Company trading name",
    "company_registration_number": "Company registration number",
    "start_date": "Start date",
    "contract_effective_date": "Contract effective date",
    "site_address": "Site address",
    "contract_accepted": "Contract accepted",
    "contract_version": "Contract version",
    "signature_name": "Signatory name",
}

DOC_TYPE_LABELS: dict[str, str] = {
    "identity_document": "Identity document",
    "cscs_card": "CSCS card",
    "public_liability_insurance": "Public liability insurance",
    "share_code_document": "Share-code document",
}

DOCUMENT_TITLE = "Employee onboarding form"


def field_label(key: str) -> str:
    return FIELD_LABELS.get(key) or key.replace("_", " ").strip() or key


def doc_type_label(doc_type: str) -> str:
    return DOC_TYPE_LABELS.get(doc_type) or doc_type.replace("_", " ").strip() or doc_type


def format_field_value(key: str, raw: object) -> str | None:
    """Return display value, or None when an empty optional answer should be omitted."""
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        import json

        text = json.dumps(raw, ensure_ascii=False)
    else:
        text = str(raw).strip()
    if not text:
        return None
    if key == "contract_accepted":
        t = text.lower()
        if t in ("true", "yes", "1", "on"):
            return "Yes"
        if t in ("false", "no", "0", "off"):
            return "No"
        return text
    if key in ("medical_condition", "right_to_work_uk"):
        t = text.lower()
        if t in ("yes", "true", "1"):
            return "Yes"
        if t in ("no", "false", "0"):
            return "No"
    return text


def ordered_form_rows(form: dict[str, object]) -> list[tuple[str, str, str]]:
    """Return (key, friendly_label, display_value) in section order; skip empty optionals."""
    seen: set[str] = set()
    rows: list[tuple[str, str, str]] = []
    for _title, keys in FORM_RESPONSE_SECTIONS:
        for key in keys:
            if key not in form:
                continue
            seen.add(key)
            disp = format_field_value(key, form.get(key))
            if disp is None:
                continue
            rows.append((key, field_label(key), disp))
    for key in sorted(k for k in form.keys() if k not in seen):
        disp = format_field_value(key, form.get(key))
        if disp is None:
            continue
        rows.append((key, field_label(str(key)), disp))
    return rows
