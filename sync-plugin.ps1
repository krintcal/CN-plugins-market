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
$targetFile = Join-Path $targetDir 'plugin.js'
Copy-Item -LiteralPath $source -Destination $targetFile -Force

# Hermes 0.22 "adopts" a marker-less folder whose plugin.js is BYTE-IDENTICAL to
# an installed package's desktop half: it stamps `.hermes-package.json` in place,
# which makes the plugin opt-in (hidden from the sidebar until toggled). A copy
# that differs by even one line is left alone as a standalone plugin and stays
# enabled by default - hence this sentinel. It is also the reason the two files
# are NOT sha-identical any more.
$sentinel = '// synced copy of desktop/plugin.js - this line keeps it byte-different from the package half so Hermes keeps it standalone (enabled by default).'
$lines = Get-Content -LiteralPath $targetFile
if ($lines -notcontains $sentinel) {
  Add-Content -LiteralPath $targetFile -Value $sentinel
}

$marker = Join-Path $targetDir '.hermes-package.json'
if (Test-Path $marker) {
  Remove-Item -LiteralPath $marker -Force
  Write-Host 'removed .hermes-package.json (marker forces the plugin off by default)'
}

$hash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
Write-Host "synced -> $targetDir"
Write-Host "sha256  $hash"
Write-Host 'the app hot-reloads plugin.js on save; the sidebar entry should stay put.'
