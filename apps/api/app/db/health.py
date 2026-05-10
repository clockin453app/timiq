from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import get_engine


def check_database_connection() -> dict[str, str]:
    try:
        engine = get_engine()

        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "status": "ok",
            "database": "reachable",
        }

    except SQLAlchemyError:
        return {
            "status": "error",
            "database": "unreachable",
        }