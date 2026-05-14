# Render Deployment Plan

**Status:** Runbook and environment checklist are in **`docs/`** (see below). This file remains a short pointer.

- **[docs/render-deployment.md](../../docs/render-deployment.md)** — Render Dashboard steps (API, web, Postgres, CORS, storage, migrations).
- **[docs/deployment-runbook.md](../../docs/deployment-runbook.md)** — ordered deploy, smoke, rollback, backups link.
- **[docs/env-production-checklist.md](../../docs/env-production-checklist.md)** — variable names aligned with `Settings`.

Planned services (unchanged):

- Web service for `apps/web`
- Web service for `apps/api`
- Managed PostgreSQL database
- Environment variables stored in Render dashboard (no secrets in git)

No `render.yaml` in-repo by default (see `docs/render-deployment.md` rationale).
