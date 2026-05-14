"""Messaging group conversation API smoke tests (no database)."""

from fastapi.testclient import TestClient

from app.main import app


def test_messaging_participants_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/messaging/conversations/{conversation_id}/participants" in paths


def test_messaging_participants_requires_auth() -> None:
    client = TestClient(app)
    r = client.post("/api/messaging/conversations/00000000-0000-4000-8000-000000000001/participants", json={"user_ids": []})
    assert r.status_code == 401
