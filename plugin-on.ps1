# plugin-on.ps1 - bring cn-plugins-market back after plugin-off.ps1.
#
# Restores the package's desktop/ halves first, then moves the live folder back
# into the app root with NO `.hermes-package.json` marker, so the app loads it
# enabled by default (a marker would make it opt-in and no switch exists).
#
#   powershell -ExecutionPolicy Bypass -File .\plugin-on.ps1

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

# 1. Restore the parked source halves.
foreach ($src in @(
  (Join-Path $AppRoot "plugins\cn-plugins-market\desktop"),
  (Join-Path $AppRoot "profiles\$Profile\plugins\cn-plugins-market\desktop")
)) {
  $off = "$src.off"
  if (Test-Path $off) {
    if (Test-Path $src) { Remove-Item -LiteralPath $src -Recurse -Force }
    Move-Item -LiteralPath $off -Destination $src -Force
    Write-Host "restored source: $off -> $src"
  }
}

# 2. Move the live folder back.
if (-not (Test-Path $parked)) {
  Write-Host 'nothing to restore: no parked copy found.'
  exit 0
}
if (Test-Path $live) {
  Write-Host "live folder already present at $live - leaving it alone."
  exit 0
}
Move-Item -LiteralPath $parked -Destination $live -Force

# 3. A marker anywhere in that folder would flip it back to opt-in.
$marker = Join-Path $live '.hermes-package.json'
if (Test-Path $marker) {
  Remove-Item -LiteralPath $marker -Force
  Write-Host 'removed .hermes-package.json (would have kept it disabled)'
}

$hash = (Get-FileHash -LiteralPath (Join-Path $live 'plugin.js') -Algorithm SHA256).Hash
Write-Host "restored -> $live"
Write-Host "sha256    $hash"
Write-Host 'the app loads it on the next directory tick (a few seconds).'
