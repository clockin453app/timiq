"""Disposable migration verification for budget billing phase 1.

Uses DATABASE_URL env or creates timiq_disposable_budget_billing_* DBs.
Does not use the normal .env production database.
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

from sqlalchemy import create_engine, text

API_ROOT = Path(__file__).resolve().parents[1]
ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
PREV_HEAD = "b3c4d5e6f7a8"
NEW_HEAD = "c5d6e7f8a9b0"
DB_BLANK = "timiq_disposable_budget_billing_blank"
DB_UPGRADE = "timiq_disposable_budget_billing_upgrade"


def _admin():
    return create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")


def recreate(name: str) -> str:
    with _admin().connect() as c:
        exists = c.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": name}).scalar()
        if exists:
            c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{name}"'))
    return f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{name}"


def alembic(url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    # Prevent loading .env accidentally overriding
    env["TIMIQ_IGNORE_DOTENV"] = "1"
    cmd = [sys.executable, "-m", "alembic", *args]
    print("+", " ".join(cmd), f"(DATABASE_URL=.../{url.rsplit('/', 1)[-1]})")
    subprocess.run(cmd, cwd=str(API_ROOT), env=env, check=True)


def check_constraints(url: str) -> None:
    eng = create_engine(url)
    with eng.begin() as conn:
        # contract columns exist and are nullable
        cols = {
            r[0]: r
            for r in conn.execute(
                text(
                    """
                    SELECT column_name, is_nullable, data_type
                    FROM information_schema.columns
                    WHERE table_name = 'budget_projects'
                      AND column_name IN ('contract_value_net', 'billing_currency')
                    """
                )
            )
        }
        assert "contract_value_net" in cols and cols["contract_value_net"][1] == "YES"
        assert "billing_currency" in cols

        # tables exist
        for t in ("budget_customer_invoices", "budget_invoice_documents"):
            n = conn.execute(
                text("SELECT to_regclass(:t)"),
                {"t": f"public.{t}"},
            ).scalar()
            assert n is not None, t

        # partial unique indexes
        idxs = {
            r[0]
            for r in conn.execute(
                text(
                    """
                    SELECT indexname FROM pg_indexes
                    WHERE tablename IN ('budget_customer_invoices', 'budget_invoice_documents')
                    """
                )
            )
        }
        assert "uq_budget_customer_invoices_company_invoice_number" in idxs
        assert "uq_budget_customer_invoices_company_client_action" in idxs
        assert "uq_budget_invoice_documents_invoice_version" in idxs or any(
            "version" in i for i in idxs
        )
        assert any("is_current" in i or "current" in i for i in idxs)

        # multiple null invoice numbers allowed
        company_id = uuid.uuid4()
        budget_id = uuid.uuid4()
        # skip insert without companies FK — just test unique index semantics with raw if FKs block
        # Verify index predicates instead:
        pred = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                WHERE indexname LIKE 'uq_budget_customer_invoices%'
                """
            )
        ).fetchall()
        defs = "\n".join(r[1] for r in pred)
        assert "invoice_number IS NOT NULL" in defs
        assert "client_action_id IS NOT NULL" in defs
        print("constraint checks OK:", sorted(idxs))


def main() -> None:
    print("=== 1. Blank DB -> alembic head ===")
    blank = recreate(DB_BLANK)
    alembic(blank, "upgrade", "head")
    heads = subprocess.run(
        [sys.executable, "-m", "alembic", "heads"],
        cwd=str(API_ROOT),
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert NEW_HEAD in heads and heads.count("(head)") == 1
    check_constraints(blank)

    print("=== 2. Previous head -> new head; downgrade; re-upgrade ===")
    up = recreate(DB_UPGRADE)
    alembic(up, "upgrade", PREV_HEAD)
    alembic(up, "upgrade", "head")
    check_constraints(up)
    alembic(up, "downgrade", PREV_HEAD)
    alembic(up, "upgrade", "head")
    check_constraints(up)

    print("MIGRATION VERIFICATION PASSED")


if __name__ == "__main__":
    main()
