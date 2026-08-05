from __future__ import annotations

import argparse
import json
import uuid

from app.db.session import get_session_factory
from app.modules.attendance_notifications.service import (
    cleanup_expired_attendance_notifications,
    run_attendance_notification_check_once,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run attendance notification checks once.")
    parser.add_argument("--once", action="store_true", help="Run one attendance notification check (includes expiry cleanup).")
    parser.add_argument(
        "--cleanup-expired",
        action="store_true",
        help="Run only expired attendance notification cleanup (no new alerts).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Evaluate without writing or deleting notification records.")
    parser.add_argument("--company-id", default="", help="Optional company UUID to check.")
    args = parser.parse_args()

    if not args.once and not args.cleanup_expired:
        parser.error("Use --once and/or --cleanup-expired. Use Render Cron/background worker for repeated execution.")

    company_id = uuid.UUID(args.company_id) if args.company_id else None
    session_factory = get_session_factory()
    db = session_factory()
    try:
        if args.once:
            result = run_attendance_notification_check_once(db, company_id=company_id, dry_run=bool(args.dry_run))
            print(
                "attendance notifications: "
                f"companies_checked={result.companies_checked} "
                f"employees_checked={result.employees_checked} "
                f"notifications_created={result.notifications_created} "
                f"dry_run_candidates={result.dry_run_candidates} "
                f"expired_matched={result.expired_matched} "
                f"expired_deleted={result.expired_deleted}"
            )
            if args.dry_run and result.expiry_aggregates:
                print(json.dumps({"expiry_aggregates": result.expiry_aggregates}, sort_keys=True))
        elif args.cleanup_expired:
            cleanup = cleanup_expired_attendance_notifications(
                db,
                company_id=company_id,
                dry_run=bool(args.dry_run),
            )
            print(
                "attendance expiry cleanup: "
                f"matched={cleanup.matched} "
                f"deleted={cleanup.deleted}"
            )
            if cleanup.aggregates:
                print(
                    json.dumps(
                        {
                            "expiry_aggregates": [
                                {
                                    "kind": row.kind,
                                    "work_date": row.work_date.isoformat() if row.work_date else None,
                                    "company_id": str(row.company_id) if row.company_id else None,
                                    "seen": row.seen,
                                    "count": row.count,
                                }
                                for row in cleanup.aggregates
                            ]
                        },
                        sort_keys=True,
                    )
                )

        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
