param(
  [switch]$NoLegacyCopy
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\tooling\release\shared-release.ps1")).Path

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$null = Invoke-SharedRelease `
  -AppRoot $repoRoot `
  -PortableNameTemplate "MCQ_Test_Portable_v{0}_{1}.exe" `
  -SetupNameTemplate "MCQ_Test_Kurulum_v{0}_{1}.exe" `
  -LegacyPortableName "MCQ_Test_Portable.exe" `
  -LegacySetupName "MCQ_Test_Kurulum.exe" `
  -NoLegacyCopy:$NoLegacyCopy
