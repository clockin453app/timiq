"""Alembic migration safety for work progress client_upload_id."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url

from app.testing.database_safety import (
    TEST_ENV_NAME,
    alembic_test_subprocess_env,
    assert_safe_destructive_migration_target,
    current_timiq_env,
    database_name_from_url,
    hostname_from_url,
    is_allowed_test_database_name,
    is_sqlite_url,
    select_pytest_database_url,
    validate_test_database_url,
)


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


_CLIENT_UPLOAD_TEMP_DB_PREFIX = "timiq_test_client_upload_"


def _sqlalchemy_url_for_database(source_url: str, database_name: str) -> str:
    parsed = make_url(source_url)
    return parsed.set(database=database_name).render_as_string(hide_password=False)


def _psycopg_conninfo(source_url: str) -> str:
    parsed = make_url(source_url)
    driver = (parsed.drivername or "postgresql").split("+", 1)[0]
    return parsed.set(drivername=driver).render_as_string(hide_password=False)


def _assert_droppable_sibling_name(*, dedicated_name: str, source_name: str) -> None:
    if not is_allowed_test_database_name(dedicated_name):
        raise AssertionError(f"dedicated database name is not a timiq_test_* target: {dedicated_name}")
    if not dedicated_name.startswith(_CLIENT_UPLOAD_TEMP_DB_PREFIX):
        raise AssertionError("dedicated database name is not owned by this test")
    if dedicated_name == source_name:
        raise AssertionError("refusing to drop or replace the source TEST_DATABASE_URL database")
    if dedicated_name in {"timiq_test_ci", "postgres", "template0", "template1"}:
        raise AssertionError("refusing to target a shared or system database")


def _assert_client_upload_schema(engine, *, present: bool) -> None:
    with engine.connect() as conn:
        column_row = conn.execute(
            text(
                """
                select is_nullable
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'work_progress_attachments'
                  and column_name = 'client_upload_id'
                """
            )
        ).fetchone()
        index_def = conn.execute(
            text(
                """
                select indexdef
                from pg_indexes
                where schemaname = 'public'
                  and tablename = 'work_progress_attachments'
                  and indexname = 'uq_work_progress_attachments_entry_client_upload'
                """
            )
        ).scalar()
    if present:
        assert column_row is not None
        assert column_row[0] == "YES"
        assert index_def is not None
        assert "client_upload_id IS NOT NULL" in index_def
    else:
        assert column_row is None
        assert index_def is None


def test_client_upload_migration_upgrade_downgrade_postgresql() -> None:
    """Dedicated disposable PostgreSQL DB: upgrade to a1, downgrade to c2, upgrade to a1."""
    source_url = (os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not source_url:
        pytest.skip(
            "TEST_DATABASE_URL is not set; PostgreSQL client-upload migration round-trip requires a dedicated timiq_test_* database"
        )

    try:
        import psycopg
        from psycopg import sql
    except Exception:
        pytest.skip("psycopg unavailable")

    if (current_timiq_env() or "").lower() != TEST_ENV_NAME:
        raise AssertionError("TIMIQ_ENV=test is required before creating a disposable PostgreSQL test database")

    selected = select_pytest_database_url()
    if not selected:
        pytest.skip("TEST_DATABASE_URL is not set")
    if is_sqlite_url(selected):
        pytest.skip("TEST_DATABASE_URL is SQLite; client-upload Alembic round-trip requires PostgreSQL")

    source_url = validate_test_database_url(selected, timiq_env=current_timiq_env())
    assert_safe_destructive_migration_target(source_url)
    source_name = database_name_from_url(source_url)
    source_host = hostname_from_url(source_url)
    if not is_allowed_test_database_name(source_name):
        raise AssertionError("source TEST_DATABASE_URL database is not a timiq_test_* target")

    dedicated_name = f"{_CLIENT_UPLOAD_TEMP_DB_PREFIX}{uuid.uuid4().hex[:8]}"
    _assert_droppable_sibling_name(dedicated_name=dedicated_name, source_name=source_name)
    dedicated_url = _sqlalchemy_url_for_database(source_url, dedicated_name)
    dedicated_url = validate_test_database_url(dedicated_url, timiq_env=current_timiq_env())
    assert_safe_destructive_migration_target(dedicated_url)
    assert database_name_from_url(dedicated_url) == dedicated_name
    assert hostname_from_url(dedicated_url) == source_host

    repo_root = Path(__file__).resolve().parents[3]
    api_root = repo_root / "apps" / "api"
    created = False
    engine = None
    try:
        with psycopg.connect(_psycopg_conninfo(source_url), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dedicated_name)))
        created = True

        env = alembic_test_subprocess_env(dedicated_url, extra={"PYTHONPATH": str(api_root)})
        cmd_prefix = ["python", "-m", "alembic", "-c", str(api_root / "alembic.ini")]

        subprocess.run([*cmd_prefix, "upgrade", "a1b2c3d4e5f8"], cwd=repo_root, env=env, check=True)
        engine = create_engine(dedicated_url)
        _assert_client_upload_schema(engine, present=True)

        subprocess.run([*cmd_prefix, "downgrade", "c2d3e4f5a6b7"], cwd=repo_root, env=env, check=True)
        _assert_client_upload_schema(engine, present=False)

        subprocess.run([*cmd_prefix, "upgrade", "a1b2c3d4e5f8"], cwd=repo_root, env=env, check=True)
        _assert_client_upload_schema(engine, present=True)
    finally:
        if engine is not None:
            engine.dispose()
        if created:
            with psycopg.connect(_psycopg_conninfo(source_url), autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                        "WHERE datname = %s AND pid <> pg_backend_pid()",
                        (dedicated_name,),
                    )
                    _assert_droppable_sibling_name(dedicated_name=dedicated_name, source_name=source_name)
                    cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(dedicated_name)))


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
    db_name = "timiq_test_wp_chain"
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
    env = alembic_test_subprocess_env(app_dsn, extra={"PYTHONPATH": str(api_root)})

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
    db_name = "timiq_test_wp_badshape"
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
    env = alembic_test_subprocess_env(app_dsn, extra={"PYTHONPATH": str(api_root)})
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
