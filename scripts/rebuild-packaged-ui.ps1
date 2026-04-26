$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$uiDir = Join-Path $repoRoot 'ui'
$distDir = Join-Path $uiDir 'dist'
$packagedUiDir = Join-Path $repoRoot 'src\ecm_studio\assets\ui'
$packagedAssetsDir = Join-Path $packagedUiDir 'assets'

Push-Location $uiDir
try {
    npm run build
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $distDir)) {
    throw "UI build output was not found: $distDir"
}

New-Item -ItemType Directory -Path $packagedUiDir -Force | Out-Null
Copy-Item -Path (Join-Path $distDir '*') -Destination $packagedUiDir -Recurse -Force

$stableJs = Join-Path $packagedAssetsDir 'index.js'
$stableCss = Join-Path $packagedAssetsDir 'index.css'

if (Test-Path -LiteralPath $stableJs) {
    Get-ChildItem -Path $packagedAssetsDir -Filter 'index-*.js' -File | ForEach-Object {
        Copy-Item -LiteralPath $stableJs -Destination $_.FullName -Force
    }
}

if (Test-Path -LiteralPath $stableCss) {
    Get-ChildItem -Path $packagedAssetsDir -Filter 'index-*.css' -File | ForEach-Object {
        Copy-Item -LiteralPath $stableCss -Destination $_.FullName -Force
    }
}

Write-Host "Packaged UI refreshed at $packagedUiDir"
