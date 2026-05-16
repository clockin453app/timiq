from __future__ import annotations

import argparse
import uuid

from app.db.session import get_session_factory
from app.modules.attendance_notifications.service import run_attendance_notification_check_once


def main() -> int:
    parser = argparse.ArgumentParser(description="Run attendance notification checks once.")
    parser.add_argument("--once", action="store_true", help="Run one attendance notification check.")
    parser.add_argument("--dry-run", action="store_true", help="Evaluate candidates without writing notification records.")
    parser.add_argument("--company-id", default="", help="Optional company UUID to check.")
    args = parser.parse_args()

    if not args.once:
        parser.error("Only --once is supported. Use Render Cron/background worker for repeated execution.")

    company_id = uuid.UUID(args.company_id) if args.company_id else None
    session_factory = get_session_factory()
    db = session_factory()
    try:
        result = run_attendance_notification_check_once(db, company_id=company_id, dry_run=bool(args.dry_run))
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
        print(
            "attendance notifications: "
            f"companies_checked={result.companies_checked} "
            f"employees_checked={result.employees_checked} "
            f"notifications_created={result.notifications_created} "
            f"dry_run_candidates={result.dry_run_candidates}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
