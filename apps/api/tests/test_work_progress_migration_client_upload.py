"""Alembic migration safety for work progress client_upload_id."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "a1b2c3d4e5f8_work_progress_client_upload_id.py"
    )
    spec = importlib.util.spec_from_file_location("wp_client_upload_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_client_upload_migration_metadata() -> None:
    migration = _load_migration_module()
    assert migration.down_revision == "c2d3e4f5a6b7"
    assert migration.revision == "a1b2c3d4e5f8"
    upgrade_src = Path(
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "a1b2c3d4e5f8_work_progress_client_upload_id.py"
    ).read_text(encoding="utf-8")
    assert "nullable=True" in upgrade_src
    assert "client_upload_id IS NOT NULL" in upgrade_src


@pytest.fixture()
def alembic_cfg(tmp_path: Path) -> Config:
    api_root = Path(__file__).resolve().parents[1]
    db_path = tmp_path / "migration_test.db"
    cfg = Config(str(api_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(api_root / "migrations"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.as_posix()}")
    return cfg


def test_client_upload_migration_upgrade_downgrade_sqlite(alembic_cfg: Config) -> None:
    """Disposable sqlite DB: upgrade to head then downgrade one step for this revision."""
    command.upgrade(alembic_cfg, "a1b2c3d4e5f8")
    command.downgrade(alembic_cfg, "c2d3e4f5a6b7")
    command.upgrade(alembic_cfg, "a1b2c3d4e5f8")


def test_work_progress_tables_exist_at_c2_chain_postgres(tmp_path: Path) -> None:
    """
    Fresh PostgreSQL chain check:
    base -> c2 must include work_progress tables (created by e5 ancestor),
    then c2 -> a1 must add client_upload_id + partial unique index.
    """
    try:
        import psycopg  # noqa: F401
    except Exception:
        pytest.skip("psycopg unavailable")

    admin_dsn = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_name = "timiq_chain_test_wp"
    db_user = "timiq_chain_test_wp"
    db_pass = "timiq_chain_test_wp_pw"
    app_dsn = f"postgresql+psycopg://{db_user}:{db_pass}@localhost:5432/{db_name}"

    try:
        import psycopg

        with psycopg.connect(admin_dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP DATABASE IF EXISTS {db_name}")
                cur.execute(f"DROP ROLE IF EXISTS {db_user}")
                cur.execute(f"CREATE ROLE {db_user} LOGIN PASSWORD '{db_pass}'")
                cur.execute(f"CREATE DATABASE {db_name} OWNER {db_user}")
    except Exception as exc:
        pytest.skip(f"local postgres unavailable for chain test: {exc}")

    repo_root = Path(__file__).resolve().parents[3]
    api_root = repo_root / "apps" / "api"
    env = os.environ.copy()
    env["DATABASE_URL"] = app_dsn
    env["PYTHONPATH"] = str(api_root)

    cmd_prefix = ["python", "-m", "alembic", "-c", str(api_root / "alembic.ini")]
    subprocess.run(
        [*cmd_prefix, "upgrade", "c2d3e4f5a6b7"],
        cwd=repo_root,
        env=env,
        check=True,
    )

    engine = create_engine(app_dsn)
    with engine.connect() as conn:
        assert conn.execute(text("select to_regclass('public.work_progress_entries')")).scalar() == "work_progress_entries"
        assert (
            conn.execute(text("select to_regclass('public.work_progress_attachments')")).scalar()
            == "work_progress_attachments"
        )

    subprocess.run(
        [*cmd_prefix, "upgrade", "a1b2c3d4e5f8"],
        cwd=repo_root,
        env=env,
        check=True,
    )
    with engine.connect() as conn:
        nullable = conn.execute(
            text(
                """
                select is_nullable
                from information_schema.columns
                where table_schema='public'
                  and table_name='work_progress_attachments'
                  and column_name='client_upload_id'
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
                  and tablename='work_progress_attachments'
                  and indexname='uq_work_progress_attachments_entry_client_upload'
                """
            )
        ).scalar_one()
        assert "client_upload_id IS NOT NULL" in indexdef

    subprocess.run(
        [*cmd_prefix, "downgrade", "c2d3e4f5a6b7"],
        cwd=repo_root,
        env=env,
        check=True,
    )
    subprocess.run(
        [*cmd_prefix, "upgrade", "a1b2c3d4e5f8"],
        cwd=repo_root,
        env=env,
        check=True,
    )


def test_client_upload_upgrade_fails_on_incompatible_existing_attachment_shape() -> None:
    """If an incompatible existing table shape is present, migration must fail loudly."""
    try:
        import psycopg
    except Exception:
        pytest.skip("psycopg unavailable")

    admin_dsn = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_name = "timiq_chain_badshape_wp"
    db_user = "timiq_chain_badshape_wp"
    db_pass = "timiq_chain_badshape_wp_pw"
    app_dsn = f"postgresql+psycopg://{db_user}:{db_pass}@localhost:5432/{db_name}"

    try:
        with psycopg.connect(admin_dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP DATABASE IF EXISTS {db_name}")
                cur.execute(f"DROP ROLE IF EXISTS {db_user}")
                cur.execute(f"CREATE ROLE {db_user} LOGIN PASSWORD '{db_pass}'")
                cur.execute(f"CREATE DATABASE {db_name} OWNER {db_user}")
        with psycopg.connect(
            f"postgresql://{db_user}:{db_pass}@localhost:5432/{db_name}",
            autocommit=True,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("create table work_progress_attachments (id uuid primary key)")
                cur.execute("create table alembic_version (version_num varchar(32) not null)")
                cur.execute("insert into alembic_version(version_num) values ('c2d3e4f5a6b7')")
    except Exception as exc:
        pytest.skip(f"local postgres unavailable for incompatible-shape test: {exc}")

    repo_root = Path(__file__).resolve().parents[3]
    api_root = repo_root / "apps" / "api"
    env = os.environ.copy()
    env["DATABASE_URL"] = app_dsn
    env["PYTHONPATH"] = str(api_root)
    run = subprocess.run(
        ["python", "-m", "alembic", "-c", str(api_root / "alembic.ini"), "upgrade", "a1b2c3d4e5f8"],
        cwd=repo_root,
        env=env,
        text=True,
        capture_output=True,
    )
    assert run.returncode != 0
    output = f"{run.stdout}\n{run.stderr}"
    assert "work_progress_attachments" in output
