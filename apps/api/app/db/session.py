from collections.abc import Generator
from functools import lru_cache
from os import getenv
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


API_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = API_ROOT / ".env"

# Default override=False: values already in os.environ (including a pytest-pinned
# DATABASE_URL) are not replaced by apps/api/.env.
load_dotenv(ENV_FILE)


class DatabaseConfigurationError(RuntimeError):
    """Raised when the API cannot start safely because database config is missing."""


def get_database_url() -> str:
    env_name = (getenv("TIMIQ_ENV") or getenv("APP_ENV") or "").strip()
    if env_name.lower() == "test":
        test_url = getenv("TEST_DATABASE_URL", "").strip()
        if not test_url:
            raise DatabaseConfigurationError(
                "TEST_DATABASE_URL is required when TIMIQ_ENV=test. "
                "DATABASE_URL is not used as a fallback."
            )
        from app.testing.database_safety import validate_test_database_url

        return validate_test_database_url(test_url, timiq_env=env_name)

    database_url = getenv("DATABASE_URL", "").strip()

    if not database_url:
        raise DatabaseConfigurationError(
            "DATABASE_URL is missing. Create apps/api/.env from apps/api/.env.example."
        )

    if "timiq_local_password_change_me" in database_url and getenv("TIMIQ_ENV") != "local":
        raise DatabaseConfigurationError(
            "Unsafe local database password detected outside local environment."
        )

    return database_url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    database_url = get_database_url()
    connect_args: dict = {}

    if database_url.startswith("postgresql"):
        # Prevent indefinite TCP hangs when the DB host is unreachable (Windows-friendly).
        connect_args["connect_timeout"] = 10

    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        connect_args=connect_args,
    )


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(),
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )


def get_db_session() -> Generator[Session, None, None]:
    session_factory = get_session_factory()
    db_session = session_factory()

    try:
        yield db_session
    finally:
        db_session.close()