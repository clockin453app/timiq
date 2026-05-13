# TimIQ backup and restore runbook

This document describes how to protect TimIQ data in production. TimIQ does not schedule backups for you; operators must configure database and file storage backups outside the application.

## 1. What must be backed up

1. **PostgreSQL database** — all relational data (users, sessions, payroll, time entries, audit events, onboarding metadata, and so on).
2. **Private blob storage** — uploads that are not stored in the database (for example clock selfies, onboarding documents, work progress attachments). The database stores **relative keys** only; the actual bytes live under `TIMIQ_STORAGE_ROOT` (local) or in a **private** S3-compatible bucket when `TIMIQ_STORAGE_BACKEND=s3`. Restore **database and blobs together** so keys still resolve.

## 2. Database backup

- Use your hosting provider’s automated Postgres backups, or `pg_dump` / continuous archiving (WAL), following your organisation’s retention policy.
- Store dumps in an encrypted object store or vault; **never** commit dumps, credentials, or `.env` files to git.
- Test restores at least quarterly on a non-production instance.

## 3. Storage backup

### Local disk (`TIMIQ_STORAGE_BACKEND=local`)

- The directory from `TIMIQ_STORAGE_ROOT` (or the API default) must live on **durable disk** included in your VM snapshot or file-level backup job.
- Preserve the **relative path layout** under the root so restored rows match on-disk keys.

### Private S3-compatible bucket (`TIMIQ_STORAGE_BACKEND=s3`)

- Treat the bucket as **private**: no public object ACLs, no anonymous listing; the app never exposes object URLs or keys to browsers—it streams through authenticated API routes after permission checks.
- Use your provider’s **versioning**, **lifecycle**, and **cross-region replication** where appropriate; restrict access with least-privilege IAM (or equivalent) scoped to the bucket and optional prefix (`TIMIQ_S3_PREFIX`).
- **Rotate access keys** on a schedule; store credentials only in your secret manager or deployment environment—never in git, tickets, or screenshots.
- Backups are **operator-defined**: replication to another bucket/region, export jobs, or provider-managed backup products—not something TimIQ schedules.

## 4. Restore order

1. Restore **PostgreSQL** from a known-good backup to a clean instance.
2. Restore **blobs**: for local storage, restore the tree under `TIMIQ_STORAGE_ROOT` with the same relative layout; for S3, restore objects into the same bucket/prefix so DB `storage_path` values still resolve.
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
- [ ] `TIMIQ_STORAGE_BACKEND` / `TIMIQ_STORAGE_ROOT` (or S3 variables) documented in deployment docs (see `apps/api/.env.example`).
- [ ] Restore drill performed and documented.

## 8. Storage root and disk persistence

- When using **local** storage, `TIMIQ_STORAGE_ROOT` must point at a directory on **persistent** disk (not ephemeral container scratch unless your backup strategy covers it).
- The API never exposes the resolved filesystem path in audit or system-health JSON; operators must track the path in secure runbooks or infrastructure-as-code.

## 9. Alembic migrations before and after restore

- After restoring a database dump, compare the `alembic_version` row with the revision expected by the deployed API image.
- If the dump is older than the code, run `alembic upgrade head` (or your deployment pipeline equivalent) only after reviewing migration notes—never downgrade production blindly.
- If the dump is newer than the code, deploy a matching API version first, then validate before opening traffic.

## 10. Operator-facing status (System Health)

- The **System Health** screen summarises connectivity and backup *readiness* only; it does not configure backups. It reports `storage_backend` as `local` or `s3` and whether a write probe passed—**never** bucket names, endpoints, access keys, or filesystem paths.
- Treat **database backup** and **storage backup** as **manual_or_unknown** until your platform proves automated snapshots or object-storage policies.
- **Restore tests** remain a manual discipline: schedule them on a non-production clone at least quarterly.
