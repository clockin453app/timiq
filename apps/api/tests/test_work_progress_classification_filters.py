"""Site Progress review filters: work_category / elevation / level + classification search."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.main import app
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.locations.models import Location
from app.modules.work_progress.classification import (
    CLASSIFIED_PROGRESS_STATUS,
    ELEVATION_OPTIONS,
    WORK_CATEGORY_OPTIONS,
)
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.repository import (
    _classification_values_matching_search,
    _levels_matching_search,
    list_review_entries,
)
from app.modules.work_progress.service import (
    WorkProgressValidationError,
    _normalize_review_classification_filters,
    list_review,
)
from app.modules.workplaces.models import Workplace


def test_exact_north_search_does_not_match_north_east() -> None:
    assert _classification_values_matching_search(ELEVATION_OPTIONS, "North") == ["north"]
    assert _classification_values_matching_search(ELEVATION_OPTIONS, "north") == ["north"]
    assert "north_east" not in _classification_values_matching_search(ELEVATION_OPTIONS, "North")
    assert "north_west" not in _classification_values_matching_search(ELEVATION_OPTIONS, "North")


def test_brickwork_substring_matches_level_and_ties() -> None:
    values = _classification_values_matching_search(WORK_CATEGORY_OPTIONS, "Brickwork")
    assert set(values) == {"brickwork_level", "brickwork_ties"}


def test_levels_matching_search_maps_display_to_int() -> None:
    assert _levels_matching_search("Level 00") == [0]
    assert _levels_matching_search("Level 07") == [7]
    assert _levels_matching_search("Level 20") == [20]
    assert _levels_matching_search("21") == []
    assert _levels_matching_search("Level 99") == []


def test_normalize_review_classification_filters_validates() -> None:
    assert _normalize_review_classification_filters(
        work_category="brickwork_level",
        elevation="south",
        level=0,
    ) == ("brickwork_level", "south", 0)
    with pytest.raises(WorkProgressValidationError, match="work category"):
        _normalize_review_classification_filters(
            work_category="not_a_category",
            elevation=None,
            level=None,
        )
    with pytest.raises(WorkProgressValidationError, match="elevation"):
        _normalize_review_classification_filters(
            work_category=None,
            elevation="North",
            level=None,
        )
    with pytest.raises(WorkProgressValidationError, match="Level filter"):
        _normalize_review_classification_filters(
            work_category=None,
            elevation=None,
            level=21,
        )


def _sqlite_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [
        Company.__table__,
        User.__table__,
        Workplace.__table__,
        Location.__table__,
        WorkProgressEntry.__table__,
        WorkProgressAttachment.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    return factory()


def _seed_world(session: Session) -> dict:
    now = datetime.now(timezone.utc)
    company = Company(
        id=uuid.uuid4(),
        name="Filter Co",
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    other_company = Company(
        id=uuid.uuid4(),
        name="Other Co",
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add_all([company, other_company])
    owner = User(
        id=uuid.uuid4(),
        company_id=company.id,
        email="owner@example.com",
        password_hash="h",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    other_owner = User(
        id=uuid.uuid4(),
        company_id=other_company.id,
        email="other@example.com",
        password_hash="h",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add_all([owner, other_owner])
    workplace = Workplace(
        id=uuid.uuid4(),
        company_id=company.id,
        name="WP",
        created_at=now,
        updated_at=now,
    )
    other_wp = Workplace(
        id=uuid.uuid4(),
        company_id=other_company.id,
        name="Other WP",
        created_at=now,
        updated_at=now,
    )
    session.add_all([workplace, other_wp])
    kennington = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Kennington",
        latitude=51.49,
        longitude=-0.11,
        created_at=now,
        updated_at=now,
    )
    other_site = Location(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Different Site",
        latitude=51.5,
        longitude=-0.12,
        created_at=now,
        updated_at=now,
    )
    foreign_site = Location(
        id=uuid.uuid4(),
        company_id=other_company.id,
        name="Foreign",
        latitude=51.51,
        longitude=-0.13,
        created_at=now,
        updated_at=now,
    )
    session.add_all([kennington, other_site, foreign_site])
    session.flush()

    def classified(
        *,
        key: str,
        category: str,
        elevation: str,
        level: int,
        location_id: uuid.UUID,
        company_id: uuid.UUID | None = None,
        elevation_custom: str | None = None,
        user_id: uuid.UUID | None = None,
        status: str = "submitted",
    ) -> WorkProgressEntry:
        return WorkProgressEntry(
            id=uuid.uuid4(),
            user_id=user_id or owner.id,
            company_id=company_id or company.id,
            workplace_id=workplace.id if (company_id or company.id) == company.id else other_wp.id,
            location_id=location_id,
            work_date=date(2026, 8, 1),
            title="",
            progress_status=CLASSIFIED_PROGRESS_STATUS,
            notes=key,
            percent_complete=None,
            work_category=category,
            elevation=elevation,
            elevation_custom=elevation_custom,
            level=level,
            status=status,
            created_at=now,
            updated_at=now,
        )

    a = classified(
        key="A",
        category="brickwork_level",
        elevation="south",
        level=0,
        location_id=kennington.id,
    )
    b = classified(
        key="B",
        category="brickwork_level",
        elevation="north",
        level=0,
        location_id=kennington.id,
    )
    c = classified(
        key="C",
        category="blockwork_ties",
        elevation="north",
        level=0,
        location_id=kennington.id,
    )
    d = classified(
        key="D",
        category="brickwork_level",
        elevation="south",
        level=3,
        location_id=kennington.id,
    )
    e = classified(
        key="E",
        category="brickwork_level",
        elevation="south",
        level=0,
        location_id=other_site.id,
    )
    custom = classified(
        key="CUSTOM",
        category="insulation",
        elevation="custom",
        level=4,
        location_id=kennington.id,
        elevation_custom="Elevation A",
    )
    historical = WorkProgressEntry(
        id=uuid.uuid4(),
        user_id=owner.id,
        company_id=company.id,
        workplace_id=workplace.id,
        location_id=kennington.id,
        work_date=date(2026, 7, 1),
        title="Legacy brick cavity photos",
        progress_status="in_progress",
        notes="HIST",
        percent_complete=40,
        work_category=None,
        elevation=None,
        elevation_custom=None,
        level=None,
        status="submitted",
        created_at=now,
        updated_at=now,
    )
    foreign = classified(
        key="FOREIGN",
        category="brickwork_level",
        elevation="south",
        level=0,
        location_id=foreign_site.id,
        company_id=other_company.id,
        user_id=other_owner.id,
    )
    session.add_all([a, b, c, d, e, custom, historical, foreign])
    session.commit()
    return {
        "company": company,
        "other_company": other_company,
        "owner": owner,
        "kennington": kennington,
        "other_site": other_site,
        "ids": {
            "A": a.id,
            "B": b.id,
            "C": c.id,
            "D": d.id,
            "E": e.id,
            "CUSTOM": custom.id,
            "HIST": historical.id,
            "FOREIGN": foreign.id,
        },
    }


def _ids(rows: list[WorkProgressEntry]) -> set[uuid.UUID]:
    return {row.id for row in rows}


def test_combined_classification_and_site_filters() -> None:
    session = _sqlite_session()
    try:
        world = _seed_world(session)
        ids = world["ids"]
        company_id = world["company"].id
        kennington = world["kennington"].id

        def query(**kwargs):
            rows, total = list_review_entries(
                session,
                company_id_filter=company_id,
                user_id_filter=None,
                location_id_filter=kwargs.get("location_id"),
                status_filter=None,
                date_from=None,
                date_to=None,
                title_search=kwargs.get("title_search"),
                limit=50,
                offset=0,
                work_category=kwargs.get("work_category"),
                elevation=kwargs.get("elevation"),
                level=kwargs.get("level"),
            )
            return _ids(rows), total

        got, total = query(work_category="brickwork_level")
        assert got == {ids["A"], ids["B"], ids["D"], ids["E"]}
        assert total == 4

        got, total = query(elevation="south")
        assert got == {ids["A"], ids["D"], ids["E"]}
        assert total == 3

        got, total = query(level=0)
        assert got == {ids["A"], ids["B"], ids["C"], ids["E"]}
        assert total == 4

        got, _ = query(work_category="brickwork_level", elevation="south")
        assert got == {ids["A"], ids["D"], ids["E"]}

        got, _ = query(work_category="brickwork_level", elevation="south", level=0)
        assert got == {ids["A"], ids["E"]}

        got, total = query(
            location_id=kennington,
            work_category="brickwork_level",
            elevation="south",
            level=0,
        )
        assert got == {ids["A"]}
        assert total == 1

        got, _ = query(elevation="custom")
        assert got == {ids["CUSTOM"]}

        got, _ = query(title_search="Elevation A")
        assert ids["CUSTOM"] in got

        got, _ = query(title_search="Brickwork")
        assert got >= {ids["A"], ids["B"], ids["D"], ids["E"]}
        assert ids["C"] not in got

        got, _ = query(title_search="South")
        assert got == {ids["A"], ids["D"], ids["E"]}

        got, _ = query(title_search="Level 00")
        assert got == {ids["A"], ids["B"], ids["C"], ids["E"]}

        got, _ = query(title_search="Legacy brick")
        assert got == {ids["HIST"]}

        # Structured filter excludes unclassified historical rows.
        got, _ = query(work_category="insulation")
        assert got == {ids["CUSTOM"]}
        assert ids["HIST"] not in got

        # Company isolation: foreign brickwork_level/south/0 never appears.
        got, _ = query(work_category="brickwork_level", elevation="south", level=0)
        assert ids["FOREIGN"] not in got

        rows, total = list_review_entries(
            session,
            company_id_filter=company_id,
            user_id_filter=None,
            location_id_filter=None,
            status_filter=None,
            date_from=None,
            date_to=None,
            title_search=None,
            limit=2,
            offset=0,
            work_category="brickwork_level",
        )
        assert total == 4
        assert len(rows) == 2
        rows2, total2 = list_review_entries(
            session,
            company_id_filter=company_id,
            user_id_filter=None,
            location_id_filter=None,
            status_filter=None,
            date_from=None,
            date_to=None,
            title_search=None,
            limit=2,
            offset=2,
            work_category="brickwork_level",
        )
        assert total2 == 4
        assert len(rows2) == 2
        assert _ids(rows).isdisjoint(_ids(rows2))
    finally:
        session.close()


def test_list_review_forwards_classification_filters() -> None:
    company_id = uuid.uuid4()
    actor = User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="admin@example.com",
        password_hash="h",
        system_role=SystemRole.ADMIN,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with (
        patch(
            "app.modules.work_progress.service._resolve_review_list_filters",
            return_value=(company_id, None, None, None, None, None),
        ),
        patch(
            "app.modules.work_progress.service.list_review_entries",
            return_value=([], 0),
        ) as list_entries,
        patch("app.modules.work_progress.service.count_attachments_for_entry_ids", return_value={}),
    ):
        list_review(
            MagicMock(),
            actor,
            company_id=None,
            user_id=None,
            location_id=None,
            status_filter=None,
            include_archived=False,
            date_from=None,
            date_to=None,
            title_search="Brickwork",
            work_category="brickwork_level",
            elevation="south",
            level=0,
            limit=25,
            offset=0,
        )
    assert list_entries.call_args.kwargs["work_category"] == "brickwork_level"
    assert list_entries.call_args.kwargs["elevation"] == "south"
    assert list_entries.call_args.kwargs["level"] == 0
    assert list_entries.call_args.kwargs["title_search"] == "Brickwork"


def test_review_api_rejects_invalid_classification_filters() -> None:
    from app.db.session import get_db_session

    admin = User(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="admin@example.com",
        password_hash="h",
        system_role=SystemRole.ADMIN,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    app.dependency_overrides[get_db_session] = lambda: MagicMock()
    client = TestClient(app)
    try:
        bad_category = client.get("/api/work-progress/review?work_category=not_real")
        assert bad_category.status_code == 400
        bad_elevation = client.get("/api/work-progress/review?elevation=North")
        assert bad_elevation.status_code == 400
        bad_level = client.get("/api/work-progress/review?level=21")
        assert bad_level.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_category_matrix_values_are_accepted_by_normalizer() -> None:
    for value, _label in WORK_CATEGORY_OPTIONS:
        assert _normalize_review_classification_filters(
            work_category=value, elevation=None, level=None
        )[0] == value
    for value, _label in ELEVATION_OPTIONS:
        assert _normalize_review_classification_filters(
            work_category=None, elevation=value, level=None
        )[1] == value
    for level in (0, 1, 9, 10, 20):
        assert _normalize_review_classification_filters(
            work_category=None, elevation=None, level=level
        )[2] == level
