$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
if (Test-Path -LiteralPath $wingetLinks) {
  $env:PATH = "$wingetLinks;$env:PATH"
}

$logDir = Join-Path $projectRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir ("bot-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))

Set-Location -LiteralPath $projectRoot
& node (Join-Path $projectRoot "index.js") *>> $logPath
exit $LASTEXITCODE
