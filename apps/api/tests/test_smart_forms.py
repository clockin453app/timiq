"""Smart form schema and answer validation (no DB)."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

from app.modules.smart_forms.schema_validate import (
    SchemaValidationError,
    validate_answers_against_schema,
    validate_template_schema,
)


def _minimal_schema() -> dict:
    return {
        "sections": [
            {
                "id": "sec1",
                "title": "Section",
                "fields": [
                    {"id": "walkways_clear", "label": "Walkways clear", "type": "yes_no", "required": True},
                    {"id": "notes", "label": "Notes", "type": "textarea", "required": False},
                ],
            }
        ]
    }


def test_validate_template_schema_ok() -> None:
    validate_template_schema(_minimal_schema())


def test_validate_template_rejects_unknown_field_type() -> None:
    bad = {
        "sections": [
            {
                "id": "sec1",
                "title": "Section",
                "fields": [{"id": "x", "label": "X", "type": "html", "required": False}],
            }
        ]
    }
    with pytest.raises(SchemaValidationError, match="Unsupported field type"):
        validate_template_schema(bad)


def test_submit_requires_yes_no_when_required() -> None:
    schema = _minimal_schema()
    with pytest.raises(SchemaValidationError, match="Missing required"):
        validate_answers_against_schema(schema, {}, require_all_required=True)


def test_submit_ok_with_required_yes_no() -> None:
    schema = _minimal_schema()
    validate_answers_against_schema(
        schema,
        {"walkways_clear": "yes"},
        require_all_required=True,
    )


def test_professional_templates_load() -> None:
    from app.modules.smart_forms.service import list_professional_templates

    rows = list_professional_templates()
    assert len(rows) == 10
    assert rows[0].id
    assert rows[0].form_schema.get("sections")
    assert rows[0].requires_location
    assert rows[0].requires_signature
    assert rows[0].allow_photos


def test_professional_templates_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/smart-forms/professional-templates" in paths
    assert "/api/smart-forms/submissions/{submission_id}/pdf" in paths
    client = TestClient(app)
    assert client.get("/api/smart-forms/professional-templates").status_code == 401


def test_draft_allows_missing_required() -> None:
    schema = _minimal_schema()
    validate_answers_against_schema(schema, {}, require_all_required=False)

