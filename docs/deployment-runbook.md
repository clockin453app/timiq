# TimIQ deployment runbook

Use with [render-deployment.md](./render-deployment.md) and [env-production-checklist.md](./env-production-checklist.md). **Do not run destructive SQL against production without a backup.**

---

## Preconditions

- Render (or other) accounts and billing in place.
- Secrets generated: `SESSION_SECRET`, database password, S3 keys — stored only in the host dashboard.

---

## Ordered steps (Render)

1. **Create PostgreSQL** and note `DATABASE_URL`.
2. **Create API Web Service** — build/start commands from `render-deployment.md`.
3. Set API env vars: `DATABASE_URL`, `SESSION_SECRET`, `TIMIQ_ENV=production`, `CORS_ALLOWED_ORIGINS`, `WEB_ORIGIN` (frontend URL for emailed links), storage vars, optional `TIMIQ_APP_NAME`. For transactional email: `TIMIQ_EMAIL_ENABLED=true`, `TIMIQ_EMAIL_FROM`, `TIMIQ_SMTP_*` (see checklist).
4. **Run migrations** — Pre-deploy `alembic upgrade head` or manual shell once.
5. Wait until **`GET https://<api>/api/healthz`** returns `200` and JSON with `status: ok`.
6. **Create frontend Web Service** — set **`API_PROXY_URL`** to the API public URL (server-only); leave **`NEXT_PUBLIC_API_URL`** empty for same-origin `/api`. Redeploy web after env changes (Next rewrites at build).
7. Redeploy frontend if CORS was updated after first API deploy.
8. Confirm API **`WEB_ORIGIN`** matches the frontend URL; test forgot-password email link opens `/reset-password` on the web host (not the API).
9. **Smoke test** (see below).

---

## Smoke (first release)

1. Open frontend URL → **Login** with a known admin user (create via local seed or first-run procedure).
2. **`GET /api/healthz`** and **`GET /health`** from browser or curl — `200`, no secrets in body.
3. **Clock** page loads (employee test user).
4. **Upload** a small onboarding or work-progress image (validates storage + auth).
5. **Payroll report** page loads for admin.
6. **Budget / accounting export** if you use those modules — CSV downloads.

Full list: [qa-smoke-checklist.md](./qa-smoke-checklist.md).

---

## Rollback

- **Render:** use **Manual Deploy** → select previous successful deploy for API and/or web.
- **Database:** Alembic downgrade is possible only if you maintain downgrade scripts; prefer **restore from backup** for bad data migrations. See [backup-runbook.md](./backup-runbook.md).

---

## Backups

Database and object storage backups are **your** operational responsibility. Link: [backup-runbook.md](./backup-runbook.md).

---

## Known constraints

- **`/api/system-health`** (deep health) is **administrator-only** — not for public probes.
- **Session cookies:** non-`local` `TIMIQ_ENV` enables `Secure` + `SameSite=None` for split API/frontend hosts (see `auth/router.py`).
- **Google Drive** env vars are optional; core TimIQ does not require them at boot.

---

## Next improvements (optional)

- Custom domain + reverse proxy for same-site cookies.
- Staging environment with anonymised data.
- WAF / rate limits at edge.
