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

load_dotenv(ENV_FILE)


class DatabaseConfigurationError(RuntimeError):
    """Raised when the API cannot start safely because database config is missing."""


def get_database_url() -> str:
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
    return create_engine(
        get_database_url(),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
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