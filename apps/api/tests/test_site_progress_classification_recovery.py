"""Site Progress classification recovery — manifest allowlist and APPLY safety."""

from __future__ import annotations

import inspect
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import models as _models  # noqa: F401
from app.db.base import Base
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
    assert_scan_matches_manifest,
    build_manifest,
    dry_run_is_safe,
    load_manifest,
    scan_candidates,
    verify_recovered_independent,
    write_manifest,
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


def _tables():
    return [
        Company.__table__,
        User.__table__,
        EmployeeProfile.__table__,
        Workplace.__table__,
        Location.__table__,
        WorkProgressEntry.__table__,
        WorkProgressAttachment.__table__,
        AuditEvent.__table__,
    ]


def _session_factory(engine=None):
    engine = engine or _engine()
    Base.metadata.create_all(bind=engine, tables=_tables())
    return engine, sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=True)


def _seed_company(session: Session) -> dict:
    now = datetime.now(timezone.utc)
    company = Company(id=uuid.uuid4(), name=f"Co {uuid.uuid4().hex[:6]}", is_active=True, created_at=now, updated_at=now)
    session.add(company)
    admin = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email=f"admin-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="h",
        system_role=SystemRole.ADMINISTRATOR,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    user = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email=f"emp-{uuid.uuid4().hex[:6]}@ex.com",
        password_hash="h",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add_all([admin, user])
    workplace = Workplace(id=uuid.uuid4(), company_id=company.id, name="WP", created_at=now, updated_at=now)
    session.add(workplace)
    location = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Kennington",
        latitude=51.49,
        longitude=-0.11,
        created_at=now,
        updated_at=now,
    )
    session.add(location)
    session.flush()
    return {
        "company": company,
        "admin": admin,
        "user": user,
        "workplace": workplace,
        "location": location,
        "now": now,
    }


def _add_classified_entry(
    session: Session,
    ctx: dict,
    *,
    category: str = "brickwork_ties",
    elevation: str = "north",
    level: int = 0,
    title: str = "",
    progress_status: str = CLASSIFIED_PROGRESS_STATUS,
    with_submit_audit: bool = True,
    null_classification: bool = True,
    extra_audit: bool = False,
    status: str = "submitted",
    percent_complete: int | None = None,
    created_at: datetime | None = None,
) -> tuple[WorkProgressEntry, AuditEvent | None]:
    now = created_at or ctx["now"]
    entry = WorkProgressEntry(
        id=uuid.uuid4(),
        user_id=ctx["user"].id,
        company_id=ctx["company"].id,
        workplace_id=ctx["workplace"].id,
        location_id=ctx["location"].id,
        work_date=date(2026, 8, 12),
        title=title,
        progress_status=progress_status,
        percent_complete=percent_complete,
        work_category=None if null_classification else category,
        elevation=None if null_classification else elevation,
        elevation_custom=None,
        level=None if null_classification else level,
        status=status,
        created_at=now,
        updated_at=now,
    )
    session.add(entry)
    audit = None
    if with_submit_audit:
        audit = AuditEvent(
            id=uuid.uuid4(),
            actor_user_id=ctx["user"].id,
            company_id=ctx["company"].id,
            action="work_progress.submitted",
            entity_type="work_progress_entry",
            entity_id=str(entry.id),
            details={"work_category": category, "elevation": elevation, "level": level},
            created_at=now,
        )
        session.add(audit)
        if extra_audit:
            session.add(
                AuditEvent(
                    id=uuid.uuid4(),
                    actor_user_id=ctx["user"].id,
                    company_id=ctx["company"].id,
                    action="work_progress.submitted",
                    entity_type="work_progress_entry",
                    entity_id=str(entry.id),
                    details={"work_category": category, "elevation": elevation, "level": level},
                    created_at=now,
                )
            )
    session.flush()
    return entry, audit


def test_parse_level_accepts_zero() -> None:
    assert _parse_level(0) == 0
    assert _parse_level("0") == 0
    assert _parse_level(20) == 20
    assert _parse_level(None) is None
    assert _parse_level(True) is None


