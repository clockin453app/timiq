"""Alembic migration verification for budget customer billing phase 1."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess

import pytest
from sqlalchemy import create_engine, text


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "c5d6e7f8a9b0_budget_customer_billing_phase1.py"
    )
    spec = importlib.util.spec_from_file_location("budget_billing_phase1_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_budget_billing_migration_metadata() -> None:
    migration = _load_migration_module()
    assert migration.down_revision == "b3c4d5e6f7a8"
    assert migration.revision == "c5d6e7f8a9b0"
    src = Path(
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "c5d6e7f8a9b0_budget_customer_billing_phase1.py"
    ).read_text(encoding="utf-8")
    assert "contract_value_net" in src
    assert "billing_currency" in src
    assert "void_reason" in src
    assert "invoice_number IS NOT NULL" in src
    assert "client_action_id IS NOT NULL" in src
    assert "is_current = true" in src
    assert "ck_budget_customer_invoices_net_amount_nonneg" in src


def test_budget_billing_migration_postgres_if_available() -> None:
    try:
        import psycopg  # noqa: F401
    except Exception:
        pytest.skip("psycopg unavailable")

    admin_dsn = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_name = "timiq_disposable_budget_billing_mig"
    db_user = "timiq_budget_billing_mig"
    db_pass = "timiq_budget_billing_mig_pw"
    app_dsn = f"postgresql+psycopg://{db_user}:{db_pass}@localhost:5432/{db_name}"

    try:
        with psycopg.connect(admin_dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP DATABASE IF EXISTS {db_name}")
                cur.execute(f"DROP ROLE IF EXISTS {db_user}")
                cur.execute(f"CREATE ROLE {db_user} LOGIN PASSWORD '{db_pass}'")
                cur.execute(f"CREATE DATABASE {db_name} OWNER {db_user}")
    except Exception as exc:
        pytest.skip(f"local postgres unavailable: {exc}")

    repo_root = Path(__file__).resolve().parents[3]
    api_root = repo_root / "apps" / "api"
    env = os.environ.copy()
    env["DATABASE_URL"] = app_dsn
    env["PYTHONPATH"] = str(api_root)
    cmd_prefix = ["python", "-m", "alembic", "-c", str(api_root / "alembic.ini")]

    try:
        subprocess.run([*cmd_prefix, "upgrade", "b3c4d5e6f7a8"], cwd=repo_root, env=env, check=True)
        engine = create_engine(app_dsn)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO companies (id, name, is_active, created_at, updated_at)
                    VALUES (gen_random_uuid(), 'Billing Co', true, now(), now())
                    """
                )
            )
            # Existing budget without contract value must remain NULL after migration.
            conn.execute(
                text(
                    """
                    INSERT INTO budget_projects (
                      id, company_id, name, planned_budget_amount, status, created_at, updated_at
                    )
                    SELECT gen_random_uuid(), id, 'Legacy Job', 1000, 'active', now(), now()
                    FROM companies LIMIT 1
                    """
                )
            )

        subprocess.run([*cmd_prefix, "upgrade", "c5d6e7f8a9b0"], cwd=repo_root, env=env, check=True)

        with engine.connect() as conn:
            nullable = conn.execute(
                text(
                    """
                    select is_nullable
                    from information_schema.columns
                    where table_schema='public'
                      and table_name='budget_projects'
                      and column_name='contract_value_net'
                    """
                )
            ).scalar_one()
            assert nullable == "YES"
            contract = conn.execute(
                text("select contract_value_net from budget_projects limit 1")
            ).scalar_one()
            assert contract is None

            tables = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select table_name from information_schema.tables
                        where table_schema='public'
                          and table_name in ('budget_customer_invoices', 'budget_invoice_documents')
                        """
                    )
                )
            }
            assert tables == {"budget_customer_invoices", "budget_invoice_documents"}

            idx = conn.execute(
                text(
                    """
                    select indexname from pg_indexes
                    where tablename='budget_customer_invoices'
                      and indexname='uq_budget_customer_invoices_company_invoice_number'
                    """
                )
            ).scalar()
            assert idx == "uq_budget_customer_invoices_company_invoice_number"

        subprocess.run([*cmd_prefix, "downgrade", "b3c4d5e6f7a8"], cwd=repo_root, env=env, check=True)
        with engine.connect() as conn:
            gone = conn.execute(
                text(
                    """
                    select count(*) from information_schema.columns
                    where table_schema='public'
                      and table_name='budget_projects'
                      and column_name='contract_value_net'
                    """
                )
            ).scalar_one()
            assert gone == 0
        engine.dispose()
    finally:
        try:
            with psycopg.connect(admin_dsn, autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute(f"DROP DATABASE IF EXISTS {db_name}")
                    cur.execute(f"DROP ROLE IF EXISTS {db_user}")
        except Exception:
            pass
