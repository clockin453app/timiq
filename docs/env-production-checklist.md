# Production environment variables (TimIQ)

Values are set in **Render** (or your host). Do not commit real secrets. Names below match `apps/api/app/core/config.py` (`Settings`) and the frontend `NEXT_PUBLIC_*` convention.

See also: [render-deployment.md](./render-deployment.md), [deployment-runbook.md](./deployment-runbook.md).

---

## Backend (`apps/api`)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | **Yes** | PostgreSQL URL, e.g. `postgresql+psycopg://user:pass@host:5432/dbname` (Render provides this). |
| `SESSION_SECRET` | **Yes** (non-local) | Long random string. Must **not** remain `change-this-with-a-secure-random-value` when `TIMIQ_ENV` ≠ `local`. |
| `TIMIQ_ENV` or `APP_ENV` | Recommended | Use `production` (or any non-`local` value) on Render so session cookies use **`Secure`**. Default **`SESSION_COOKIE_SAMESITE=lax`** suits same-origin web → `/api` proxy; use `none` only if the browser still talks to the API on another hostname. |
| `SESSION_COOKIE_SAMESITE` | No | `lax` (default), `strict`, or `none`. `none` forces `Secure=true`. Prefer **lax** with Next.js **`API_PROXY_URL`** same-origin mode. |
| `CORS_ALLOWED_ORIGINS` | **Yes** (split stack) | Comma-separated list of **exact** frontend origins (`https://your-frontend.onrender.com`). No trailing slashes. |
| `WEB_ORIGIN` or `TIMIQ_WEB_APP_URL` | **Yes** (email + production) | Public **web app** origin for emailed action links (reset, invite, verify). Same hostname users open in the browser — **not** the API URL. No trailing slash. |
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

### Transactional email (password reset, invites, verification)

| Variable | Required | Notes |
|----------|----------|--------|
| `TIMIQ_EMAIL_ENABLED` / `SMTP_ENABLED` | For SMTP sending | `true` to send mail. When `false`, forgot-password does not persist reset tokens unless SMTP is later enabled. |
| `TIMIQ_EMAIL_FROM` / `SMTP_FROM_EMAIL` | When sending | From address, e.g. `noreply@yourdomain.com`. |
| `TIMIQ_EMAIL_FROM_NAME` / `SMTP_FROM_NAME` | No | Display name in From header, e.g. `TimIQ`. |
| `TIMIQ_SMTP_HOST` / `SMTP_HOST` | When sending | SMTP server hostname. |
| `TIMIQ_SMTP_PORT` / `SMTP_PORT` | No | Default `587`. |
| `TIMIQ_SMTP_USERNAME` / `SMTP_USERNAME` | Often | May be empty for some relays (rare in production). |
| `TIMIQ_SMTP_PASSWORD` / `SMTP_PASSWORD` | Often | Render secret; never commit. |
| `TIMIQ_SMTP_USE_TLS` / `SMTP_USE_TLS` | No | Default `true` (STARTTLS on port 587). |

Emailed links use **`WEB_ORIGIN`** (or `TIMIQ_WEB_APP_URL`) and open on the web app: `/reset-password?token=…`, `/accept-invite?token=…`, `/verify-email?token=…`. Legacy path `/invite/accept` redirects to `/accept-invite`.

**Production:** configure SMTP before relying on forgot-password, invite-by-email, or verification. Never log raw tokens. Do not return reset links in public API responses.

---

## Frontend (`apps/web`)

| Variable | Required | Notes |
|----------|----------|--------|
| `API_PROXY_URL` | **Yes** (recommended on Render) | **Server-only** (not `NEXT_PUBLIC_*`). Public API origin for Next rewrites, e.g. `https://timiq-api.onrender.com` — no trailing slash. Proxies `/api` and `/health` from the web hostname to the API. |
| `NEXT_PUBLIC_API_URL` | No (recommended empty) | If **empty**, browser uses same-origin `/api/...` (pair with `API_PROXY_URL`). If set, the browser calls this origin directly (cross-site; set API `SESSION_COOKIE_SAMESITE=none` if needed). |
| `NODE_VERSION` | Recommended | e.g. `20` on Render. |

---

## Health checks (Render)

- **`GET /health`** — minimal JSON `{"status":"ok"}` (root path).
- **`GET /api/healthz`** — public JSON `{"status":"ok","server_time":"..."}` for probes that expect an `/api/...` path.

Neither performs DB queries or leaks configuration.

---

## Cookie / CORS reminder

**Recommended:** point the **browser** at same-origin `/api/...` on the web app; set **`API_PROXY_URL`** on the web service so Next rewrites to the API. Session cookies are then **first-party** on the web origin; use default **`SESSION_COOKIE_SAMESITE=lax`** and `Secure` in production (`TIMIQ_ENV` ≠ `local`).

Keep **`CORS_ALLOWED_ORIGINS`** listing the web origin for direct API access, tools, and fallbacks. `allow_credentials=True` remains; never use `*` origins with credentials.

If the browser must call the **API hostname** directly (legacy), use `NEXT_PUBLIC_API_URL` and typically **`SESSION_COOKIE_SAMESITE=none`** with HTTPS on both hosts.
