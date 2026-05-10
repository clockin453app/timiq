# TimIQ Architecture

## Monorepo layout

```txt
timiq/
  apps/
    api/
    web/
  packages/
    shared/
    ui/
    config/
  infra/
    docker/
    nginx/
    deployment/
    github-actions/
  docs/
```

## Backend rule

Each module uses this structure:

```txt
router.py
service.py
repository.py
schemas.py
models.py
permissions.py
tests.py
```

## Frontend rule

Each feature owns its API client, types, validators, components, hooks, and styles.

Page files should compose feature components rather than holding business logic.
