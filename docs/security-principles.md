# TimIQ Security Principles

## Access model

System access roles are separate from employee job roles.

System roles:

- Administrator
- Admin
- Employee

Employee job roles are customizable business titles and do not grant system permissions by themselves.

## Data protection

- PostgreSQL is the source of truth.
- Google Drive stores files only, not payroll or employee database records.
- Secrets must come from environment variables or managed secret stores.
- Upload access must be permission-checked before file reads and writes.
- Payroll, employee, onboarding, and audit actions must be logged.

## Coding rules

- Routers define endpoints only.
- Services hold business rules.
- Repositories hold database queries.
- No large catch-all route files.
- No placeholder code.
