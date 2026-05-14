# TimIQ QA smoke checklist

Use this before releases and after risky changes. Adjust for your environment (URLs, test accounts). Do not use production personal data in notes.

## Automated checks (local)

**Backend**

```text
cd apps/api
pip install -r requirements.txt
pip install -r requirements-dev.txt
python -m compileall app
python -c "from app.main import app; print('app import ok')"
python -m pytest tests -q
python -m alembic heads
python -m alembic upgrade head
```

**Frontend**

```text
cd apps/web
npm run build
npm run typecheck
```

**Lint:** `npm run lint` may prompt for first-time ESLint setup if no `eslint.config` exists; prefer `npm run typecheck` until ESLint is configured non-interactively in CI.

---

## Auth and roles

| Check | Employee | Company admin | Administrator |
|-------|----------|-----------------|-----------------|
| Login / logout | ✓ | ✓ | ✓ |
| Password change (if enabled) | ✓ | ✓ | ✓ |
| Access only own employee data | ✓ | N/A | N/A |

**Manual permission probes (expect 403 or equivalent for wrong role)**

- Employee calling **management-only** APIs (expect forbidden):
  - `GET/POST` (as applicable) `/api/accounting/...`
  - Budget admin endpoints under `/api/budgets/...` (create/update/delete projects or expenses if such routes exist)
  - `GET /api/audit/events` (or equivalent audit listing used by admin UI)
- Company admin **cannot** read another company’s company-scoped resources (e.g. wrong `company_id` on payroll, accounting, site payroll rules where applicable).

---

## Employee — time and pay

- [ ] **Clock in / out** at assigned site (GPS/geofence as configured).
- [ ] **Selfie** capture if required by policy.
- [ ] **Time records** list loads; totals look plausible.
- [ ] **Timesheets** week view; export CSV if used.
- [ ] **Week report** (admin/employee views as applicable).
- [ ] **Pay history** and **payslip** view (no raw NI/UTR/bank in browser devtools network payloads beyond what the product intentionally shows).

---

## Payroll and accounting

- [ ] **Payroll report** loads; **pending recalculation** if alerts show open shifts or policy changes.
- [ ] **Net payment** item: CIS/tax line non-zero where expected.
- [ ] **Gross payment** item: CIS zero; net aligns with gross minus other deductions.
- [ ] **Accounting export** CSV: contains `export_provider` / provider column where designed; **no** unexpected NI/UTR/bank/medical columns.
- [ ] **Site payroll rules** (admin): save override; confirm time records / pending payroll reflect merged policy after recalc (not retroactively changing approved/paid rows).

---

## Onboarding and work progress

- [ ] **Starter form / onboarding** draft save.
- [ ] **Final submit** validation (required fields).
- [ ] **Onboarding review** (admin): open submission; document list.
- [ ] **Work progress** entry; **photo upload**; thumbnail or download works without exposing raw storage paths in responses.

---

## Budgets

- [ ] Open **budget calculator** or saved budget view.
- [ ] **Purchase / expense** entry and category totals.
- [ ] **Labour** section: employees with **missing hourly rate** show warning and **zero** labour cost for those rows (not a crash).

---

## Operations and compliance

- [ ] **Audit log** (admin): events load; detail payloads look **sanitized** (no filesystem paths, tokens, or bank fields).
- [ ] **System health** (administrator if restricted).
- [ ] **Privacy portal** (`/privacy`): summary loads; submit a test request in non-prod only.
- [ ] **Messaging** (`/messages`): list/send as allowed; no cross-company leakage for admins.

---

## Mobile / narrow viewport

- [ ] Sidebar / drawer usable on **375px** width.
- [ ] Key forms (clock, time records, payroll report) scroll without clipped buttons.

---

## Known technical debt (migrations / DB)

**Legacy EXTRA-10 migration (`f1e2d3c4b5a6`)** created tables `company_newsfeed_posts` and `in_app_messages`. Current product messaging uses later migrations (e.g. `c5d6e7f8a9b1` and related models). **Application code does not reference the old feed tables** (verified by repository search).

- **Do not drop** those tables in production without an explicit cleanup plan, backup, and approval.
- **Recommended later:** one-off migration to drop unused tables after confirming no external reporting depends on them, or leave documented as harmless empty tables.

---

## After smoke

- [ ] No uncommitted secrets (`.env`, API keys) in screenshots or tickets.
- [ ] Note TimIQ version / git SHA tested.

---

## Suggested next batch

- Wire **pytest in CI** (single job: `pip install -r requirements-dev.txt && pytest`).
- Add **non-interactive ESLint** config and `npm run lint` in CI.
- Optional: **HTTP integration tests** with `TestClient` + transactional DB for permission matrix automation.
