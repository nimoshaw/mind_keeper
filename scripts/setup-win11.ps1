$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Get-NodeMajorVersion {
  $rawVersion = node --version
  if (-not $rawVersion) {
    throw "Node.js 22+ is required, but node was not found in PATH."
  }

  $normalized = $rawVersion.Trim().TrimStart("v")
  $major = [int]($normalized.Split(".")[0])
  return $major
}

$nodeMajor = Get-NodeMajorVersion
if ($nodeMajor -lt 22) {
  throw "Node.js 22+ is required for Mind Keeper. Current major version: $nodeMajor"
}

Write-Host "[Mind Keeper] Installing dependencies for Win11..." -ForegroundColor Cyan
npm install

Write-Host "[Mind Keeper] Building release output..." -ForegroundColor Cyan
npm run build

Write-Host "[Mind Keeper] Win11 setup completed." -ForegroundColor Green