def test_script_has_no_hardcoded_18_or_63_gates() -> None:
    src = Path(__file__).resolve().parents[1] / "scripts" / "recover_site_progress_classification.py"
    text = src.read_text(encoding="utf-8")
    assert "gate_exact_18" not in src.read_text(encoding="utf-8")
    assert "require_exact_18" not in text
    assert "len(candidates) != 18" not in text
    assert "len(candidates) != 63" not in text
    assert "already_restored) != 18" not in text
    assert "already_restored) != 63" not in text
    assert "recoverable) == 18" not in text
    assert "recoverable) == 63" not in text
    signature = inspect.signature(apply_recovery_clean)
    assert "require_exact_18" not in signature.parameters
    assert "expected_count" in signature.parameters


def test_same_session_core_update_leaves_stale_orm_null_without_expire() -> None:
    engine, SessionLocal = _session_factory()
    session = SessionLocal()
    try:
        ctx = _seed_company(session)
        entry, _audit = _add_classified_entry(session, ctx, level=0)
        session.commit()
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
            {"c": "brickwork_ties", "e": "north", "l": 0, "id": entry.id.hex},
        )
        session.flush()
        assert loaded.work_category is None
        assert loaded.level is None
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT work_category, level FROM work_progress_entries WHERE replace(id, '-', '') = :id"),
                {"id": entry.id.hex},
            ).one()
        assert row[0] == "brickwork_ties"
        assert row[1] == 0
    finally:
        session.close()


def test_apply_refuses_session_that_already_holds_work_progress_entry() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as session:
        ctx = _seed_company(session)
        entry, audit = _add_classified_entry(session, ctx, level=0)
        session.commit()
        _ = session.get(WorkProgressEntry, entry.id)
        candidate = RecoveryCandidate(
            entry_id=str(entry.id),
            company_id=str(ctx["company"].id),
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
            after_work_category="brickwork_ties",
            after_elevation="north",
            after_elevation_custom=None,
            after_level=0,
            status="recoverable",
        )
        with pytest.raises(SystemExit, match="already holds WorkProgressEntry"):
            apply_recovery_clean(session, [candidate], ctx["admin"], expected_count=1)


def test_manifest_count_is_derived_and_level_zero_apply_verifies_independently(tmp_path: Path) -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        _add_classified_entry(scan, ctx, level=0)
        _add_classified_entry(scan, ctx, category="mastic", elevation="internal", level=0)
        scan.commit()
        report = scan_candidates(scan)
        assert len(report.recoverable) == 2
        assert {row.after_level for row in report.recoverable} == {0}
        assert dry_run_is_safe(report)
        manifest_path = tmp_path / "manifest.json"
        payload = write_manifest(report, manifest_path)
        assert payload["allowlist_count"] == 2
        assert payload["allowlist_count"] == len(payload["allowlist"])
        loaded = load_manifest(manifest_path)
        candidates = assert_scan_matches_manifest(report, loaded)
        admin_id = ctx["admin"].id
        company_id = ctx["company"].id
        title_before = {row.entry_id: row.title for row in candidates}
        status_before = {row.entry_id: row.entry_status for row in candidates}

    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        assert actor is not None
        applied = apply_recovery_clean(apply_session, candidates, actor, expected_count=len(candidates))
        assert len(applied) == 2
        assert {row.level for row in applied} == {0}

    with SessionLocal() as v1:
        exact, mismatches = verify_recovered_independent(v1, candidates)
        assert exact == 2
        assert mismatches == []
        audits = list(
            v1.scalars(select(AuditEvent).where(AuditEvent.action == RECOVERY_ACTION)).all()
        )
        assert len(audits) == 2
        for audit in audits:
            assert audit.details["level"] == 0
            assert audit.details["work_category"] in {"brickwork_ties", "mastic"}

    with SessionLocal() as v2:
        exact2, mismatches2 = verify_recovered_independent(v2, candidates)
        assert exact2 == 2
        assert mismatches2 == []
        rows = list(v2.scalars(select(WorkProgressEntry)).all())
        assert len(rows) == 2
        for row in rows:
            assert row.title == title_before[str(row.id)]
            assert row.progress_status == CLASSIFIED_PROGRESS_STATUS
            assert row.percent_complete is None
            assert row.status == status_before[str(row.id)]
            assert str(row.company_id) == str(company_id)

    with SessionLocal() as idem:
        report2 = scan_candidates(idem)
        assert len(report2.recoverable) == 0
        assert len(report2.already_restored) == 2
        assert report2.ambiguous == []
        assert report2.conflicts == []
        assert report2.invalid == []


