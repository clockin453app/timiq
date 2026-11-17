"""Future Gate checks. This module does not open a database or commit.

Classes:
A SELECT-only.
B Writes that roll back in the same transaction.
C Writes that must commit and leave fictional rows.
D Requires the unapplied c9d0e1f2a3b4 migration.
E Requires Payroll code that still commits Mark Paid before Finance.
"""

from __future__ import annotations

PLAN: tuple[dict[str, str], ...] = (
    {"name": "identity_d2_and_gate", "klass": "A", "revision": "d2 a7c8d9e0f1a2; gate b8d9e0f1a2b3", "remains": "no", "assert": "read only and data directory"},
    {"name": "one_project_posting_python_shape", "klass": "B", "revision": "gate b8 plus unapplied rules still in Python", "remains": "no", "assert": "two projects rejected before commit"},
    {"name": "one_project_database_trigger", "klass": "D", "revision": "c9d0e1f2a3b4", "remains": "no", "assert": "deferred trigger rejects a second project at commit"},
    {"name": "direct_posted_insert", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "insert status posted raises finance documents must be inserted as drafts"},
    {"name": "posted_allocation_change", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "posted finance document children are immutable"},
    {"name": "company_overhead_post", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "overhead without a project posts inside a rollback"},
    {"name": "historical_split_unchanged", "klass": "A", "revision": "d2 a7c8d9e0f1a2", "remains": "no", "assert": "existing split eligible amounts stay 600 and 400"},
    {"name": "customer_reference_concurrency", "klass": "D", "revision": "c9d0e1f2a3b4", "remains": "no", "assert": "one of two posted sessions hits uq_finance_posted_customer_invoice_ref"},
    {"name": "supplier_partial_payments", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "two allocations, one payment row, outstanding reduced"},
    {"name": "cross_supplier_allocation", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "same supplier trigger rejects"},
    {"name": "payment_reversal", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "reversal row, original payment remains"},
    {"name": "budget_approval_audit_atomicity", "klass": "B", "revision": "gate b8", "remains": "no", "assert": "audit and approval share the savepoint"},
    {"name": "vat_label_policy", "klass": "A", "revision": "gate b8", "remains": "no", "assert": "amounts unchanged; no relabel executed"},
    {"name": "cis_full_and_partial", "klass": "E", "revision": "payroll commit boundary", "remains": "yes", "assert": "not run until Mark Paid commit is removed"},
    {"name": "duplicate_mark_paid", "klass": "E", "revision": "idempotency index unapplied", "remains": "yes", "assert": "second key does not create a second payment"},
    {"name": "concurrent_worker_allocations", "klass": "C", "revision": "gate b8", "remains": "yes", "assert": "two sessions cannot both be rollback-only"},
    {"name": "project_report_fanout", "klass": "A", "revision": "d2 a7c8d9e0f1a2", "remains": "no", "assert": "split cash stays unassigned"},
)
