"""Workplaces API access (no database)."""

from fastapi.testclient import TestClient

from app.main import app


def test_workplaces_list_requires_admin() -> None:
    client = TestClient(app)
    response = client.get("/api/workplaces")
    assert response.status_code == 401


def test_workplaces_create_requires_admin() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/workplaces",
        json={"name": "Test Site", "is_active": True},
    )
    assert response.status_code == 401
