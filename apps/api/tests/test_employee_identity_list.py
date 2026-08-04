"""Users list identity fields: payroll_type + face_reference_configured."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from io import BytesIO

from PIL import Image

from app.modules.auth.models import SystemRole, User
from app.modules.auth.schemas import UserResponse
from app.modules.employee_profiles.face_reference_service import _make_face_reference_thumbnail


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="admin@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def test_user_response_includes_identity_fields() -> None:
    user = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    response = UserResponse.model_validate(user).model_copy(
        update={
            "payroll_type": "paye_employee",
            "face_reference_configured": True,
        },
    )
    assert response.payroll_type == "paye_employee"
    assert response.face_reference_configured is True


def test_get_users_maps_payroll_type_and_face_flag() -> None:
    company_id = uuid.uuid4()
    employee = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    employee.email = "worker@example.com"
    rows = [
        (employee, "Ada", "Lovelace", "Engineer", "cis_subcontractor", True),
    ]
    payload = [
        UserResponse.model_validate(user).model_copy(
            update={
                "profile_first_name": first_name,
                "profile_last_name": last_name,
                "profile_job_title": (job_title or "").strip() or None,
                "payroll_type": payroll_type,
                "face_reference_configured": face_reference_configured,
            },
        )
        for user, first_name, last_name, job_title, payroll_type, face_reference_configured in rows
    ]
    assert payload[0].payroll_type == "cis_subcontractor"
    assert payload[0].face_reference_configured is True
    assert payload[0].profile_first_name == "Ada"
    assert payload[0].profile_job_title == "Engineer"


def test_face_reference_thumb_variant_accepted() -> None:
    buf = BytesIO()
    Image.new("RGB", (240, 240), color=(20, 40, 60)).save(buf, format="JPEG")
    thumb, media = _make_face_reference_thumbnail(buf.getvalue(), max_edge=96)
    assert media == "image/jpeg"
    assert len(thumb) < len(buf.getvalue())
    with Image.open(BytesIO(thumb)) as image:
        assert max(image.size) <= 96
