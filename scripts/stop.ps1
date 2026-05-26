# HLAgent — Stop all services (Windows PowerShell)
# Compatible with Windows PowerShell 5.1+
$ErrorActionPreference = "Stop"

$resolved = Resolve-Path "$PSScriptRoot\..\.hlagent-run" -ErrorAction SilentlyContinue
$LogDir   = if ($resolved) { $resolved.Path } else { $null }

Write-Host "Stopping HLAgent services…" -ForegroundColor Yellow

foreach ($pidFile in @("gateway.pid", "web.pid")) {
    $pidPath = if ($LogDir) { "$LogDir\$pidFile" } else { $null }
    if ($pidPath -and (Test-Path $pidPath)) {
        $pid_ = [int](Get-Content $pidPath -Raw).Trim()
        $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $pid_ -Force
            Write-Host "  Stopped $pidFile (PID $pid_)" -ForegroundColor Green
        } else {
            Write-Host "  $pidFile (PID $pid_) was not running"
        }
        Remove-Item $pidPath -Force
    }
}

# fallback: kill by port
$gatewayPort = if ($env:HLAGENT_GATEWAY_PORT) { [int]$env:HLAGENT_GATEWAY_PORT } else { 8000 }
$webPort     = if ($env:HLAGENT_WEB_PORT)     { [int]$env:HLAGENT_WEB_PORT }     else { 5173 }

foreach ($port in @($gatewayPort, $webPort)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  Killed process on port $port" -ForegroundColor Green
    }
}

Write-Host "Done." -ForegroundColor Green
