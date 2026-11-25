$ErrorActionPreference = 'Stop'

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRoot = Split-Path -Parent $scriptsDir
$supervisorJs = Join-Path $scriptsDir 'bridge-supervisor.mjs'
$logsDir = Join-Path $bridgeRoot 'logs'
$pidFile = Join-Path $logsDir 'bridge.pid'

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw 'Node.js tidak ditemukan di PATH.'
}
$nodeExe = $nodeCmd.Source

# Stop existing supervisor / worker processes before starting cleanly
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

$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir 'EkalliptusSmartPrinterBridge.vbs'

$escapedRoot = $bridgeRoot.Replace('"', '""')
$escapedNode = $nodeExe.Replace('"', '""')
$escapedSupervisor = $supervisorJs.Replace('"', '""')

$vbsContent = @"
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$escapedRoot"
shell.Run """$escapedNode"" ""$escapedSupervisor""", 0, False
"@

Set-Content -Path $startupVbs -Value $vbsContent -Encoding ASCII

$launchCmd = "wscript.exe `"$startupVbs`""
$cimRes = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $launchCmd
  CurrentDirectory = $bridgeRoot
}
if ($cimRes.ReturnValue -ne 0) {
  throw "Gagal menjalankan background service via WMI (ReturnValue=$($cimRes.ReturnValue))."
}

Start-Sleep -Seconds 3

if (-not (Test-Path $pidFile)) {
  throw "Bridge supervisor gagal menulis PID file ($pidFile)."
}

$activePid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
$proc = Get-Process -Id ([int]$activePid) -ErrorAction SilentlyContinue
if (-not $proc) {
  throw "Bridge supervisor PID $activePid tidak aktif."
}

Write-Output ("AUTOSTART_VBS=" + $startupVbs)
Write-Output ("WMI_LAUNCHER_PID=" + $cimRes.ProcessId)
Write-Output ("SUPERVISOR_PID=" + $activePid)
