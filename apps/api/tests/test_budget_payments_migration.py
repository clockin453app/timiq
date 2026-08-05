"""Alembic migration verification for budget invoice payments phase 2."""

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
        / "d6e7f8a9b0c1_budget_invoice_payments_phase2.py"
    )
    spec = importlib.util.spec_from_file_location("budget_payments_phase2_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_budget_payments_migration_metadata() -> None:
    migration = _load_migration_module()
    assert migration.down_revision == "c5d6e7f8a9b0"
    assert migration.revision == "d6e7f8a9b0c1"
    src = Path(
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "d6e7f8a9b0c1_budget_invoice_payments_phase2.py"
    ).read_text(encoding="utf-8")
    assert "budget_invoice_payments" in src
    assert "ck_budget_invoice_payments_amount_positive" in src
    assert "amount > 0" in src
    assert "client_action_id IS NOT NULL" in src
    assert "uq_budget_invoice_payments_company_client_action" in src
    assert "ix_budget_invoice_payments_invoice_id" in src
    assert "ix_budget_invoice_payments_company_budget" in src
    assert "ix_budget_invoice_payments_payment_date" in src
    assert "ix_budget_invoice_payments_company_id" in src
    assert "reversed_at" in src
    assert "payment_method" in src


def test_budget_payments_migration_postgres_if_available() -> None:
    try:
        import psycopg  # noqa: F401
    except Exception:
        pytest.skip("psycopg unavailable")

    admin_dsn = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_name = "timiq_disposable_budget_payments_mig"
    db_user = "timiq_budget_payments_mig"
    db_pass = "timiq_budget_payments_mig_pw"
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
        subprocess.run([*cmd_prefix, "upgrade", "c5d6e7f8a9b0"], cwd=repo_root, env=env, check=True)
        engine = create_engine(app_dsn)

        subprocess.run([*cmd_prefix, "upgrade", "d6e7f8a9b0c1"], cwd=repo_root, env=env, check=True)

        with engine.connect() as conn:
            tables = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select table_name from information_schema.tables
                        where table_schema='public'
                          and table_name = 'budget_invoice_payments'
                        """
                    )
                )
            }
            assert tables == {"budget_invoice_payments"}

            check = conn.execute(
                text(
                    """
                    select conname from pg_constraint
                    where conname = 'ck_budget_invoice_payments_amount_positive'
                    """
                )
            ).scalar()
            assert check == "ck_budget_invoice_payments_amount_positive"

            idx = conn.execute(
                text(
                    """
                    select indexname from pg_indexes
                    where tablename='budget_invoice_payments'
                      and indexname='uq_budget_invoice_payments_company_client_action'
                    """
                )
            ).scalar()
            assert idx == "uq_budget_invoice_payments_company_client_action"

            cols = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select column_name from information_schema.columns
                        where table_schema='public'
                          and table_name='budget_invoice_payments'
                        """
                    )
                )
            }
            for required in (
                "payment_date",
                "amount",
                "currency",
                "payment_method",
                "reversed_at",
                "reversed_by_user_id",
                "reversal_reason",
                "client_action_id",
            ):
                assert required in cols

        subprocess.run([*cmd_prefix, "downgrade", "c5d6e7f8a9b0"], cwd=repo_root, env=env, check=True)
        with engine.connect() as conn:
            gone = conn.execute(
                text(
                    """
                    select count(*) from information_schema.tables
                    where table_schema='public'
                      and table_name='budget_invoice_payments'
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
