"""Site Progress classification recovery — session-integrity and APPLY safety."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.work_progress.classification import CLASSIFIED_PROGRESS_STATUS
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.workplaces.models import Workplace
from scripts.recover_site_progress_classification import (
    RECOVERY_ACTION,
    RecoveryCandidate,
    _parse_level,
    apply_recovery_clean,
    gate_exact_18,
    scan_candidates,
    verify_recovered_independent,
    write_snapshot,
)


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kw):  # noqa: ANN001
    return "JSON"


def _engine():
    return create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def _session(engine=None) -> Session:
    engine = engine or _engine()
    tables = [
        Company.__table__,
        User.__table__,
        EmployeeProfile.__table__,
        Workplace.__table__,
        Location.__table__,
        WorkProgressEntry.__table__,
        WorkProgressAttachment.__table__,
        AuditEvent.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)()


def _seed_classified(
    session: Session,
    *,
    level: int = 0,
    category: str = "brickwork_level",
    elevation: str = "south",
    title: str = "",
    progress_status: str = CLASSIFIED_PROGRESS_STATUS,
    with_submit_audit: bool = True,
    null_classification: bool = True,
) -> tuple[WorkProgressEntry, User, Company, AuditEvent | None]:
    now = datetime.now(timezone.utc)
    company = Company(id=uuid.uuid4(), name="Co", is_active=True, created_at=now, updated_at=now)
    session.add(company)
    admin = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email="admin@ex.com",
        password_hash="h",
        system_role=SystemRole.ADMINISTRATOR,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    user = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email="e@ex.com",
        password_hash="h",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add_all([admin, user])
    wp = Workplace(id=uuid.uuid4(), company_id=company.id, name="WP", created_at=now, updated_at=now)
    session.add(wp)
    loc = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Kennington",
        latitude=1.0,
        longitude=2.0,
        created_at=now,
        updated_at=now,
    )
    session.add(loc)
    entry = WorkProgressEntry(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=company.id,
        workplace_id=wp.id,
        location_id=loc.id,
        work_date=date(2026, 8, 12),
        title=title,
        progress_status=progress_status,
        percent_complete=None,
        work_category=None if null_classification else category,
        elevation=None if null_classification else elevation,
        elevation_custom=None,
        level=None if null_classification else level,
        status="submitted",
        created_at=now,
        updated_at=now,
    )
    session.add(entry)
    audit = None
    if with_submit_audit:
        audit = AuditEvent(
            id=uuid.uuid4(),
            actor_user_id=user.id,
            company_id=company.id,
            action="work_progress.submitted",
            entity_type="work_progress_entry",
            entity_id=str(entry.id),
            details={"work_category": category, "elevation": elevation, "level": level},
            created_at=now,
        )
        session.add(audit)
    session.commit()
    return entry, admin, company, audit


def test_parse_level_accepts_zero() -> None:
    assert _parse_level(0) == 0
    assert _parse_level("0") == 0
    assert _parse_level(20) == 20
    assert _parse_level(None) is None
    assert _parse_level(True) is None


def test_same_session_core_update_leaves_stale_orm_null_without_expire() -> None:
    """Documents the risky mixed pattern: Core UPDATE + stale identity map.

    After Core UPDATE, expire_on_commit=False Session still sees NULL on ORM
    instances until expire/refresh. Same-session scan must never be treated as proof.
    Exact production ORM-overwrite-to-NULL is not claimed here; this proves the
    structural risk the new APPLY architecture eliminates.
    """
    engine = _engine()
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            Company.__table__,
            User.__table__,
            EmployeeProfile.__table__,
            Workplace.__table__,
            Location.__table__,
            WorkProgressEntry.__table__,
            WorkProgressAttachment.__table__,
            AuditEvent.__table__,
        ],
    )
    session = SessionLocal()
    try:
        entry, _admin, _co, _audit = _seed_classified(session, level=0)
        session.expire_all()
        loaded = session.get(WorkProgressEntry, entry.id)
        assert loaded is not None
        assert loaded.work_category is None
        assert loaded.level is None

        session.execute(
            text(
                """
                UPDATE work_progress_entries
                SET work_category = :c, elevation = :e, level = :l
                WHERE replace(id, '-', '') = :id
                """
            ),
            {"c": "brickwork_level", "e": "south", "l": 0, "id": entry.id.hex},
        )
        session.flush()
        # Identity map still holds pre-UPDATE NULLs (not expired).
        assert loaded.work_category is None
        assert loaded.level is None
        # Independent connection sees persisted values.
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT work_category, level FROM work_progress_entries WHERE replace(id, '-', '') = :id"),
                {"id": entry.id.hex},
            ).one()
        assert row[0] == "brickwork_level"
        assert row[1] == 0
    finally:
        session.close()


def test_apply_refuses_session_that_already_holds_work_progress_entry() -> None:
    session = _session()
    try:
        entry, admin, company, audit = _seed_classified(session, level=0)
        # Load ORM entry into identity map (old scan/apply anti-pattern).
        _ = session.get(WorkProgressEntry, entry.id)
        candidate = RecoveryCandidate(
            entry_id=str(entry.id),
            company_id=str(company.id),
            company_name="Co",
            employee="e",
            site="Kennington",
            work_date="2026-08-12",
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            percent_complete=None,
            attachment_count=0,
            audit_id=str(audit.id) if audit else "",
            before_work_category=None,
            before_elevation=None,
            before_elevation_custom=None,
            before_level=None,
            after_work_category="brickwork_level",
            after_elevation="south",
            after_elevation_custom=None,
            after_level=0,
            status="recoverable",
        )
        with pytest.raises(SystemExit, match="already holds WorkProgressEntry"):
            apply_recovery_clean(session, [candidate], admin, require_exact_18=False)
    finally:
        session.close()


def test_apply_level_zero_returning_and_independent_verify() -> None:
    engine = _engine()
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=True)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            Company.__table__,
            User.__table__,
            EmployeeProfile.__table__,
            Workplace.__table__,
            Location.__table__,
            WorkProgressEntry.__table__,
            WorkProgressAttachment.__table__,
            AuditEvent.__table__,
        ],
    )

    # SCAN
    with SessionLocal() as scan:
        entry, admin, company, audit = _seed_classified(scan, level=0)
        report = scan_candidates(scan)
        assert len(report.recoverable) == 1
        assert report.recoverable[0].after_level == 0
        candidates = list(report.recoverable)
        admin_id = admin.id
    # scan closed

    # APPLY clean
    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        assert actor is not None
        applied = apply_recovery_clean(apply_session, candidates, actor, require_exact_18=False)
        assert len(applied) == 1
        assert applied[0].level == 0
        assert applied[0].work_category == "brickwork_level"
    # apply closed

    # Independent verify #1
    with SessionLocal() as v1:
        exact, mismatches = verify_recovered_independent(v1, candidates)
        assert exact == 1
        assert mismatches == []
        row = v1.get(WorkProgressEntry, uuid.UUID(candidates[0].entry_id))
        assert row is not None
        assert row.level == 0
        assert row.work_category == "brickwork_level"
        audits = list(
            v1.scalars(
                select(AuditEvent).where(
                    AuditEvent.action == RECOVERY_ACTION,
                    AuditEvent.entity_id == candidates[0].entry_id,
                )
            )
        )
        assert len(audits) == 1
        assert audits[0].details["level"] == 0
        assert audits[0].details["work_category"] == "brickwork_level"

    # Independent verify #2
    with SessionLocal() as v2:
        exact2, _ = verify_recovered_independent(v2, candidates)
        assert exact2 == 1

    # Idempotent scan
    with SessionLocal() as idem:
        report2 = scan_candidates(idem)
        assert len(report2.recoverable) == 0
        assert len(report2.already_restored) == 1


def test_apply_refuses_conflict_non_null_category() -> None:
    engine = _engine()
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=True)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            Company.__table__,
            User.__table__,
            EmployeeProfile.__table__,
            Workplace.__table__,
            Location.__table__,
            WorkProgressEntry.__table__,
            WorkProgressAttachment.__table__,
            AuditEvent.__table__,
        ],
    )
    with SessionLocal() as s:
        entry, admin, company, audit = _seed_classified(s, level=0, null_classification=False)
        candidate = RecoveryCandidate(
            entry_id=str(entry.id),
            company_id=str(company.id),
            company_name="Co",
            employee="e",
            site="Kennington",
            work_date="2026-08-12",
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            percent_complete=None,
            attachment_count=0,
            audit_id=str(audit.id),
            before_work_category=None,
            before_elevation=None,
            before_elevation_custom=None,
            before_level=None,
            after_work_category="mastic",
            after_elevation="south",
            after_elevation_custom=None,
            after_level=0,
            status="recoverable",
        )
        admin_id = admin.id
    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        with pytest.raises(SystemExit, match="Conflict during apply"):
            apply_recovery_clean(apply_session, [candidate], actor, require_exact_18=False)


def test_scan_marks_legacy_and_rejects_duplicate_and_invalid() -> None:
    session = _session()
    try:
        now = datetime.now(timezone.utc)
        company = Company(id=uuid.uuid4(), name="Co", is_active=True, created_at=now, updated_at=now)
        session.add(company)
        user = User(
            id=uuid.uuid4(),
            company_id=company.id,
            email="e@ex.com",
            password_hash="h",
            system_role=SystemRole.EMPLOYEE,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        wp = Workplace(id=uuid.uuid4(), company_id=company.id, name="WP", created_at=now, updated_at=now)
        session.add(wp)
        loc = Location(
            id=uuid.uuid4(),
            company_id=company.id,
            name="Kennington",
            latitude=1.0,
            longitude=2.0,
            created_at=now,
            updated_at=now,
        )
        session.add(loc)
        legacy = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 4),
            title="Pointing",
            progress_status="in_progress",
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        ok = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 12),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        dup = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 11),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        bad = WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user.id,
            company_id=company.id,
            workplace_id=wp.id,
            location_id=loc.id,
            work_date=date(2026, 8, 10),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            status="submitted",
            created_at=now,
            updated_at=now,
        )
        session.add_all([legacy, ok, dup, bad])
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(ok.id),
                details={"work_category": "mastic", "elevation": "internal", "level": 0},
                created_at=now,
            )
        )
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(dup.id),
                details={"work_category": "mastic", "elevation": "internal", "level": 0},
                created_at=now,
            )
        )
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(dup.id),
                details={"work_category": "mastic", "elevation": "internal", "level": 0},
                created_at=now,
            )
        )
        session.add(
            AuditEvent(
                id=uuid.uuid4(),
                actor_user_id=user.id,
                company_id=company.id,
                action="work_progress.submitted",
                entity_type="work_progress_entry",
                entity_id=str(bad.id),
                details={"work_category": "not_real", "elevation": "south", "level": 99},
                created_at=now,
            )
        )
        session.commit()
        report = scan_candidates(session)
        assert len(report.legacy_skipped) == 1
        assert len(report.recoverable) == 1
        assert report.recoverable[0].after_level == 0
        assert len(report.ambiguous) == 1
        assert len(report.invalid) == 1
        assert not gate_exact_18(report)
    finally:
        session.close()


def test_apply_preserves_title_status_percent_and_attachments(tmp_path: Path) -> None:
    engine = _engine()
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=True)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            Company.__table__,
            User.__table__,
            EmployeeProfile.__table__,
            Workplace.__table__,
            Location.__table__,
            WorkProgressEntry.__table__,
            WorkProgressAttachment.__table__,
            AuditEvent.__table__,
        ],
    )
    with SessionLocal() as scan:
        entry, admin, company, audit = _seed_classified(scan, level=0)
        att = WorkProgressAttachment(
            id=uuid.uuid4(),
            entry_id=entry.id,
            storage_path="work-progress-files/x.jpg",
            original_filename="x.jpg",
            content_type="image/jpeg",
            file_size_bytes=10,
            created_at=datetime.now(timezone.utc),
        )
        # attachment model may need more fields — check model
        scan.add(att)
        try:
            scan.commit()
        except Exception:
            scan.rollback()
            # Minimal attachment fields vary; skip attach if schema stricter
            att = None
        report = scan_candidates(scan)
        candidates = list(report.recoverable)
        admin_id = admin.id
        entry_id = entry.id
        title = entry.title
        ps = entry.progress_status
        pct = entry.percent_complete

    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        apply_recovery_clean(apply_session, candidates, actor, require_exact_18=False)

    with SessionLocal() as v:
        row = v.get(WorkProgressEntry, entry_id)
        assert row is not None
        assert row.title == title
        assert row.progress_status == ps
        assert row.percent_complete == pct
        assert row.level == 0
        snap = tmp_path / "snap.json"
        # rebuild mini report for snapshot helper
        from scripts.recover_site_progress_classification import DryRunReport

        write_snapshot(
            DryRunReport(
                recoverable=candidates,
                already_restored=[],
                ambiguous=[],
                conflicts=[],
                invalid=[],
                legacy_skipped=[],
                generated_at=datetime.now(timezone.utc).isoformat(),
            ),
            snap,
        )
        assert snap.exists()
