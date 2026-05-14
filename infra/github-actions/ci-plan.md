# GitHub Actions CI Plan

**Status:** A minimal workflow is in **`.github/workflows/ci.yml`** (backend: pytest, compileall, app import; frontend: `npm ci`, typecheck, build). No secrets, no deploy, no database service.

Optional next steps:

- Add PostgreSQL service container only if you want `alembic upgrade head` or integration tests in CI (requires wiring `DATABASE_URL` and migrations in the job).
- Add `npm run lint` after a non-interactive ESLint config exists.
