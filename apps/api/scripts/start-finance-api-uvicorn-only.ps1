# Start Finance API with Uvicorn ONLY — no Alembic / no auto-migrate.
# Intended local/Render shape: migration is a separate, explicit step.
#
# Required env (set by caller; never commit secrets):
#   DATABASE_URL, SESSION_SECRET, TIMIQ_ENV
# Optional:
#   CORS_ALLOWED_ORIGINS, HOST (default 127.0.0.1), PORT (default 8000),
#   FINANCE_PREVIEW_MODE
#
# Example (local):
#   $env:TIMIQ_ENV='local'
#   $env:DATABASE_URL='postgresql+psycopg://...@127.0.0.1:5566/timiq_test_...'
#   $env:SESSION_SECRET='...'
#   .\scripts\start-finance-api-uvicorn-only.ps1

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\Steli\timiq-finance\apps\api"

if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required." }
if (-not $env:SESSION_SECRET) { throw "SESSION_SECRET is required." }
if (-not $env:TIMIQ_ENV) { $env:TIMIQ_ENV = "local" }

# Hard refuse accidental migrate-on-start patterns in this process.
if ($env:FINANCE_AUTO_MIGRATE -eq "1") {
  throw "Refuse: FINANCE_AUTO_MIGRATE=1. Use migrate-finance-explicit-a7.ps1 separately."
}

$hostBind = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$port = if ($env:PORT) { $env:PORT } else { "8000" }
$py = "C:\Users\Steli\.venvs\timiq-finance-py312\Scripts\python.exe"

Write-Host "Starting uvicorn-only (no alembic) on ${hostBind}:${port} TIMIQ_ENV=$($env:TIMIQ_ENV)"
& $py -m uvicorn app.main:app --host $hostBind --port $port
