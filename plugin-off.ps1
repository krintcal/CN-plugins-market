# plugin-off.ps1 - unload cn-plugins-market from Hermes Desktop without
# uninstalling it, and without leaving a reconstructible copy behind.
#
# A pure desktop plugin has no on/off switch in the app (the Plugins page only
# lists packages that also ship an agent half), so this moves the folder out of
# the scanned root and parks the package's desktop/ half so Electron's
# reconcile cannot copy it straight back.
#
#   powershell -ExecutionPolicy Bypass -File .\plugin-off.ps1
#
# Undo with plugin-on.ps1.

param(
  [string]$AppRoot = "",
  [string]$Profile = "priestess"
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  $AppRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
}

$live    = Join-Path $AppRoot 'desktop-plugins\cn-plugins-market'
$parkDir = Join-Path $AppRoot 'desktop-plugins-off'
$parked  = Join-Path $parkDir 'cn-plugins-market'

# Every local home that may hold the package (default home + each profile).
$sourceDirs = @(
  (Join-Path $AppRoot "plugins\cn-plugins-market\desktop"),
  (Join-Path $AppRoot "profiles\$Profile\plugins\cn-plugins-market\desktop")
) | Where-Object { Test-Path $_ }

if (-not (Test-Path $live) -and -not (Test-Path $parked)) {
  Write-Host 'nothing to do: plugin folder is not in the app root.'
  exit 0
}

# 1. Park the source halves first, so reconcile has nothing to copy back.
foreach ($src in $sourceDirs) {
  $off = "$src.off"
  if (Test-Path $src) {
    if (Test-Path $off) { Remove-Item -LiteralPath $off -Recurse -Force }
    Move-Item -LiteralPath $src -Destination $off -Force
    Write-Host "parked source: $src -> $off"
  }
}

# 2. Move the live folder out of the scanned root.
New-Item -ItemType Directory -Force -Path $parkDir | Out-Null
if (Test-Path $live) {
  if (Test-Path $parked) { Remove-Item -LiteralPath $parked -Recurse -Force }
  Move-Item -LiteralPath $live -Destination $parked -Force
  Write-Host "moved live folder -> $parked"
}

Write-Host 'done. the app unloads it on the next directory tick (a few seconds).'
Write-Host 'to bring it back run plugin-on.ps1'
