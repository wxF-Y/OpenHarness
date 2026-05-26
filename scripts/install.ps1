# HLAgent Installer — Windows PowerShell
# Usage: .\scripts\install.ps1 [-NoVenv] [-Dev]
[CmdletBinding()]
param(
    [switch]$NoVenv,
    [switch]$Dev
)
$ErrorActionPreference = "Stop"

# ── helpers ──────────────────────────────────────────────────────────────────
function Write-Info    { param($m) Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Ok      { param($m) Write-Host "[OK]    $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "[WARN]  $m" -ForegroundColor Yellow }
function Write-Section { param($m) Write-Host "`n── $m ──" -ForegroundColor White }
function Fail          { param($m) Write-Host "[ERROR] $m" -ForegroundColor Red; exit 1 }

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$VenvDir  = "$RepoRoot\.venv"

Write-Host ""
Write-Host "  ╔══════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     HLAgent Installer            ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
Write-Section "Checking prerequisites"

# Python
$PythonBin = $null
foreach ($py in @("python3.12","python3.11","python3.10","python3","python")) {
    $candidate = Get-Command $py -ErrorAction SilentlyContinue
    if ($candidate) {
        $ver = & $py -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        $parts = $ver -split "\."
        if ([int]$parts[0] -ge 3 -and [int]$parts[1] -ge 10) {
            $PythonBin = $py; $PythonVer = $ver; break
        }
    }
}
if (-not $PythonBin) { Fail "Python >= 3.10 not found. Install from https://python.org" }
Write-Ok "Python $PythonVer  ($PythonBin)"

# Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail "Node.js >= 18 not found. Install from https://nodejs.org" }
$nodeVer = (node --version).TrimStart("v")
if ([int]($nodeVer -split "\.")[0] -lt 18) { Fail "Node.js >= 18 required (found $nodeVer)" }
Write-Ok "Node.js v$nodeVer"

# npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm not found." }
Write-Ok "npm $(npm --version)"

# uv
$UseUv = $false
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $UseUv = $true
    Write-Ok "uv $((uv --version) -split ' ' | Select-Object -Last 1)"
} else {
    Write-Warn "uv not found — falling back to pip. Install uv: https://docs.astral.sh/uv/"
    if (-not (Get-Command pip -ErrorAction SilentlyContinue) -and
        -not (Get-Command pip3 -ErrorAction SilentlyContinue)) {
        Fail "pip not found. Install pip or uv."
    }
}
$PipBin = if (Get-Command pip3 -ErrorAction SilentlyContinue) { "pip3" } else { "pip" }

# ── 2. Virtual environment ────────────────────────────────────────────────────
Write-Section "Python virtual environment"

$UseVenv = -not $NoVenv
if ($UseVenv) {
    if (-not (Test-Path $VenvDir)) {
        Write-Info "Creating virtualenv at $VenvDir"
        & $PythonBin -m venv $VenvDir
    } else {
        Write-Info "Reusing existing virtualenv at $VenvDir"
    }
    $PythonBin = "$VenvDir\Scripts\python.exe"
    $PipBin    = "$VenvDir\Scripts\pip.exe"
    Write-Ok "Virtualenv ready"
} else {
    Write-Warn "Skipping virtualenv (-NoVenv)"
}

# ── 3. Install Python packages ────────────────────────────────────────────────
Write-Section "Installing Python packages"

function Install-Pkg {
    param([string]$Label, [string[]]$Args)
    Write-Info "Installing $Label…"
    if ($UseUv -and $UseVenv) {
        uv pip install --python $PythonBin @Args
    } elseif ($UseUv) {
        uv pip install @Args
    } else {
        & $PipBin install --quiet @Args
    }
    Write-Ok "$Label installed"
}

Install-Pkg "openharness-ai"  @("-e", $RepoRoot)
Install-Pkg "hlagent-sdk"     @("-e", "$RepoRoot\HLAgent\sdk")
Install-Pkg "hlagent-gateway" @("-e", "$RepoRoot\HLAgent\gateway")

if ($Dev) {
    Install-Pkg "dev extras" @("-e", "$RepoRoot[dev]")
}

# ── 4. Build Web frontend ──────────────────────────────────────────────────────
Write-Section "Building Web frontend"

$WebDir = "$RepoRoot\HLAgent\web"

if (-not (Test-Path "$WebDir\node_modules")) {
    Write-Info "Running npm install…"
    npm --prefix $WebDir install --silent
    Write-Ok "npm install complete"
} else {
    Write-Info "node_modules exists — skipping npm install"
}

if (-not (Test-Path "$WebDir\dist")) {
    Write-Info "Building frontend (npm run build)…"
    npm --prefix $WebDir run build
    Write-Ok "Frontend built → $WebDir\dist"
} else {
    Write-Warn "dist\ already exists — skipping build. Run 'npm --prefix HLAgent\web run build' to rebuild."
}

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  HLAgent installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Start all services:     " -NoNewline; Write-Host ".\scripts\start.ps1" -ForegroundColor White
Write-Host "  Start with Docker:      " -NoNewline; Write-Host "cd HLAgent; docker-compose up" -ForegroundColor White
Write-Host "  Open browser:           " -NoNewline; Write-Host "http://localhost:5173" -ForegroundColor White
Write-Host "  Gateway API docs:       " -NoNewline; Write-Host "http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
