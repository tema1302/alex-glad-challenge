<#
.SYNOPSIS
  Full day-15 battle run against the received pipeline in Docker.

.EXAMPLE
  ./run-battle.ps1 -PipelineDir C:\Users\user\Downloads\pipeline_day15
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$PipelineDir
)

$ErrorActionPreference = "Continue"
$PipelineDir = (Resolve-Path $PipelineDir).Path
$env:PIPELINE_DIR = $PipelineDir -replace '\\', '/'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here
New-Item -ItemType Directory -Force results | Out-Null

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string]$Arguments)
    # cmd /c merges stderr into stdout: Windows PowerShell otherwise turns
    # docker compose progress output into NativeCommandError.
    cmd /c "docker compose $Arguments 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "docker compose $Arguments failed with code $LASTEXITCODE" }
}

try {
    Write-Host "== build =="
    Invoke-Compose "build"

    Write-Host "== init: copy pipeline into volume =="
    Invoke-Compose "run --rm init"

    Write-Host "== offline probes: 41 checks on pure guards =="
    Invoke-Compose "run --rm probes"

    Write-Host "== partner offline tests =="
    Invoke-Compose "run --rm tests"

    Write-Host "== gateway + stub upstream =="
    Invoke-Compose "up -d stub gateway"
    Start-Sleep -Seconds 3

    Write-Host "== HTTP attacks =="
    Invoke-Compose "run --rm attacker"

    Write-Host "== restart gateway (reset in-memory rate limit) =="
    Invoke-Compose "restart gateway"
    Start-Sleep -Seconds 3

    Write-Host "== partner loop against stub reviewer =="
    Invoke-Compose "run --rm loop"

    Invoke-Compose "down"
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done. Artifacts:"
Write-Host "  docs/advanced-day-15/docker/results/attack-console.txt"
Write-Host "  docs/advanced-day-15/docker/results/attack-results.json"
Write-Host "  docs/advanced-day-15/docker/results/probes-console.txt"
Write-Host "  docs/advanced-day-15/docker/results/tests-console.txt"
Write-Host "  docs/advanced-day-15/docker/results/loop-console.txt"
Write-Host "  docs/advanced-day-15/docker/results/loop-runs/<run>/report.md"