def test_apply_only_manifest_ids_extra_row_not_recovered(tmp_path: Path) -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        first, _ = _add_classified_entry(scan, ctx, level=0)
        scan.commit()
        report = scan_candidates(scan)
        payload = write_manifest(report, tmp_path / "manifest.json")
        extra, _ = _add_classified_entry(scan, ctx, category="mastic", elevation="south", level=1)
        scan.commit()
        later = scan_candidates(scan)
        assert len(later.recoverable) == 2
        with pytest.raises(SystemExit, match="live recoverable IDs differ from manifest"):
            assert_scan_matches_manifest(later, payload)
        candidates = [row for row in later.recoverable if row.entry_id == str(first.id)]
        admin_id = ctx["admin"].id
        extra_id = extra.id

    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        apply_recovery_clean(apply_session, candidates, actor, expected_count=len(candidates))

    with SessionLocal() as verify:
        kept = verify.get(WorkProgressEntry, extra_id)
        recovered = verify.get(WorkProgressEntry, uuid.UUID(candidates[0].entry_id))
        assert kept is not None
        assert kept.work_category is None
        assert kept.level is None
        assert recovered is not None
        assert recovered.work_category == "brickwork_ties"
        assert recovered.level == 0


def test_apply_aborts_when_manifest_row_no_longer_null() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        entry, _ = _add_classified_entry(scan, ctx, level=0)
        scan.commit()
        report = scan_candidates(scan)
        candidates = list(report.recoverable)
        admin_id = ctx["admin"].id
        entry_id = entry.id
    with SessionLocal() as dirty:
        row = dirty.get(WorkProgressEntry, entry_id)
        assert row is not None
        row.work_category = "brickwork_ties"
        dirty.commit()
    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        with pytest.raises(SystemExit, match="guarded UPDATE matched 0 rows"):
            apply_recovery_clean(apply_session, candidates, actor, expected_count=1)


def test_apply_aborts_when_manifest_row_missing() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        entry, _ = _add_classified_entry(scan, ctx, level=0)
        scan.commit()
        candidates = list(scan_candidates(scan).recoverable)
        admin_id = ctx["admin"].id
        entry_id = entry.id
    with SessionLocal() as deleter:
        row = deleter.get(WorkProgressEntry, entry_id)
        deleter.delete(row)
        deleter.commit()
    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        with pytest.raises(SystemExit, match="guarded UPDATE matched 0 rows"):
            apply_recovery_clean(apply_session, candidates, actor, expected_count=1)


def test_scan_marks_legacy_duplicate_invalid_and_conflict() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as session:
        ctx = _seed_company(session)
        _add_classified_entry(session, ctx, progress_status="in_progress", with_submit_audit=False)
        _add_classified_entry(session, ctx, category="mastic", elevation="internal", level=0)
        _add_classified_entry(session, ctx, extra_audit=True)
        _add_classified_entry(session, ctx, category="not_real", elevation="south", level=99)
        _add_classified_entry(
            session,
            ctx,
            category="mastic",
            elevation="north",
            level=1,
            null_classification=False,
        )
        conflict_nullish, _ = _add_classified_entry(
            session,
            ctx,
            category="brickwork_ties",
            elevation="west",
            level=0,
            null_classification=True,
        )
        conflict_nullish.work_category = "mastic"
        session.commit()
        report = scan_candidates(session)
        assert len(report.legacy_skipped) == 1
        assert len(report.recoverable) == 1
        assert report.recoverable[0].after_level == 0
        assert len(report.ambiguous) == 1
        assert len(report.invalid) == 1
        assert len(report.conflicts) == 1
        assert len(report.already_restored) == 1
        assert not dry_run_is_safe(report)


