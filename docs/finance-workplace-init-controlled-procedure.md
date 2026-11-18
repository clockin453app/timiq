# Controlled LIVE workplace to Finance project initialization

## Principle

Do **not** change global `FINANCE_PREVIEW_MODE` from `readonly` to writable.
That would unlock all Finance mutation endpoints.

Use the service-layer script instead:

`apps/api/scripts/finance_workplace_init_controlled.py`

It creates **identity-only** Finance projects for an **explicit** owner-approved workplace ID list.

## Preconditions

1. Migration `b8c9d0e1f2a3` applied (adds `finance_projects.workplace_id` + uniqueness + composite company FK).
2. Owner provides a text file of approved workplace UUIDs (one per line).
3. Company ID verified for every workplace (script/service rejects mismatches and conflicts).
4. DRY-RUN completed and reviewed.
5. Separate owner approval to run `--execute` (and `--i-approve-live-init` only for non-local).

## Steps (LIVE — do not run until approved)

1. Confirm API/Web remain read-only pilot; Auto-Deploy OFF.
2. Apply Alembic `b8c9d0e1f2a3` on LIVE only after explicit migration approval.
3. Export candidate workplaces via `GET /api/finance/project-links/dry-run` (still allowed under readonly).
4. Owner edits approved list file (active workplaces only; no historical auto-import).
5. Run script **without** `--execute` against LIVE URL + `--i-approve-live-init` and review JSON plan.
6. If `conflicts` empty and `would_create` matches approval, re-run with `--execute --audit-out audit.json`.
7. Verify created rows: identity fields only; contract value unset; no payroll/cost imports.
8. Leave `FINANCE_PREVIEW_MODE=readonly` unchanged so POST `/project-links/initialize` stays 403 for pilot UI.

## Guarantees

- Explicit IDs only
- Same-company checks in service + composite FK in DB
- Idempotent retry (unique `(company_id, workplace_id)`)
- Audit events `project_initialized_from_workplace`
- No Finance mutation surface expansion for normal users

## Recommended LIVE launch order

1. Apply Alembic 8c9d0e1f2a3 (additive; existing API keeps working — it does not require workplace_id).
2. Deploy API (new /project-links* endpoints become usable).
3. Deploy Web (Workplace link panel).
4. Owner-approved controlled init script (explicit IDs, DRY-RUN then --execute --i-approve-live-init).

### Wrong-order notes

- **Migration before API:** safe. Nullable column ignored by current LIVE API.
- **API before migration:** existing Finance endpoints remain safe (list_projects does not select workplace_id). New /project-links* endpoints fail until migration is applied.
- **Web before migration/API:** panel shows load error for links; other Finance V3 screens keep working.
- **Rollback after migration:** downgrade drops workplace_id only if no non-null links remain / FKs allow; prefer leaving the additive column and rolling back API/Web only.

