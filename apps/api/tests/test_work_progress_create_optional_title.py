"""Updated create request: classification required; legacy title optional."""

from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.work_progress.schemas import WorkProgressCreateRequest


def test_create_request_requires_work_date_location_and_classification():
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(
            location_id=uuid4(),
            work_category="insulation",
            elevation="north",
            level=1,
        )
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(
            work_date=date(2026, 7, 31),
            work_category="insulation",
            elevation="north",
            level=1,
        )
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(
            work_date=date(2026, 7, 31),
            location_id=uuid4(),
            elevation="north",
            level=1,
        )


def test_create_request_accepts_classification_without_legacy_title():
    body = WorkProgressCreateRequest(
        work_date=date(2026, 7, 31),
        location_id=uuid4(),
        work_category="insulation",
        elevation="north_east",
        level=3,
        notes=None,
    )
    assert body.title == ""
    assert body.work_category == "insulation"
    assert body.elevation == "north_east"
    assert body.level == 3
    assert body.percent_complete is None


def test_create_request_rejects_level_out_of_range():
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(
            work_date=date(2026, 7, 31),
            location_id=uuid4(),
            work_category="dpc",
            elevation="north",
            level=21,
        )


def test_create_request_title_defaults_to_empty_when_omitted():
    body = WorkProgressCreateRequest(
        work_date=date(2026, 7, 31),
        location_id=uuid4(),
        work_category="cavity",
        elevation="front",
        level=0,
    )
    assert body.title == ""
