$ErrorActionPreference = 'Stop'

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRoot = Split-Path -Parent $scriptsDir
$pidFile = Join-Path (Join-Path $bridgeRoot 'logs') 'bridge.pid'
$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir 'EkalliptusSmartPrinterBridge.vbs'

if (Test-Path $startupVbs) {
  Remove-Item $startupVbs -Force
}

Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -or $_.Name -eq 'chrome.exe') -and (
    $_.CommandLine -like '*bridge-supervisor.mjs*' -or
    $_.CommandLine -like '*ekalliptus-printer*' -or
    ($_.CommandLine -like '*print-bridge*' -and $_.CommandLine -like '*src\index.mjs*')
  )
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

if (Test-Path $pidFile) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Output 'Ekalliptus Smart Printer Bridge autostart dihentikan dan dihapus.'
