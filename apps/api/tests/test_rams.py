"""RAMS / risk assessments API smoke tests (no database)."""

from fastapi.testclient import TestClient

from app.main import app
from app.modules.rams.constants import risk_band, risk_score
from app.modules.rams.service import get_presets


def test_rams_routes_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/rams/presets" in paths
    assert "/api/rams/me" in paths
    assert "/api/rams/{assessment_id}/export.csv" in paths


def test_rams_presets_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/rams/presets")
    assert response.status_code == 401


def test_rams_list_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/rams")
    assert response.status_code == 401


def test_risk_score_and_band() -> None:
    assert risk_score(3, 4) == 12
    assert risk_band(4) == "low"
    assert risk_band(8) == "medium"
    assert risk_band(12) == "high"
    assert risk_band(20) == "critical"


def test_presets_non_empty() -> None:
    p = get_presets()
    assert len(p.hazard_examples) >= 5
    assert len(p.ppe_options) >= 5
