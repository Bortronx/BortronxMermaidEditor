# Builds the Blazor WASM web app fresh and deploys it to Firebase Hosting.
# Firebase/public is generated output (gitignored) - this script is the only
# supported way to populate it, so what's deployed always matches current source.
param(
    [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$publishDir = Join-Path $repoRoot "publish-web"
$publicDir = Join-Path $repoRoot "Firebase\public"

if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
dotnet publish (Join-Path $repoRoot "src\BlazorMermaidEditor.csproj") -c Release -o $publishDir

if (Test-Path $publicDir) { Remove-Item $publicDir -Recurse -Force }
New-Item -ItemType Directory -Path $publicDir | Out-Null
Copy-Item (Join-Path $publishDir "wwwroot\*") $publicDir -Recurse -Force

if ($SkipDeploy) {
    Write-Host "Skipped 'firebase deploy' (-SkipDeploy). Output is staged in $publicDir"
    return
}

Push-Location (Join-Path $repoRoot "Firebase")
try {
    firebase deploy --only hosting
} finally {
    Pop-Location
}
