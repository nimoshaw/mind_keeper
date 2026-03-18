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

$distEntry = Join-Path $repoRoot "dist\index.js"
if (-not (Test-Path $distEntry)) {
  Write-Host "[Mind Keeper] dist/index.js not found. Building first..." -ForegroundColor Yellow
  npm run build
}

Write-Host "[Mind Keeper] Starting local MCP server for Win11..." -ForegroundColor Cyan
node $distEntry
