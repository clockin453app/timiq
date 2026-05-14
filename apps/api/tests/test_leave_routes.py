"""Leave API route registration (no database)."""

from fastapi.testclient import TestClient

from app.main import app


def test_leave_routes_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/leave/me" in paths
    assert "/api/leave/me/summary" in paths
    assert "/api/leave/policy" in paths
    assert "/api/leave/requests" in paths
    assert "/api/leave/balance-adjustments" in paths


def test_leave_me_requires_auth() -> None:
    client = TestClient(app)
    assert client.get("/api/leave/me").status_code == 401
    assert client.get("/api/leave/me/summary").status_code == 401
