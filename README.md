# TimIQ

TimIQ is a payroll and workforce management web app rebuilt from a clean architecture.

The previous app ZIP is used only as a product reference for features and workflows. This repository does not copy old code.

## Apps

- `apps/api` — FastAPI backend
- `apps/web` — Next.js frontend

## Packages

- `packages/shared` — shared contracts and constants
- `packages/ui` — shared UI components
- `packages/config` — shared project configuration

## Infrastructure

- `infra/docker` — Docker files
- `infra/nginx` — reverse proxy configuration
- `infra/deployment` — Render deployment configuration
- `infra/github-actions` — CI workflow files

## First tracked build step

Phase 0, Step 2 creates the repository structure and minimal runnable app entry points. Phase 0, Step 3 adds Docker Compose and PostgreSQL.
