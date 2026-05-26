# HLAgent — Start all services (Windows PowerShell)
# Usage: .\scripts\start.ps1 [-GatewayPort 8000] [-WebPort 5173] [-NoOpen]
[CmdletBinding()]
param(
    [int]$GatewayPort = $env:HLAGENT_GATEWAY_PORT ?? 8000,
    [int]$WebPort     = $env:HLAGENT_WEB_PORT     ?? 5173,
    [switch]$NoOpen
)
$ErrorActionPreference = "Stop"

function Write-Info    { param($m) Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Ok      { param($m) Write-Host "[OK]    $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "[WARN]  $m" -ForegroundColor Yellow }

$RepoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$GatewayDir = "$RepoRoot\HLAgent\gateway"
$WebDir     = "$RepoRoot\HLAgent\web"
$VenvDir    = "$RepoRoot\.venv"
$LogDir     = "$RepoRoot\.hlagent-run"

$null = New-Item -ItemType Directory -Force -Path $LogDir

Write-Host ""
Write-Host "  ╔══════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║       HLAgent — Starting         ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── activate virtualenv if present ───────────────────────────────────────────
if (Test-Path "$VenvDir\Scripts\Activate.ps1") {
    & "$VenvDir\Scripts\Activate.ps1"
    Write-Info "Virtualenv activated: $VenvDir"
}

# ── choose frontend serve mode ────────────────────────────────────────────────
$ServeMode = if (Test-Path "$WebDir\dist") { "static" } else { "dev" }

# ── free ports ────────────────────────────────────────────────────────────────
function Stop-PortProcess {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $pid_ = $conn.OwningProcess
        Write-Warn "Port $Port in use (PID $pid_) — killing"
        Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}
Stop-PortProcess $GatewayPort
Stop-PortProcess $WebPort

# ── start Gateway ──────────────────────────────────────────────────────────────
$GatewayLog = "$LogDir\gateway.log"
Write-Info "Starting Gateway on port $GatewayPort…"
$GatewayProc = Start-Process -FilePath "uvicorn" `
    -ArgumentList "main:app","--host","0.0.0.0","--port",$GatewayPort,"--log-level","info" `
    -WorkingDirectory $GatewayDir `
    -RedirectStandardOutput $GatewayLog `
    -RedirectStandardError "$LogDir\gateway-err.log" `
    -PassThru -WindowStyle Hidden
$GatewayProc.Id | Out-File "$LogDir\gateway.pid" -Encoding ascii
Write-Ok "Gateway started (PID $($GatewayProc.Id))  →  log: $GatewayLog"

# wait for gateway
Write-Info "Waiting for Gateway to become ready…"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$GatewayPort/health" -UseBasicParsing -TimeoutSec 1
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if ($ready) { Write-Ok "Gateway is ready" } else { Write-Warn "Gateway did not respond in time — check $GatewayLog" }

# ── start Web frontend ────────────────────────────────────────────────────────
$WebLog = "$LogDir\web.log"
if ($ServeMode -eq "static") {
    Write-Info "Serving pre-built frontend on port $WebPort (Python http.server)…"
    $WebProc = Start-Process -FilePath "python" `
        -ArgumentList "-m","http.server",$WebPort `
        -WorkingDirectory "$WebDir\dist" `
        -RedirectStandardOutput $WebLog `
        -RedirectStandardError "$LogDir\web-err.log" `
        -PassThru -WindowStyle Hidden
} else {
    Write-Info "Starting Vite dev server on port $WebPort…"
    $env:VITE_GATEWAY_URL = "http://localhost:$GatewayPort"
    $WebProc = Start-Process -FilePath "npm" `
        -ArgumentList "run","dev","--","--port",$WebPort `
        -WorkingDirectory $WebDir `
        -RedirectStandardOutput $WebLog `
        -RedirectStandardError "$LogDir\web-err.log" `
        -PassThru -WindowStyle Hidden
}
$WebProc.Id | Out-File "$LogDir\web.pid" -Encoding ascii
Write-Ok "Web server started (PID $($WebProc.Id))"

# ── open browser ──────────────────────────────────────────────────────────────
$AppUrl = "http://localhost:$WebPort"
if (-not $NoOpen) {
    Start-Sleep -Seconds 1
    Start-Process $AppUrl
}

# ── summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  HLAgent is running!" -ForegroundColor Green
Write-Host ""
Write-Host "  Web UI:      " -NoNewline; Write-Host $AppUrl -ForegroundColor White
Write-Host "  Gateway API: " -NoNewline; Write-Host "http://localhost:$GatewayPort" -ForegroundColor White
Write-Host "  API Docs:    " -NoNewline; Write-Host "http://localhost:$GatewayPort/docs" -ForegroundColor White
Write-Host ""
Write-Host "  Gateway log: $GatewayLog"
Write-Host "  Web log:     $WebLog"
Write-Host ""
Write-Host "  To stop:     .\scripts\stop.ps1"
Write-Host ""

# keep window alive
Write-Host "Press Ctrl+C to stop all services…" -ForegroundColor Yellow
try {
    while ($true) {
        Start-Sleep -Seconds 5
        if ($GatewayProc.HasExited) {
            Write-Warn "Gateway process exited unexpectedly — check $GatewayLog"
            break
        }
        if ($WebProc.HasExited) {
            Write-Warn "Web server process exited unexpectedly — check $WebLog"
            break
        }
    }
} finally {
    Write-Host "`nShutting down…" -ForegroundColor Yellow
    $GatewayProc | Stop-Process -Force -ErrorAction SilentlyContinue
    $WebProc      | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item "$LogDir\gateway.pid","$LogDir\web.pid" -Force -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Green
}
