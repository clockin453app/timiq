# Explicit Finance Core migration: upgrade to a7c8d9e0f1a2 only.
# NEVER runs `alembic upgrade head`. NEVER stamps. NEVER targets LIVE by default.
#
# Required env:
#   TIMIQ_ENV=test  AND  TEST_DATABASE_URL=postgresql+psycopg://.../timiq_test_*
#   OR TIMIQ_ENV=local/production with DATABASE_URL (operator path — owner only)
#
# Gates:
#   - URL host must be 127.0.0.1/localhost unless ALLOW_NONLOCAL_FINANCE_MIGRATE=1
#   - database name must match timiq_test_* unless ALLOW_NONTEST_FINANCE_MIGRATE=1
#   - refuses ports 5432 / 5433 / 5544 unless ALLOW_PROTECTED_PORTS=1

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\Steli\timiq-finance\apps\api"
$py = "C:\Users\Steli\.venvs\timiq-finance-py312\Scripts\python.exe"
$target = "a7c8d9e0f1a2"

if (-not $env:TIMIQ_ENV) { throw "TIMIQ_ENV is required." }

$url = $null
if ($env:TIMIQ_ENV.ToLower() -eq "test") {
  if (-not $env:TEST_DATABASE_URL) { throw "TEST_DATABASE_URL required when TIMIQ_ENV=test." }
  $url = $env:TEST_DATABASE_URL
  $env:DATABASE_URL = $url
} else {
  if (-not $env:DATABASE_URL) { throw "DATABASE_URL required for operator migrate." }
  $url = $env:DATABASE_URL
}

$m = [regex]::Match($url, '@([^:/]+):(\d+)/([^?\s]+)')
if (-not $m.Success) { throw "Could not parse host:port/db from URL." }
$hostName = $m.Groups[1].Value
$port = [int]$m.Groups[2].Value
$db = $m.Groups[3].Value

if ($hostName -notin @("127.0.0.1","localhost") -and $env:ALLOW_NONLOCAL_FINANCE_MIGRATE -ne "1") {
  throw "Refuse non-local host '$hostName'. Set ALLOW_NONLOCAL_FINANCE_MIGRATE=1 only with owner approval."
}
if ($db -notmatch '^timiq_test_' -and $env:ALLOW_NONTEST_FINANCE_MIGRATE -ne "1") {
  throw "Refuse database '$db' (must be timiq_test_* unless ALLOW_NONTEST_FINANCE_MIGRATE=1)."
}
if ($port -in @(5432,5433,5544) -and $env:ALLOW_PROTECTED_PORTS -ne "1") {
  throw "Refuse protected port $port. Use an isolated port (e.g. 5555/5566) or set ALLOW_PROTECTED_PORTS=1 with owner approval."
}

Write-Host "Migrating EXPLICITLY to $target on ${hostName}:${port}/$db (no head)"
& $py -m alembic current
if ($LASTEXITCODE -ne 0) { throw "alembic current failed" }
& $py -m alembic upgrade $target
if ($LASTEXITCODE -ne 0) { throw "alembic upgrade $target failed" }
& $py -m alembic current
Write-Host "DONE explicit upgrade $target"
