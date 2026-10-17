# sync-plugin.ps1 - copy this repo's desktop/plugin.js into the Hermes Desktop
# app root, and strip the `.hermes-package.json` marker so the plugin stays
# enabled by default.
#
# Run this after `git pull`. The app watches plugin.js, so the running copy
# hot-reloads within a second or two - no restart needed.
#
#   powershell -ExecutionPolicy Bypass -File .\sync-plugin.ps1
#
# Optional: pass a different app root (the folder that holds `desktop-plugins`):
#   powershell -ExecutionPolicy Bypass -File .\sync-plugin.ps1 -AppRoot "E:\Hermes\core"

param(
  [string]$AppRoot = ""
)

$ErrorActionPreference = 'Stop'

# repo -> plugins -> <profile> -> profiles -> <hermes core>
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  $AppRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
}

$appRootDir = Join-Path $AppRoot 'desktop-plugins'
$targetDir  = Join-Path $appRootDir 'cn-plugins-market'
$source     = Join-Path $PSScriptRoot 'desktop\plugin.js'

if (-not (Test-Path $source)) { throw "missing source: $source" }

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $targetDir 'plugin.js') -Force

$marker = Join-Path $targetDir '.hermes-package.json'
if (Test-Path $marker) {
  Remove-Item -LiteralPath $marker -Force
  Write-Host 'removed .hermes-package.json (marker forces the plugin off by default)'
}

$hash = (Get-FileHash -LiteralPath (Join-Path $targetDir 'plugin.js') -Algorithm SHA256).Hash
Write-Host "synced -> $targetDir"
Write-Host "sha256  $hash"
Write-Host 'the app hot-reloads plugin.js on save; the sidebar entry should stay put.'
