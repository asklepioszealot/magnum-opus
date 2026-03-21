Set-StrictMode -Version Latest

function Resolve-SignToolPath {
  if (-not [string]::IsNullOrWhiteSpace($env:SIGNTOOL_PATH)) {
    if (-not (Test-Path $env:SIGNTOOL_PATH)) {
      throw "SIGNTOOL_PATH does not exist: $($env:SIGNTOOL_PATH)"
    }

    return $env:SIGNTOOL_PATH
  }

  $signToolCmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($signToolCmd) {
    return $signToolCmd.Source
  }

  return $null
}

function Sign-ReleaseArtifact {
  param(
    [Parameter(Mandatory = $true)][string]$SignTool,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$TimestampUrl,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$CertThumbprint
  )

  if (-not (Test-Path $FilePath)) {
    throw "Signing target not found: $FilePath"
  }

  $args = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $TimestampUrl)

  if (-not [string]::IsNullOrWhiteSpace($PfxPath)) {
    $args += @("/f", $PfxPath)
    if (-not [string]::IsNullOrWhiteSpace($PfxPassword)) {
      $args += @("/p", $PfxPassword)
    }
  } elseif (-not [string]::IsNullOrWhiteSpace($CertThumbprint)) {
    $args += @("/sha1", $CertThumbprint)
  } else {
    $args += "/a"
  }

  $args += $FilePath
  & $SignTool @args
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed for $FilePath with exit code $LASTEXITCODE"
  }
}

function Assert-ReleaseAuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path $FilePath)) {
    throw "Signature verification target not found: $FilePath"
  }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  if ($signature.Status -ne "Valid") {
    throw "Authenticode verification failed for $FilePath. Status: $($signature.Status)"
  }
}

function Get-ReleaseHashOrMissing {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path $FilePath)) {
    return "missing"
  }

  return (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash
}

function Resolve-GitWorkTreeRoot {
  param(
    [Parameter(Mandatory = $true)][string]$StartDir
  )

  $currentDir = (Resolve-Path $StartDir).Path
  while ($true) {
    if (Test-Path (Join-Path $currentDir ".git")) {
      return $currentDir
    }

    $parentDir = Split-Path -Path $currentDir -Parent
    if ([string]::IsNullOrWhiteSpace($parentDir) -or $parentDir -eq $currentDir) {
      return $null
    }

    $currentDir = $parentDir
  }
}

function Get-ReleaseRelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  $resolvedBasePath = (Resolve-Path $BasePath).Path
  $resolvedTargetPath = (Resolve-Path $TargetPath).Path
  $relativePath = [System.IO.Path]::GetRelativePath($resolvedBasePath, $resolvedTargetPath)
  return $relativePath.Replace("\", "/")
}

function Get-CargoPackageName {
  param(
    [Parameter(Mandatory = $true)][string]$CargoTomlPath
  )

  if (-not (Test-Path $CargoTomlPath)) {
    return $null
  }

  $inPackageSection = $false
  foreach ($line in Get-Content -Path $CargoTomlPath) {
    if ($line -match '^\s*\[(.+)\]\s*$') {
      $inPackageSection = $Matches[1] -eq "package"
      continue
    }

    if ($inPackageSection -and $line -match '^\s*name\s*=\s*"(?<name>[^"]+)"\s*$') {
      return $Matches.name
    }
  }

  return $null
}

function Resolve-TauriPortableExecutablePath {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot
  )

  $releaseDir = Join-Path $RepoRoot "src-tauri\target\release"
  if (-not (Test-Path $releaseDir)) {
    throw "Tauri release directory not found: $releaseDir"
  }

  $cargoTomlPath = Join-Path $RepoRoot "src-tauri\Cargo.toml"
  $cargoPackageName = Get-CargoPackageName -CargoTomlPath $cargoTomlPath
  if (-not [string]::IsNullOrWhiteSpace($cargoPackageName)) {
    $candidatePath = Join-Path $releaseDir ($cargoPackageName + ".exe")
    if (Test-Path $candidatePath) {
      return $candidatePath
    }
  }

  $fallbackExecutable = Get-ChildItem -Path $releaseDir -File -Filter "*.exe" |
    Where-Object { $_.Name -notlike "*-setup.exe" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($fallbackExecutable) {
    return $fallbackExecutable.FullName
  }

  if (-not [string]::IsNullOrWhiteSpace($cargoPackageName)) {
    throw "Portable executable not found in $releaseDir. Expected cargo package binary: $cargoPackageName.exe"
  }

  throw "Portable executable not found in $releaseDir."
}

