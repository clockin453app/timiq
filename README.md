# TimIQ

TimIQ is a payroll and workforce management web app rebuilt from a clean architecture.

The previous app ZIP is used only as a product reference for features and workflows. This repository does not copy old code.

## Apps

- `apps/api` — FastAPI backend
- `apps/web` — Next.js frontend

## Local setup

This repository is **not** an npm workspace. There is **no** root `package.json` for the web app. Do **not** run `npm ci` / `npm install` at the repository root — that historically installed a conflicting Next.js tree and broke local builds.

### API (`apps/api`)

Use the repository root Python virtualenv (`.venv`), then run commands from `apps/api`:

```bash
# from repository root
python -m venv .venv
# Windows: .\.venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

cd apps/api
pip install -r requirements.txt
pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Web (`apps/web`)

Install and run **only** from `apps/web` (uses `apps/web/package-lock.json`):

```bash
cd apps/web
npm ci
npm run dev
```

Production-style check:

```bash
cd apps/web
npm ci
npm run build
npm run start
```

## Packages

- `packages/shared` — shared contracts and constants
- `packages/ui` — shared UI components
- `packages/config` — shared project configuration

## Infrastructure

- `infra/docker` — Docker files
- `infra/nginx` — reverse proxy configuration
- `infra/deployment` — pointer to Render docs in `docs/`
- `infra/github-actions` — CI notes; workflow: `.github/workflows/ci.yml`

## Deployment docs

- [docs/render-deployment.md](docs/render-deployment.md) — Render (Postgres + API + Next.js)
- [docs/deployment-runbook.md](docs/deployment-runbook.md) — ordered steps, smoke, rollback
- [docs/env-production-checklist.md](docs/env-production-checklist.md) — environment variables
- [docs/qa-smoke-checklist.md](docs/qa-smoke-checklist.md) — pre-release manual checks

## First tracked build step

Phase 0, Step 2 creates the repository structure and minimal runnable app entry points. Phase 0, Step 3 adds Docker Compose and PostgreSQL.
