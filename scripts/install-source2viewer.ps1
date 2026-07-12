param(
    [string]$Version = '19.2'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'tools\source2viewer'
$archiveDirectory = Join-Path $projectRoot 'temp\source2viewer'
$archive = Join-Path $archiveDirectory "cli-windows-x64-$Version.zip"
$versionMarker = Join-Path $destination '.bundled-version'
$requiredFiles = @(
    'Source2Viewer-CLI.exe',
    'blake3_dotnet.dll',
    'libSkiaSharp.dll',
    'spirv-cross.dll',
    'TinyEXRNative.dll'
)

function Test-ExtractorInstallation {
    if (-not (Test-Path -LiteralPath $versionMarker -PathType Leaf)) {
        return $false
    }
    if ((Get-Content -LiteralPath $versionMarker -Raw).Trim() -ne $Version) {
        return $false
    }
    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $destination $file) -PathType Leaf)) {
            return $false
        }
    }
    return $true
}

New-Item -ItemType Directory -Force $destination, $archiveDirectory | Out-Null
if (Test-ExtractorInstallation) {
    Write-Host "ValveResourceFormat $Version is ready for bundling."
    exit 0
}

$downloadUrl = "https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/$Version/cli-windows-x64.zip"
Write-Host "Provisioning ValveResourceFormat $Version for the application bundle..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force

foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $destination $file) -PathType Leaf)) {
        throw "ValveResourceFormat archive is missing required runtime file: $file"
    }
}

Set-Content -LiteralPath $versionMarker -Value $Version -NoNewline
Write-Host "ValveResourceFormat $Version is ready in $destination and will be included in the installer."