function Invoke-SharedRelease {
  param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$PortableNameTemplate,
    [Parameter(Mandatory = $true)][string]$SetupNameTemplate,
    [Parameter(Mandatory = $true)][string]$LegacyPortableName,
    [Parameter(Mandatory = $true)][string]$LegacySetupName,
    [switch]$NoLegacyCopy
  )

  $ErrorActionPreference = "Stop"

  $repoRoot = (Resolve-Path $AppRoot).Path

  Push-Location $repoRoot
  try {
    Write-Host "[1/6] Building dist from index.html..."
    node build.mjs
    if ($LASTEXITCODE -ne 0) {
      throw "node build.mjs failed with exit code $LASTEXITCODE"
    }

    $buildIdPath = Join-Path $repoRoot "dist\build-id.txt"
    $buildMetadataPath = Join-Path $repoRoot "dist\build-metadata.json"
    $buildId = if (Test-Path $buildIdPath) {
      (Get-Content -Path $buildIdPath -Raw).Trim()
    } else {
      $null
    }

    Write-Host "[2/6] Building desktop app (NSIS)..."
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) {
      throw "npx tauri build --bundles nsis failed with exit code $LASTEXITCODE"
    }

    $portableSource = Resolve-TauriPortableExecutablePath -RepoRoot $repoRoot

    $nsisDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
    $setupSource = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if (-not $setupSource) {
      throw "NSIS setup file not found under: $nsisDir"
    }

    $tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
    $tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
    $version = [string]$tauriConfig.version
    if ([string]::IsNullOrWhiteSpace($version)) {
      $version = "unknown"
    }

    $gitRoot = Resolve-GitWorkTreeRoot -StartDir $repoRoot
    $safeGitRoot = if ($gitRoot) { $gitRoot.Replace("\", "/") } else { $null }
    $commitOutput = if ($gitRoot) {
      git -c "safe.directory=$safeGitRoot" -C $gitRoot rev-parse --short HEAD 2>$null
    } else {
      $null
    }
    $commit = if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($commitOutput)) {
      ([string]$commitOutput).Trim()
    } elseif ($buildId -match '-(?<commit>[0-9a-z]+)-\d{14}$') {
      $Matches.commit
    } else {
      "nogit"
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $releaseDir = Join-Path $repoRoot ("release\" + $timestamp + "_v" + $version + "_" + $commit)
    New-Item -Path $releaseDir -ItemType Directory -Force | Out-Null

    if ([string]::IsNullOrWhiteSpace($buildId)) {
      $buildId = "$version-$commit-$($timestamp.Replace('-', ''))"
    }

    $portableName = $PortableNameTemplate -f $version, $commit
    $setupName = $SetupNameTemplate -f $version, $commit
    $portableTarget = Join-Path $releaseDir $portableName
    $setupTarget = Join-Path $releaseDir $setupName

    Write-Host "[3/6] Copying artifacts to release folder..."
    Copy-Item -Path $portableSource -Destination $portableTarget -Force
    Copy-Item -Path $setupSource.FullName -Destination $setupTarget -Force

    $legacyPortablePath = Join-Path $repoRoot $LegacyPortableName
    $legacySetupPath = Join-Path $repoRoot $LegacySetupName

    if (-not $NoLegacyCopy) {
      Write-Host "[4/6] Syncing legacy root file names..."
      Copy-Item -Path $portableSource -Destination $legacyPortablePath -Force
      Copy-Item -Path $setupSource.FullName -Destination $legacySetupPath -Force
    } else {
      Write-Host "[4/6] Skipping legacy root file names (-NoLegacyCopy)."
    }

    $signEnable = [string]$env:SIGN_ENABLE
    $signEnableNormalized = $signEnable.Trim()
    $signingRequired = $signEnableNormalized -eq "1"
    $signPfxPath = $env:SIGN_PFX_PATH
    $signPfxPassword = $env:SIGN_PFX_PASSWORD
    $signCertThumbprint = $env:SIGN_CERT_SHA1
    $timestampUrl = if (-not [string]::IsNullOrWhiteSpace($env:SIGN_TIMESTAMP_URL)) {
      $env:SIGN_TIMESTAMP_URL
    } else {
      "http://timestamp.digicert.com"
    }

    $signingRequested =
      $signingRequired -or
      -not [string]::IsNullOrWhiteSpace($signPfxPath) -or
      -not [string]::IsNullOrWhiteSpace($signCertThumbprint)

    if ($signingRequested) {
      Write-Host "[5/6] Signing artifacts..."
      if (-not [string]::IsNullOrWhiteSpace($signPfxPath) -and -not (Test-Path $signPfxPath)) {
        throw "SIGN_PFX_PATH not found: $signPfxPath"
      }

      $signToolPath = Resolve-SignToolPath
      if (-not $signToolPath) {
        throw "signtool.exe was not found. Add it to PATH or set SIGNTOOL_PATH."
      }

      $artifactsToSign = @($portableTarget, $setupTarget)
      if (-not $NoLegacyCopy) {
        $artifactsToSign += @($legacyPortablePath, $legacySetupPath)
      }

      foreach ($artifact in $artifactsToSign) {
        Sign-ReleaseArtifact -SignTool $signToolPath -FilePath $artifact -TimestampUrl $timestampUrl -PfxPath $signPfxPath -PfxPassword $signPfxPassword -CertThumbprint $signCertThumbprint
        Assert-ReleaseAuthenticodeSignature -FilePath $artifact
      }
    } else {
      if ($signingRequired) {
        throw "SIGN_ENABLE=1 set edildi ancak imzalama adimi calistirilamadi."
      }
      Write-Host "[5/6] Skipping signing (set SIGN_ENABLE=1, SIGN_PFX_PATH or SIGN_CERT_SHA1)."
    }

    $infoPath = Join-Path $releaseDir "release-info.txt"
    @(
      "version=$version"
      "commit=$commit"
      "timestamp=$timestamp"
      "build_id=$buildId"
      "portable_source=$portableSource"
      "setup_source=$($setupSource.FullName)"
      "legacy_copy=$(-not $NoLegacyCopy)"
    ) | Set-Content -Path $infoPath -Encoding UTF8

    $portableHash = (Get-FileHash -Path $portableTarget -Algorithm SHA256).Hash
    $setupHash = (Get-FileHash -Path $setupTarget -Algorithm SHA256).Hash

    $appRelativePath = if ($gitRoot) {
      Get-ReleaseRelativePath -BasePath $gitRoot -TargetPath $repoRoot
    } else {
      Split-Path -Path $repoRoot -Leaf
    }
    $releaseRelativeDir = Get-ReleaseRelativePath -BasePath $repoRoot -TargetPath $releaseDir
    $portableRelativePath = Get-ReleaseRelativePath -BasePath $repoRoot -TargetPath $portableTarget
    $setupRelativePath = Get-ReleaseRelativePath -BasePath $repoRoot -TargetPath $setupTarget

    $latestPointerPath = Join-Path $repoRoot "LATEST_RELEASE_POINTER.txt"
    @(
      "format=magnum-release-pointer-v1"
      "app_path=$appRelativePath"
      "updated_at=$(Get-Date -Format o)"
      "latest_release_dir=$releaseRelativeDir"
      "portable_exe=$portableRelativePath"
      "setup_exe=$setupRelativePath"
      "build_id=$buildId"
      "portable_sha256=$portableHash"
      "setup_sha256=$setupHash"
      "legacy_copy=$(-not $NoLegacyCopy)"
    ) | Set-Content -Path $latestPointerPath -Encoding UTF8

    $openPortableInfoPath = Join-Path $releaseDir "OPEN_THIS_PORTABLE.txt"
    @(
      "Bu release icin test edilecek dogru portable EXE:"
      $portableTarget
      ""
      "setup_exe=$setupTarget"
      "build_id=$buildId"
      "pointer_file=$latestPointerPath"
    ) | Set-Content -Path $openPortableInfoPath -Encoding UTF8

    Write-Host "[6/6] Done."
    Write-Host ""
    Write-Host "Release folder: $releaseDir"
    Write-Host "Portable: $portableTarget"
    Write-Host "Portable SHA256: $portableHash"
    Write-Host "Setup: $setupTarget"
    Write-Host "Setup SHA256: $setupHash"
    Write-Host "Open-this marker: $openPortableInfoPath"
    Write-Host "Latest pointer: $latestPointerPath"

    return [PSCustomObject]@{
      RepoRoot = $repoRoot
      Version = $version
      Commit = $commit
      Timestamp = $timestamp
      BuildId = $buildId
      BuildMetadataPath = $buildMetadataPath
      ReleaseDir = $releaseDir
      PortableSource = $portableSource
      SetupSource = $setupSource.FullName
      PortableTarget = $portableTarget
      SetupTarget = $setupTarget
      LegacyPortablePath = $legacyPortablePath
      LegacySetupPath = $legacySetupPath
      NoLegacyCopy = [bool]$NoLegacyCopy
      InfoPath = $infoPath
      LatestPointerPath = $latestPointerPath
      OpenPortableInfoPath = $openPortableInfoPath
      PortableHash = $portableHash
      SetupHash = $setupHash
    }
  } finally {
    Pop-Location
  }
}
