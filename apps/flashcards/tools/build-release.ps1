param(
  [switch]$NoLegacyCopy
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\tooling\release\shared-release.ps1")).Path

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$release = @(Invoke-SharedRelease `
  -AppRoot $repoRoot `
  -PortableNameTemplate "Pediatri_Flashcards_Portable_v{0}_{1}.exe" `
  -SetupNameTemplate "Pediatri_Flashcards_Kurulum_v{0}_{1}.exe" `
  -LegacyPortableName "Pediatri_Flashcards_Portable.exe" `
  -LegacySetupName "Pediatri_Flashcards_Kurulum.exe" `
  -NoLegacyCopy:$NoLegacyCopy)[-1]

$sourceIndexPath = Join-Path $release.RepoRoot "index.html"
$sourceMainPath = Join-Path $release.RepoRoot "src\app\main.js"
$distIndexPath = Join-Path $release.RepoRoot "dist\index.html"
$distMainPath = Join-Path $release.RepoRoot "dist\src\app\main.js"

$openPortableInfoPath = Join-Path $release.ReleaseDir "OPEN_THIS_PORTABLE.txt"
@(
  "Bu release icin test edilecek dogru portable EXE:"
  $release.PortableTarget
  ""
  "setup_exe=$($release.SetupTarget)"
  "build_id=$($release.BuildId)"
) | Set-Content -Path $openPortableInfoPath -Encoding UTF8

$latestPointerPath = Join-Path $release.RepoRoot "LATEST_RELEASE_POINTER.txt"
@(
  "latest_release_dir=$($release.ReleaseDir)"
  "portable_exe=$($release.PortableTarget)"
  "setup_exe=$($release.SetupTarget)"
  "build_id=$($release.BuildId)"
  "legacy_copy=$(-not $release.NoLegacyCopy)"
) | Set-Content -Path $latestPointerPath -Encoding UTF8

@(
  "source_index_sha256=$(Get-ReleaseHashOrMissing -FilePath $sourceIndexPath)"
  "source_main_sha256=$(Get-ReleaseHashOrMissing -FilePath $sourceMainPath)"
  "dist_index_sha256=$(Get-ReleaseHashOrMissing -FilePath $distIndexPath)"
  "dist_main_sha256=$(Get-ReleaseHashOrMissing -FilePath $distMainPath)"
  "dist_build_metadata=$($release.BuildMetadataPath)"
  "pointer_file=$latestPointerPath"
) | Add-Content -Path $release.InfoPath -Encoding UTF8

Write-Host "Build ID: $($release.BuildId)"
Write-Host "Open-this marker: $openPortableInfoPath"
Write-Host "Latest pointer: $latestPointerPath"
