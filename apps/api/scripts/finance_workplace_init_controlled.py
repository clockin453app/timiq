"""Controlled Finance project identity init from approved workplace IDs.

Does NOT flip FINANCE_PREVIEW_MODE. Does NOT call mutation HTTP endpoints.
Uses the same service layer as the API, with mandatory DRY-RUN by default.

Safety:
- Refuses non-local hosts unless --i-approve-live-init is provided with an
  approved IDs file.
- Never imports payroll, costs, invoices, payments, CIS, budgets, or contract values.
- Explicit workplace UUID list required.
- Atomic commit of the approved batch (or full rollback on failure).
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.modules.finance.workplace_link import (  # noqa: E402
    initialize_approved_workplaces,
)


def _parse_ids(path: Path) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        ids.append(uuid.UUID(line))
    if not ids:
        raise SystemExit("Approved workplace IDs file is empty.")
    seen: set[uuid.UUID] = set()
    ordered: list[uuid.UUID] = []
    for item in ids:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _assert_target_safety(database_url: str, *, approve_live: bool) -> dict:
    # Never log the raw URL: it may contain credentials.
    parsed = urlparse(database_url.replace("postgresql+psycopg://", "postgresql://", 1))
    host = (parsed.hostname or "").lower()
    port = parsed.port
    dbname = (parsed.path or "/").lstrip("/")
    user = parsed.username or ""
    local_hosts = {"127.0.0.1", "localhost"}
    is_local = host in local_hosts
    looks_hosted = (
        (not is_local)
        or host.endswith("render.com")
        or host.endswith("onrender.com")
        or "amazonaws.com" in host
        or "rlwy.net" in host
    )
    if looks_hosted and not approve_live:
        raise SystemExit(
            "Refusing hosted/non-local DATABASE_URL without --i-approve-live-init. "
            "Accidental LIVE execution is blocked. Do not flip FINANCE_PREVIEW_MODE."
        )
    if is_local and port in {5432}:
        raise SystemExit("Refusing port 5432 (protected). Use an isolated Finance test port.")
    if approve_live and not looks_hosted and not is_local:
        # keep approve flag meaningful for any non-local host
        pass
    return {
        "host": host,
        "port": port,
        "database": dbname,
        "user": user,
        "local": is_local,
        "hosted": looks_hosted,
        # password intentionally omitted
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Controlled workplace -> Finance project init")
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--company-id", required=True, type=uuid.UUID)
    parser.add_argument("--workplace-ids-file", required=True, type=Path)
    parser.add_argument("--actor-user-id", type=uuid.UUID, default=None)
    parser.add_argument("--execute", action="store_true", help="Apply after dry-run plan has no conflicts")
    parser.add_argument(
        "--i-approve-live-init",
        action="store_true",
        help="Required for non-local targets. Still never changes FINANCE_PREVIEW_MODE.",
    )
    parser.add_argument("--audit-out", type=Path, default=None)
    args = parser.parse_args()

    target = _assert_target_safety(args.database_url, approve_live=args.i_approve_live_init)
    workplace_ids = _parse_ids(args.workplace_ids_file)

    engine = create_engine(args.database_url)
    Session = sessionmaker(bind=engine)
    with Session() as session:
        identity = session.execute(
            text(
                "SELECT current_database() AS db, inet_server_addr() AS addr, "
                "inet_server_port() AS port, version() AS version, "
                "(SELECT version_num FROM alembic_version LIMIT 1) AS alembic"
            )
        ).mappings().first()
        print(
            json.dumps(
                {
                    "target": target,
                    "identity": {
                        "db": identity["db"],
                        "addr": str(identity["addr"]),
                        "port": identity["port"],
                        "alembic": identity["alembic"],
                        "version": str(identity["version"]).split(",")[0],
                    },
                    "company_id": str(args.company_id),
                    "workplace_count": len(workplace_ids),
                    "mode": "EXECUTE" if args.execute else "DRY_RUN",
                },
                indent=2,
            )
        )
        if args.execute and identity["alembic"] not in {"b8c9d0e1f2a3"}:
            raise SystemExit(
                f"Refusing execute: alembic is {identity['alembic']}, expected b8c9d0e1f2a3."
            )
        if args.execute and target.get("hosted") and not args.i_approve_live_init:
            raise SystemExit("Refusing hosted execute without --i-approve-live-init.")
        if not args.execute:
            # Default path: DRY-RUN only. No writes occur below.
            pass

        result = initialize_approved_workplaces(
            session,
            company_id=args.company_id,
            actor_user_id=args.actor_user_id,
            workplace_ids=workplace_ids,
            dry_run=not args.execute,
        )
        if args.execute and result.get("executed"):
            session.commit()
        else:
            session.rollback()

        payload = {
            "executed": bool(result.get("executed")),
            "mode": result.get("mode"),
            "created_count": len(result.get("created") or []),
            "already_linked_count": len(result.get("already_linked") or []),
            "created": result.get("created"),
            "already_linked": result.get("already_linked"),
            "plan": result.get("plan"),
            "imports": result.get("imports", []),
            "contract_values_set": result.get("contract_values_set", 0),
            "note": "FINANCE_PREVIEW_MODE was not modified.",
        }
        print(json.dumps(payload, indent=2, default=str))
        if args.audit_out:
            args.audit_out.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        if result.get("mode") == "ABORTED":
            return 2
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
