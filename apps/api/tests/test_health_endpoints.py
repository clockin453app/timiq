"""Public health endpoints (no DB)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_root() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_healthz_public() -> None:
    r = client.get("/api/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert "server_time" in body
