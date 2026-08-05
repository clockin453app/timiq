"""Alembic migration safety for shift client_action_id."""

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
        / "b3c4d5e6f7a8_shift_integrity_client_action_id.py"
    )
    spec = importlib.util.spec_from_file_location("shift_integrity_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_shift_integrity_migration_metadata() -> None:
    migration = _load_migration_module()
    assert migration.down_revision == "a1b2c3d4e5f8"
    assert migration.revision == "b3c4d5e6f7a8"
    src = Path(
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "b3c4d5e6f7a8_shift_integrity_client_action_id.py"
    ).read_text(encoding="utf-8")
    assert "nullable=True" in src
    assert "client_action_id IS NOT NULL" in src


def test_shift_integrity_migration_postgres_with_existing_duplicates() -> None:
    try:
        import psycopg  # noqa: F401
    except Exception:
        pytest.skip("psycopg unavailable")

    admin_dsn = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_name = "timiq_disposable_shift_integrity_mig"
    db_user = "timiq_shift_integrity_mig"
    db_pass = "timiq_shift_integrity_mig_pw"
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

    subprocess.run([*cmd_prefix, "upgrade", "a1b2c3d4e5f8"], cwd=repo_root, env=env, check=True)

    engine = create_engine(app_dsn)
    with engine.begin() as conn:
        # Minimal historical duplicate rows must not block nullable client_action_id migration.
        conn.execute(
            text(
                """
                INSERT INTO companies (id, name, is_active, created_at, updated_at)
                VALUES (gen_random_uuid(), 'Dup Co', true, now(), now())
                """
            )
        )

    subprocess.run([*cmd_prefix, "upgrade", "b3c4d5e6f7a8"], cwd=repo_root, env=env, check=True)
    with engine.connect() as conn:
        nullable = conn.execute(
            text(
                """
                select is_nullable
                from information_schema.columns
                where table_schema='public'
                  and table_name='time_shifts'
                  and column_name='client_action_id'
                """
            )
        ).scalar_one()
        assert nullable == "YES"
        indexdef = conn.execute(
            text(
                """
                select indexdef
                from pg_indexes
                where schemaname='public'
                  and tablename='time_shifts'
                  and indexname='uq_time_shifts_company_client_action'
                """
            )
        ).scalar_one()
        assert "client_action_id IS NOT NULL" in indexdef

    subprocess.run([*cmd_prefix, "downgrade", "a1b2c3d4e5f8"], cwd=repo_root, env=env, check=True)
    subprocess.run([*cmd_prefix, "upgrade", "b3c4d5e6f7a8"], cwd=repo_root, env=env, check=True)
