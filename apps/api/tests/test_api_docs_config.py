"""API documentation availability by environment."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import config
from app.core.health import router as health_router
from app.main import _api_docs_enabled


def test_docs_enabled_outside_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "app_env", "local")
    assert _api_docs_enabled() is True
    monkeypatch.setattr(config.settings, "app_env", "test")
    assert _api_docs_enabled() is True


def test_docs_disabled_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "app_env", "production")
    assert _api_docs_enabled() is False
    monkeypatch.setattr(config.settings, "app_env", "prod")
    assert _api_docs_enabled() is False


def _app_with_docs(enabled: bool) -> FastAPI:
    application = FastAPI(
        title="TimIQ API test",
        version="0.1.0",
        docs_url="/docs" if enabled else None,
        redoc_url="/redoc" if enabled else None,
        openapi_url="/openapi.json" if enabled else None,
    )
    application.include_router(health_router)
    return application


def test_production_docs_endpoints_are_404() -> None:
    client = TestClient(_app_with_docs(False))
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/health").status_code == 200
    assert client.get("/health").json()["status"] == "ok"


def test_development_docs_endpoints_are_available() -> None:
    client = TestClient(_app_with_docs(True))
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/health").status_code == 200
