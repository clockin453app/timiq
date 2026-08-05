"""Disposable HTTP reproduction for pre/post shift-integrity fix scenarios.

Uses DATABASE_URL override only. Does not touch production.
"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

# Force disposable DB before app settings load.
DB_NAME = "timiq_disposable_shift_integrity_http"
os.environ["DATABASE_URL"] = f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{DB_NAME}"
os.environ.setdefault("SESSION_SECRET", "local-dev-session-secret-change-me")
os.environ.setdefault("TIMIQ_ENV", "local")

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.main import app
from app.modules.auth.models import SystemRole, User
from app.modules.auth.security import hash_password
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.time_clock.models import TimeShift
from app.modules.audit.models import AuditEvent


def prepare_db() -> sessionmaker[Session]:
    admin = create_engine(
        "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres",
        isolation_level="AUTOCOMMIT",
    )
    with admin.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": DB_NAME}).scalar()
        if exists:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))
    admin.dispose()
    engine = create_engine(os.environ["DATABASE_URL"])
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def seed(factory: sessionmaker[Session]) -> dict:
    session = factory()
    company = Company(id=uuid.uuid4(), name="HTTP Repro Co", is_active=True)
    session.add(company)
    session.flush()
    session.add(
        CompanyTimePolicy(
            company_id=company.id,
            timezone_name="Europe/London",
            standard_start_time="08:00",
            overtime_after_hours=8.5,
            overtime_multiplier=1.5,
            rounding_increment_minutes=15,
            rounding_mode="nearest",
            break_deduction_minutes=0,
        )
    )
    admin = User(
        id=uuid.uuid4(),
        email="repro-admin@example.com",
        password_hash=hash_password("Password123!"),
        system_role=SystemRole.ADMINISTRATOR,
        is_active=True,
    )
    employee = User(
        id=uuid.uuid4(),
        email="repro-employee@example.com",
        password_hash=hash_password("Password123!"),
        system_role=SystemRole.EMPLOYEE,
        company_id=company.id,
        is_active=True,
    )
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Repro Site",
        address="1",
        latitude=51.5,
        longitude=-0.1,
        geofence_radius_meters=100,
        is_active=True,
    )
    session.add_all([admin, employee, location])
    session.flush()
    session.add(EmployeeProfile(user_id=employee.id, company_id=company.id, first_name="Repro", last_name="Emp"))
    session.add(EmployeeLocationAccess(user_id=employee.id, location_id=location.id))
    session.commit()
    out = {"admin": admin, "employee": employee, "location": location, "company": company}
    session.close()
    return out


def main() -> None:
    factory = prepare_db()
    seed_data = seed(factory)
    client = TestClient(app)
    login = client.post(
        "/api/auth/login",
        json={"email": "repro-admin@example.com", "password": "Password123!"},
    )
    print("LOGIN", login.status_code)
    assert login.status_code == 200

    tz = ZoneInfo("Europe/London")
    cin = datetime(2026, 8, 5, 8, 0, tzinfo=tz).astimezone(timezone.utc).isoformat()
    cout = datetime(2026, 8, 5, 16, 0, tzinfo=tz).astimezone(timezone.utc).isoformat()
    action_id = str(uuid.uuid4())
    body = {
        "user_id": str(seed_data["employee"].id),
        "location_id": str(seed_data["location"].id),
        "clock_in_at": cin,
        "clock_out_at": cout,
        "break_minutes": 30,
        "reason": "HTTP repro create",
        "client_action_id": action_id,
    }

    create1 = client.post("/api/time-records/admin/shifts", json=body)
    print("CREATE1", create1.status_code, create1.json().get("idempotent_replay"), create1.json()["shift"]["shift_id"])
    create2 = client.post("/api/time-records/admin/shifts", json=body)
    print("CREATE2_IDEMPOTENT", create2.status_code, create2.json().get("idempotent_replay"), create2.json()["shift"]["shift_id"])
    assert create1.json()["shift"]["shift_id"] == create2.json()["shift"]["shift_id"]

    dup = client.post(
        "/api/time-records/admin/shifts",
        json={**body, "client_action_id": str(uuid.uuid4()), "reason": "Second intention"},
    )
    print("DUP_DAY", dup.status_code, dup.json())

    shift_id = create1.json()["shift"]["shift_id"]
    patch = client.patch(
        f"/api/time-records/admin/shifts/{shift_id}",
        json={
            "clock_out_at": datetime(2026, 8, 5, 17, 0, tzinfo=tz).astimezone(timezone.utc).isoformat(),
            "break_minutes": 30,
            "reason": "HTTP repro update",
        },
    )
    print("PATCH", patch.status_code, patch.json()["shift"]["clock_out_at"])

    stale = client.patch(
        f"/api/time-records/admin/shifts/{uuid.uuid4()}",
        json={"clock_out_at": cout, "break_minutes": 0, "reason": "missing"},
    )
    print("STALE", stale.status_code, stale.json())

    session = factory()
    count = session.scalar(select(func.count()).select_from(TimeShift))
    audits = session.scalar(
        select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "time_record.shift_created_by_admin")
    )
    print("ROW_COUNT", count, "CREATE_AUDITS", audits)
    session.close()
    print("HTTP_REPRO_OK")


if __name__ == "__main__":
    main()
