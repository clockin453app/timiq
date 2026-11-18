"""Preview mode is an explicit switch and does not follow TIMIQ_ENV."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.finance.access import finance_preview_readonly
from app.modules.finance.router import reject_preview_mutation


def test_local_environment_is_not_preview(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FINANCE_PREVIEW_MODE", raising=False)
    monkeypatch.setenv("TIMIQ_ENV", "local")
    assert finance_preview_readonly() is False


def test_readonly_flag_blocks_changes_for_every_role(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    assert finance_preview_readonly() is True
    # Hard-blocked path (not in scoped soft-path allowlist).
    for method in ("POST", "PUT", "PATCH", "DELETE", "TRACE"):
        with pytest.raises(HTTPException) as denied:
            reject_preview_mutation(SimpleNamespace(method=method, url=SimpleNamespace(path="/api/finance/projects")))  # type: ignore[arg-type]
        assert denied.value.status_code == 403
    # Soft-path ledger routes continue past the guard; assert_finance_write enforces allowlists.
    reject_preview_mutation(SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/finance/cost-documents")))  # type: ignore[arg-type]
    for method in ("GET", "HEAD", "OPTIONS"):
        reject_preview_mutation(SimpleNamespace(method=method, url=SimpleNamespace(path="/api/finance/dashboard")))  # type: ignore[arg-type]


def test_both_finance_routers_apply_the_preview_guard() -> None:
    from app.modules.finance.commercial_router import reject_preview_mutation as commercial_guard
    from app.modules.finance.commercial_router import router as commercial_router
    from app.modules.finance.router import router as ledger_router

    for finance_router, guard in (
        (ledger_router, reject_preview_mutation),
        (commercial_router, commercial_guard),
    ):
        assert any(getattr(item, "dependency", None) is guard for item in finance_router.dependencies)
        mutation_routes = [
            route
            for route in finance_router.routes
            if getattr(route, "methods", None) and route.methods - {"GET", "HEAD", "OPTIONS"}
        ]
        assert mutation_routes
        assert all(finance_router.dependencies for _route in mutation_routes)