def test_invalid_elevation_and_level_are_not_recoverable() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as session:
        ctx = _seed_company(session)
        _add_classified_entry(session, ctx, category="mastic", elevation="not_an_elevation", level=0)
        _add_classified_entry(session, ctx, category="mastic", elevation="south", level=21)
        session.commit()
        report = scan_candidates(session)
        assert len(report.recoverable) == 0
        assert len(report.invalid) == 2


def test_apply_rolls_back_entire_batch_on_conflict() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        first, _ = _add_classified_entry(scan, ctx, level=0)
        second, _ = _add_classified_entry(scan, ctx, category="mastic", elevation="south", level=1)
        scan.commit()
        candidates = list(scan_candidates(scan).recoverable)
        admin_id = ctx["admin"].id
        first_id = first.id
        second_id = second.id
    with SessionLocal() as dirty:
        row = dirty.get(WorkProgressEntry, second_id)
        assert row is not None
        row.work_category = "mastic"
        dirty.commit()
    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        with pytest.raises(SystemExit, match="guarded UPDATE matched 0 rows"):
            apply_recovery_clean(apply_session, candidates, actor, expected_count=2)
    with SessionLocal() as verify:
        first_row = verify.get(WorkProgressEntry, first_id)
        second_row = verify.get(WorkProgressEntry, second_id)
        assert first_row is not None
        assert first_row.work_category is None
        assert first_row.level is None
        assert second_row is not None
        assert second_row.work_category == "mastic"
        audits = list(verify.scalars(select(AuditEvent).where(AuditEvent.action == RECOVERY_ACTION)).all())
        assert audits == []


def test_apply_preserves_title_status_percent_attachments_and_submission_count() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        entry, _ = _add_classified_entry(
            scan,
            ctx,
            level=0,
            title="keep-me",
            percent_complete=40,
            status="submitted",
        )
        att = WorkProgressAttachment(
            id=uuid.uuid4(),
            entry_id=entry.id,
            original_filename="x.jpg",
            content_type="image/jpeg",
            file_size_bytes=10,
            storage_path="work-progress-files/x.jpg",
            created_at=datetime.now(timezone.utc),
        )
        scan.add(att)
        scan.commit()
        candidates = list(scan_candidates(scan).recoverable)
        admin_id = ctx["admin"].id
        entry_id = entry.id
        att_id = att.id
        before_count = scan.scalar(select(func.count()).select_from(WorkProgressEntry))

    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        apply_recovery_clean(apply_session, candidates, actor, expected_count=1)

    with SessionLocal() as verify:
        row = verify.get(WorkProgressEntry, entry_id)
        photo = verify.get(WorkProgressAttachment, att_id)
        assert row is not None
        assert photo is not None
        assert row.title == "keep-me"
        assert row.progress_status == CLASSIFIED_PROGRESS_STATUS
        assert row.percent_complete == 40
        assert row.status == "submitted"
        assert row.level == 0
        assert photo.entry_id == entry_id
        assert photo.original_filename == "x.jpg"
        assert photo.storage_path == "work-progress-files/x.jpg"
        after_count = verify.scalar(select(func.count()).select_from(WorkProgressEntry))
        assert after_count == before_count == 1


def test_expected_count_mismatch_aborts_without_writing() -> None:
    engine, SessionLocal = _session_factory()
    with SessionLocal() as scan:
        ctx = _seed_company(scan)
        _add_classified_entry(scan, ctx, level=0)
        scan.commit()
        candidates = list(scan_candidates(scan).recoverable)
        admin_id = ctx["admin"].id
    with SessionLocal() as apply_session:
        actor = apply_session.get(User, admin_id)
        with pytest.raises(SystemExit, match="candidate count"):
            apply_recovery_clean(apply_session, candidates, actor, expected_count=2)
