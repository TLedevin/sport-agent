<#
.SYNOPSIS
  Runs the whole app locally: backend on http://localhost:8000, frontend on http://localhost:5173.

.DESCRIPTION
  Uses a local SQLite database (backend/local.db), never the Azure one.
  The backend opens in a second window; closing this script (Ctrl+C) stops both.

.PARAMETER Seed
  Adds a few fake activities, to try the app without Garmin.

.PARAMETER Reset
  Deletes the local database first (all local activities and Garmin tokens).

.EXAMPLE
  .\dev.ps1 -Seed
#>
param(
    [switch]$Seed,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

foreach ($tool in "uv", "npm") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "'$tool' was not found. Install it, then open a new terminal."
    }
}

# Backend settings for local runs.
$envFile = Join-Path $backend ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $backend ".env.example") $envFile
    Write-Host "Created backend/.env - the local app password is 'dev-password'." -ForegroundColor Yellow
}

# Frontend dependencies (first run only).
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $frontend
    npm install --no-fund --no-audit
    Pop-Location
}

Push-Location $backend
try {
    uv sync --quiet
    if ($Reset -and (Test-Path "local.db")) {
        Remove-Item "local.db"
        Write-Host "Local database deleted."
    }
    if ($Seed) {
        uv run python scripts/seed_sample_data.py
    }
} finally {
    Pop-Location
}

# Backend in its own window, so its logs stay readable.
$api = Start-Process powershell -PassThru -WorkingDirectory $backend -ArgumentList @(
    "-NoExit", "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'Sport Agent API'; uv run uvicorn app.main:app --reload --port 8000"
)

Write-Host ""
Write-Host "Backend:  http://localhost:8000/docs  (logs in the other window)" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173       (Ctrl+C here stops both)" -ForegroundColor Green
Write-Host "Password: see APP_PASSWORD in backend/.env" -ForegroundColor Green
Write-Host ""

try {
    Push-Location $frontend
    npm run dev -- --open
} finally {
    Pop-Location
    # Stop the backend window and the uvicorn processes it started.
    try { taskkill /PID $api.Id /T /F 2>$null | Out-Null } catch { }  # already closed
    Write-Host "Stopped."
}
