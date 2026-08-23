from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.db.base import Base
from app.db import models
from app.testing.database_safety import (
    TEST_ENV_NAME,
    assert_safe_destructive_migration_target,
    current_timiq_env,
    resolve_alembic_sqlalchemy_url,
    running_under_pytest,
)

config = context.config


def _alembic_sqlalchemy_url() -> str:
    """Resolve the database URL.

    Precedence:
    1. Explicit Alembic Config sqlalchemy.url (not the alembic.ini placeholder)
    2. TEST_DATABASE_URL when TIMIQ_ENV=test or pytest
    3. Settings DATABASE_URL only for operator/deploy migrations

    A local .env DATABASE_URL must not replace an explicit test URL.
    """
    settings_url = None
    test_mode = running_under_pytest() or current_timiq_env().lower() == TEST_ENV_NAME
    if not test_mode:
        from app.core.config import require_database_url

        settings_url = require_database_url()
    url = resolve_alembic_sqlalchemy_url(
        config.get_main_option("sqlalchemy.url"),
        settings_database_url=settings_url,
    )
    return assert_safe_destructive_migration_target(url)


config.set_main_option("sqlalchemy.url", _alembic_sqlalchemy_url())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()