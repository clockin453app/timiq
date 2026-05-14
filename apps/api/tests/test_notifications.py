"""Notification summary API smoke tests (no database)."""

from fastapi.testclient import TestClient

from app.main import app


def test_notifications_summary_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/notifications/summary" in paths


def test_notifications_summary_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/notifications/summary")
    assert response.status_code == 401
