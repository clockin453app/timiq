"""Toolbox talks API smoke tests (no database)."""

from fastapi.testclient import TestClient

from app.main import app
from app.modules.toolbox_talks.service import list_topic_options, list_topic_templates


def test_toolbox_talk_routes_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/toolbox-talks/topics" in paths
    assert "/api/toolbox-talks/templates" in paths
    assert "/api/toolbox-talks/me" in paths
    assert "/api/toolbox-talks/{talk_id}/export.csv" in paths
    assert "/api/toolbox-talks/{talk_id}/pdf" in paths


def test_topics_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/toolbox-talks/topics")
    assert response.status_code == 401


def test_templates_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/toolbox-talks/templates")
    assert response.status_code == 401


def test_list_talks_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/toolbox-talks")
    assert response.status_code == 401


def test_list_topic_templates_non_empty() -> None:
    tpls = list_topic_templates()
    assert len(tpls) >= 10
    assert tpls[0].topic
    assert tpls[0].default_body


def test_list_topic_options_includes_custom() -> None:
    opts = list_topic_options()
    values = {o.value for o in opts}
    assert "custom" in values
    assert "ppe" in values
