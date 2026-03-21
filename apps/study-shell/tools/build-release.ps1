param(
  [switch]$NoLegacyCopy
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\tooling\release\shared-release.ps1")).Path

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$release = @(Invoke-SharedRelease `
  -AppRoot $repoRoot `
  -PortableNameTemplate "Study_Shell_Portable_v{0}_{1}.exe" `
  -SetupNameTemplate "Study_Shell_Kurulum_v{0}_{1}.exe" `
  -LegacyPortableName "Study_Shell_Portable.exe" `
  -LegacySetupName "Study_Shell_Kurulum.exe" `
  -NoLegacyCopy:$NoLegacyCopy)[-1]

Write-Host "Build ID: $($release.BuildId)"
Write-Host "Open-this marker: $($release.OpenPortableInfoPath)"
Write-Host "Latest pointer: $($release.LatestPointerPath)"
