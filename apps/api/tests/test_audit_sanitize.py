"""Audit detail sanitization for API responses."""

import copy

from app.modules.audit.sanitize import audit_details_summary, sanitize_audit_details


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


def test_sanitize_does_not_mutate_original_dict() -> None:
    raw = {"storage_path": "keep", "nested": {"password": "x"}}
    snapshot = copy.deepcopy(raw)
    sanitize_audit_details(raw)
    assert raw == snapshot


def test_audit_details_summary_truncates_long_json() -> None:
    long_list = {"items": [{"id": i} for i in range(200)]}
    s = audit_details_summary(long_list, max_len=50)
    assert len(s) <= 50
