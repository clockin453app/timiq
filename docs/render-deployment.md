# Deploying TimIQ on Render

This guide describes a **typical** production layout: **PostgreSQL** + **API Web Service** + **Frontend Web Service**. Adjust names and regions for your org. **Do not paste secrets into tickets or git.**

Related: [env-production-checklist.md](./env-production-checklist.md), [deployment-runbook.md](./deployment-runbook.md), [qa-smoke-checklist.md](./qa-smoke-checklist.md), [backup-runbook.md](./backup-runbook.md).

---

## Why no `render.yaml` in-repo

A Blueprint file pins service names, regions, and env wiring and goes stale quickly. TimIQ documents **Render Dashboard** steps instead. You may add your own private `render.yaml` later; keep **no secrets** in git.

---

## 1. Create PostgreSQL

1. Render Dashboard → **New** → **PostgreSQL**.
2. Choose region and instance size.
3. After creation, copy the **Internal Database URL** (preferred for API in same region) or external URL if required.
4. Map it to `DATABASE_URL` on the API service (see §3).

---

## 2. Create API (FastAPI) Web Service

1. **New** → **Web Service** → connect your Git repository.
2. **Root directory:** leave empty if repo root is TimIQ monorepo, or set according to your layout.
3. **Runtime:** Python 3.
4. **Build command** (API lives in `apps/api`):

   ```bash
   cd apps/api && pip install -r requirements.txt
   ```

5. **Start command:**

   ```bash
   cd apps/api && python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```

6. **Pre-deploy command** (recommended — runs before new revision goes live):

   ```bash
   cd apps/api && python -m alembic upgrade head
   ```

   Alternatively run migrations **once** manually from a shell job or first deploy SSH (Render Shell) if you prefer strict control.

7. **Health check path:** `/api/healthz` (or `/health` — both are public and DB-free).

8. **Environment variables:** see [env-production-checklist.md](./env-production-checklist.md). Minimum: `DATABASE_URL`, `SESSION_SECRET`, `TIMIQ_ENV=production`, `CORS_ALLOWED_ORIGINS`, storage (`TIMIQ_STORAGE_BACKEND=s3` + S3 keys in production).

---

## 3. Create frontend (Next.js) Web Service

1. **New** → **Web Service** (SSR) — not Static Site, unless you move to fully static export (not current TimIQ default).
2. **Build command:**

   ```bash
   cd apps/web && npm ci && npm run build
   ```

   (`npm install` is acceptable if you do not commit a lockfile strategy.)

3. **Start command:**

   ```bash
   cd apps/web && npm run start -- -p $PORT
   ```

4. **Environment (recommended — same-origin API, reliable mobile login):**

   - **`API_PROXY_URL`**: server-only, set to your API public origin, e.g. `https://timiq-api.onrender.com` (no trailing slash). Next.js **rewrites** proxy browser requests from `https://timiq-web.onrender.com/api/...` to the API. **Redeploy the web service** after changing this (rewrites are applied at build).
   - **`NEXT_PUBLIC_API_URL`**: leave **empty** or unset so the browser uses relative `/api/...` on the web origin (session cookie is first-party).
   - **`NODE_VERSION`**: e.g. `20` (match your local major if possible).

   Legacy mode (browser calls the API host directly): set `NEXT_PUBLIC_API_URL` to the API URL and configure the API for cross-site cookies (`SESSION_COOKIE_SAMESITE=none`); not recommended for mobile Safari–style issues.

   See `apps/web/.env.example`.

5. **Rewrites:** `apps/web/next.config.ts` proxies `/api/:path*` and `/health` to `API_PROXY_URL` (or `NEXT_PUBLIC_API_URL`, or `http://127.0.0.1:8000` for local) in **all** environments so production matches dev.

---

## 4. CORS

`CORS_ALLOWED_ORIGINS` on the API must include the **exact** frontend origin(s), comma-separated:

```text
https://timiq-web.onrender.com
```

`allow_credentials=True` is already set in `app/main.py`; wildcard `*` origins are **not** compatible with credentialed requests—use explicit origins.

---

## 5. Storage (production)

- **Recommended:** `TIMIQ_STORAGE_BACKEND=s3` with a **private** S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO).
- **Not recommended on default Render Web disks:** `local` storage without a **persistent disk** — uploaded files are lost on redeploy.
- Files are served only via **authenticated API** responses; do not enable public bucket reads.

Variable names: see checklist (`TIMIQ_S3_*`).

---

## 6. Migrations

- Alembic config: `apps/api/alembic.ini`, scripts under `apps/api/migrations/versions/`.
- Command: `cd apps/api && python -m alembic upgrade head`.
- Run on **every** release before or during deploy (Pre-deploy command).

---

## 6b. First administrator or company admin (fresh database)

After migrations, tables exist but **no user** is created automatically. Use the API service **Shell** on Render (or any environment with `DATABASE_URL` set). **Do not** paste real passwords into tickets or chat logs; type or paste them only in the secure shell.

Script: `apps/api/scripts/create_first_admin.py`

Required:

- `CONFIRM_CREATE_FIRST_ADMIN=yes` (intentional acknowledgement)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (strong secret; never printed by the script)

Optional:

- `ADMIN_ROLE`: `administrator` (default) or `admin`
- `ADMIN_COMPANY_NAME`: used when `ADMIN_ROLE=admin`; defaults to `TimIQ Demo Company` if unset

**Global administrator** (platform role, no company):

```bash
cd apps/api && \
CONFIRM_CREATE_FIRST_ADMIN=yes \
ADMIN_EMAIL='you@yourdomain.com' \
ADMIN_PASSWORD='REPLACE_WITH_STRONG_PASSWORD' \
python scripts/create_first_admin.py
```

**Company admin** (creates company if missing, links user as company admin):

```bash
cd apps/api && \
CONFIRM_CREATE_FIRST_ADMIN=yes \
ADMIN_ROLE=admin \
ADMIN_EMAIL='admin@yourdomain.com' \
ADMIN_PASSWORD='REPLACE_WITH_STRONG_PASSWORD' \
ADMIN_COMPANY_NAME='Your Company Ltd' \
python scripts/create_first_admin.py
```

The script does **not** print passwords or hashes. It is safe to run more than once for the same email (idempotent upsert).

---

## 7. PWA / service worker

`PwaRegister` runs only in **production** (`apps/web/src/components/pwa/pwa-register.tsx`). `public/sw.js` does **not** cache `/api/*`. Cross-origin API calls are not intercepted by the SW (different origin from the page).

---

## 8. CI (optional)

See `.github/workflows/ci.yml` for a minimal no-secrets workflow, or run the same commands locally / in your CI of choice.

---

## 9. Smoke after deploy

Follow [deployment-runbook.md](./deployment-runbook.md) §Smoke and [qa-smoke-checklist.md](./qa-smoke-checklist.md).
