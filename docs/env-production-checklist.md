# Production environment variables (TimIQ)

Values are set in **Render** (or your host). Do not commit real secrets. Names below match `apps/api/app/core/config.py` (`Settings`) and the frontend `NEXT_PUBLIC_*` convention.

See also: [render-deployment.md](./render-deployment.md), [deployment-runbook.md](./deployment-runbook.md).

---

## Backend (`apps/api`)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | **Yes** | PostgreSQL URL, e.g. `postgresql+psycopg://user:pass@host:5432/dbname` (Render provides this). |
| `SESSION_SECRET` | **Yes** (non-local) | Long random string. Must **not** remain `change-this-with-a-secure-random-value` when `TIMIQ_ENV` ≠ `local`. |
| `TIMIQ_ENV` or `APP_ENV` | Recommended | Use `production` (or any non-`local` value) on Render so session cookies use `Secure` + `SameSite=None` for split frontend/API hosts. |
| `CORS_ALLOWED_ORIGINS` or `WEB_ORIGIN` | **Yes** (split stack) | Comma-separated list of **exact** frontend origins (`https://your-frontend.onrender.com`). No trailing slashes. |
| `TIMIQ_APP_NAME` / `APP_NAME` | No | Display only. |
| `TIMIQ_API_HOST` / `API_HOST` | No | Uvicorn bind uses Render `$PORT`; these are mainly local. |
| `TIMIQ_API_PORT` / `API_PORT` | No | Local default; Render uses `$PORT`. |

### Storage

| Variable | When | Notes |
|----------|------|--------|
| `TIMIQ_STORAGE_BACKEND` | Always | `local` or `s3`. **Production:** prefer `s3` (R2, Spaces, private S3, MinIO). |
| `TIMIQ_STORAGE_ROOT` | `local` only | Writable directory on disk; on Render only if you attach a **persistent disk** (not default). |
| `TIMIQ_S3_BUCKET` | `s3` | Private bucket; no public ACLs. |
| `TIMIQ_S3_REGION` | `s3` | e.g. `auto` (R2), `eu-west-2`, etc. |
| `TIMIQ_S3_ENDPOINT_URL` | Often (R2/MinIO) | e.g. `https://<accountid>.r2.cloudflarestorage.com` — set in Render as secret. |
| `TIMIQ_S3_ACCESS_KEY_ID` | `s3` | Secret in Render. |
| `TIMIQ_S3_SECRET_ACCESS_KEY` | `s3` | Secret in Render. |
| `TIMIQ_S3_PREFIX` | No | Optional key prefix, e.g. `timiq-prod/`. |
| `TIMIQ_S3_FORCE_PATH_STYLE` | No | `true` for many MinIO-style endpoints. |

### Optional / integrations

| Variable | Notes |
|----------|--------|
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI` | Optional; only if Google Drive integration is enabled. Not required for core payroll/clocking. |

---

## Frontend (`apps/web`)

| Variable | Required | Notes |
|----------|----------|--------|
| `NEXT_PUBLIC_API_URL` | **Yes** (split Render services) | Full public API origin, e.g. `https://timiq-api.onrender.com` — **no** trailing slash. Empty string means same-origin `/api` (reverse proxy or monolith-style host). |

---

## Health checks (Render)

- **`GET /health`** — minimal JSON `{"status":"ok"}` (root path).
- **`GET /api/healthz`** — public JSON `{"status":"ok","server_time":"..."}` for probes that expect an `/api/...` path.

Neither performs DB queries or leaks configuration.

---

## Cookie / CORS reminder

With **two Render Web services** (different hostnames), the browser sends the session cookie to the API origin only. Set `TIMIQ_ENV` to something other than `local` so login uses **`Secure` + `SameSite=None`**. You must serve the API over **HTTPS** (Render does). Always list the frontend origin in `CORS_ALLOWED_ORIGINS` and use `credentials: "include"` from the web app (already the pattern in TimIQ fetch helpers).

If you terminate TLS on a **single hostname** and proxy `/api` to the backend, you can use same-origin `NEXT_PUBLIC_API_URL=""` and tighter cookies; document that architecture in your internal runbook.
