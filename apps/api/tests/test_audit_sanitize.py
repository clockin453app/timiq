"""Audit detail sanitization for API responses."""

import copy

from app.modules.audit.sanitize import (
    build_audit_details_summary,
    sanitize_audit_details,
)


def test_sanitize_redacts_storage_and_path_keys() -> None:
    raw = {
        "storage_path": "onboarding-documents/x/y.pdf",
        "file_path": "/tmp/secret",
        "safe_id": "abc",
    }
    safe = sanitize_audit_details(raw)
    assert safe["storage_path"] == "[redacted]"
    assert safe["file_path"] == "[redacted]"
    assert safe["safe_id"] == "abc"


def test_sanitize_redacts_token_password_secret_substrings() -> None:
    raw = {"oauth_refresh_token": "secret-value", "message": "hello"}
    safe = sanitize_audit_details(raw)
    assert safe["oauth_refresh_token"] == "[redacted]"
    assert safe["message"] == "hello"


def test_sanitize_redacts_bank_and_ni_style_keys() -> None:
    raw = {
        "national_insurance_number": "QQ123456C",
        "sort_code": "12-34-56",
        "account_number": "12345678",
        "utr": "1234567890",
        "medical_notes": "x",
    }
    safe = sanitize_audit_details(raw)
    for k in raw:
        assert safe[k] == "[redacted]"


def test_sanitize_redacts_path_like_string_values() -> None:
    assert sanitize_audit_details("/Users/alice/secret/file.txt") == "[redacted]"
    assert sanitize_audit_details(r"C:\Users\alice\secret.txt") == "[redacted]"
    assert sanitize_audit_details("postgresql://user:pass@host/db") == "[redacted]"


def test_sanitize_redacts_selfie_and_password_hash_keys() -> None:
    raw = {
        "password_hash": "x",
        "selfie_storage_path": "/data/selfie.jpg",
        "face_reference_storage_path": "/data/face.bin",
        "reset_token": "abc",
    }
    safe = sanitize_audit_details(raw)
    for k in raw:
        assert safe[k] == "[redacted]"


def test_sanitize_does_not_mutate_original_dict() -> None:
    raw = {"storage_path": "keep", "nested": {"password": "x"}}
    snapshot = copy.deepcopy(raw)
    sanitize_audit_details(raw)
    assert raw == snapshot


def test_build_summary_preferences_changed_fields() -> None:
    details = {
        "user_id": "00000000-0000-0000-0000-000000000001",
        "changed_fields": ["compact_mode", "date_format", "locale"],
    }
    s = build_audit_details_summary("settings.user_preferences_updated", details)
    assert "User preferences updated" in s
    assert "Compact mode" in s
    assert "Date format" in s
    assert "Locale" in s
    assert "user_id" not in s
    assert "00000000" not in s


def test_build_summary_face_reference_enrolled() -> None:
    s = build_audit_details_summary("face_reference.enrolled", {"configured": True})
    assert s == "Face reference was enrolled."


def test_build_summary_truncates_long_text() -> None:
    long_list = {"changed_fields": [f"field_{i}" for i in range(80)]}
    s = build_audit_details_summary("budget.updated", long_list, max_len=50)
    assert len(s) <= 50
