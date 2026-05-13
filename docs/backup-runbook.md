# TimIQ backup and restore runbook

This document describes how to protect TimIQ data in production. TimIQ does not schedule backups for you; operators must configure database and file storage backups outside the application.

## 1. What must be backed up

1. **PostgreSQL database** — all relational data (users, sessions, payroll, time entries, audit events, onboarding metadata, and so on).
2. **Private file storage** — uploads that are not stored in the database (for example clock selfies, onboarding documents, work progress attachments), rooted at the configured storage backend.

## 2. Database backup

- Use your hosting provider’s automated Postgres backups, or `pg_dump` / continuous archiving (WAL), following your organisation’s retention policy.
- Store dumps in an encrypted object store or vault; **never** commit dumps, credentials, or `.env` files to git.
- Test restores at least quarterly on a non-production instance.

## 3. Storage backup

- When using **local disk** (`TIMIQ_STORAGE_ROOT` or the API default), the directory must live on **durable disk** that is included in your VM snapshot or file-level backup job.
- When **object storage** is configured (future batch), enable versioning and cross-region replication where appropriate, and restrict bucket access with IAM policies.

## 4. Restore order

1. Restore **PostgreSQL** from a known-good backup to a clean instance.
2. Restore **files** to the same relative layout the API expects (matching `TIMIQ_STORAGE_ROOT` or the configured backend).
3. Align **Alembic revision** with the codebase you deploy (run migrations if you are restoring an older dump onto a newer app version—follow your DBA playbook).
4. Smoke-test: login, open one payroll week, one payslip, one stored upload path through the app (not by browsing raw paths).

## 5. Testing a restore

- Restore to an isolated database and storage prefix; point a staging API at it; verify counts and a sample of payroll rows match expectations.
- Do not use production secrets in staging; rotate if copies are made.

## 6. Security reminders

- Do not expose `DATABASE_URL`, session secrets, OAuth client secrets, or storage credentials in audit logs, support tickets, or screenshots.
- Audit log API responses are **sanitised**; stored rows may still contain historical data—treat database backups as **highly sensitive**.

## 7. TimIQ-specific checklist

- [ ] Postgres backups scheduled and monitored.
- [ ] Storage volume or bucket included in backup scope.
- [ ] `TIMIQ_STORAGE_ROOT` documented in deployment docs (see `apps/api/.env.example`).
- [ ] Restore drill performed and documented.
