"""Alembic migration verification for budget tasks and project notes phase 4."""

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
        / "e7f8a9b0c1d2_budget_tasks_notes_phase4.py"
    )
    spec = importlib.util.spec_from_file_location("budget_tasks_notes_phase4_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_budget_tasks_notes_migration_metadata() -> None:
    migration = _load_migration_module()
    assert migration.down_revision == "d6e7f8a9b0c1"
    assert migration.revision == "e7f8a9b0c1d2"
    src = Path(
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "e7f8a9b0c1d2_budget_tasks_notes_phase4.py"
    ).read_text(encoding="utf-8")
    assert "budget_tasks" in src
    assert "budget_project_notes" in src
    assert "ck_budget_tasks_status" in src
    assert "ck_budget_tasks_priority" in src
    assert "ck_budget_tasks_category" in src
    assert "client_action_id IS NOT NULL" in src
    assert "uq_budget_tasks_company_client_action" in src
    assert "uq_budget_project_notes_company_client_action" in src
    assert "ix_budget_tasks_company_budget_status" in src
    assert "ix_budget_tasks_due_date" in src
    assert "ix_budget_tasks_assignee_user_id" in src
    assert "ix_budget_tasks_priority" in src
    assert "ix_budget_project_notes_pinned_created" in src
    assert "is_pinned" in src
    assert "assignee_user_id" in src
    assert "completed_at" in src
    assert "cancelled_at" in src


def test_budget_tasks_notes_migration_postgres_if_available() -> None:
    try:
        import psycopg  # noqa: F401
    except Exception:
        pytest.skip("psycopg unavailable")

    admin_dsn = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_name = "timiq_disposable_budget_tasks_mig"
    db_user = "timiq_budget_tasks_mig"
    db_pass = "timiq_budget_tasks_mig_pw"
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
        subprocess.run([*cmd_prefix, "upgrade", "d6e7f8a9b0c1"], cwd=repo_root, env=env, check=True)
        engine = create_engine(app_dsn)

        subprocess.run([*cmd_prefix, "upgrade", "e7f8a9b0c1d2"], cwd=repo_root, env=env, check=True)

        with engine.connect() as conn:
            tables = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select table_name from information_schema.tables
                        where table_schema='public'
                          and table_name in ('budget_tasks', 'budget_project_notes')
                        """
                    )
                )
            }
            assert tables == {"budget_tasks", "budget_project_notes"}

            checks = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select conname from pg_constraint
                        where conname in (
                          'ck_budget_tasks_status',
                          'ck_budget_tasks_priority',
                          'ck_budget_tasks_category'
                        )
                        """
                    )
                )
            }
            assert checks == {
                "ck_budget_tasks_status",
                "ck_budget_tasks_priority",
                "ck_budget_tasks_category",
            }

            idx = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select indexname from pg_indexes
                        where tablename in ('budget_tasks', 'budget_project_notes')
                          and indexname in (
                            'uq_budget_tasks_company_client_action',
                            'uq_budget_project_notes_company_client_action',
                            'ix_budget_tasks_company_budget_status',
                            'ix_budget_project_notes_pinned_created'
                          )
                        """
                    )
                )
            }
            assert "uq_budget_tasks_company_client_action" in idx
            assert "uq_budget_project_notes_company_client_action" in idx
            assert "ix_budget_tasks_company_budget_status" in idx
            assert "ix_budget_project_notes_pinned_created" in idx

            task_cols = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select column_name from information_schema.columns
                        where table_schema='public' and table_name='budget_tasks'
                        """
                    )
                )
            }
            for required in (
                "client_action_id",
                "title",
                "status",
                "priority",
                "category",
                "due_date",
                "assignee_user_id",
                "completed_at",
                "cancelled_at",
            ):
                assert required in task_cols

            note_cols = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        select column_name from information_schema.columns
                        where table_schema='public' and table_name='budget_project_notes'
                        """
                    )
                )
            }
            for required in ("client_action_id", "body", "is_pinned", "created_at"):
                assert required in note_cols

        subprocess.run([*cmd_prefix, "downgrade", "d6e7f8a9b0c1"], cwd=repo_root, env=env, check=True)
        with engine.connect() as conn:
            gone = conn.execute(
                text(
                    """
                    select count(*) from information_schema.tables
                    where table_schema='public'
                      and table_name in ('budget_tasks', 'budget_project_notes')
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
