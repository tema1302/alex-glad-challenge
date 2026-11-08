param(
    [Parameter(Mandatory = $false)]
    [string]$PipelineDir = "C:/Users/user/Downloads/pipeline_day15",

    [Parameter(Mandatory = $false)]
    [string]$Model = "qwen2.5:7b-instruct",

    [Parameter(Mandatory = $false)]
    [string]$OllamaUrl = "http://host.docker.internal:11434/v1",

    [Parameter(Mandatory = $false)]
    [string]$Cases = "",

    [Parameter(Mandatory = $false)]
    [string]$Tasks = "T1",

    [switch]$Keep
)

<#
.SYNOPSIS
  Полный бой против пайплайна партнёра с РЕАЛЬНОЙ локальной моделью (Ollama).

.DESCRIPTION
  Поднимает присланный пайплайн в Docker, подключает шлюз к Ollama на хосте,
  прогоняет живые HTTP-атаки и execution loop, складывает артефакты в results/.

.EXAMPLE
  ./run-live.ps1

.EXAMPLE
  ./run-live.ps1 -PipelineDir D:/work/pipeline_day15 -Model qwen2.5-coder:7b -Task T1
#>

$ErrorActionPreference = "Continue"
$PipelineDir = (Resolve-Path $PipelineDir).Path
$env:PIPELINE_DIR = $PipelineDir -replace '\\', '/'
$env:LIVE_MODEL = $Model
$env:LIVE_BASE_URL = $OllamaUrl
$env:LIVE_TASKS = $Tasks
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here
New-Item -ItemType Directory -Force results | Out-Null

$composeArgs = "-f docker-compose.yml -f docker-compose.live.yml"

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)][string]$Arguments,
        [switch]$AllowFailure
    )
    cmd /c "docker compose $composeArgs $Arguments 2>&1"
    if ($LASTEXITCODE -ne 0) {
        if ($AllowFailure) {
            Write-Host "WARN: docker compose $Arguments exited with $LASTEXITCODE (артефакты могли сохраниться)"
            return
        }
        throw "docker compose $Arguments failed with code $LASTEXITCODE"
    }
}

try {
    Write-Host "== проверка Ollama на хосте =="
    try {
        $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 10
    } catch {
        throw "Ollama не отвечает на 127.0.0.1:11434. Запустите Ollama и повторите."
    }
    $names = @($tags.models | ForEach-Object { $_.name })
    if ($names -notcontains $Model) {
        Write-Host "Модели $Model нет в Ollama. Доступны:" ($names -join ', ')
        throw "Сначала выполните: ollama pull $Model"
    }
    Write-Host "Ollama: $Model"

    Write-Host "== чистый старт (сброс volume и аудита) =="
    Invoke-Compose "down -v"

    Write-Host "== build =="
    Invoke-Compose "build"

    Write-Host "== init: копия пайплайна в volume =="
    Invoke-Compose "run --rm init"

    Write-Host "== gateway с живой моделью =="
    Invoke-Compose "up -d gateway"
    Start-Sleep -Seconds 6

    Write-Host "== живые HTTP-атаки =="
    if ($Cases) {
        Invoke-Compose "run --rm -e CASES=$Cases attacker-live" -AllowFailure
    } else {
        Invoke-Compose "run --rm attacker-live" -AllowFailure
    }

    Write-Host "== restart gateway (сброс rate limit и счётчиков) =="
    Invoke-Compose "restart gateway"
    Start-Sleep -Seconds 4

    Write-Host "== execution loop с живой моделью, задача $Tasks =="
    Invoke-Compose "run --rm loop-live" -AllowFailure
}
finally {
    if (-not $Keep) { cmd /c "docker compose $composeArgs down 2>&1" | Out-Null }
    Pop-Location
}

Write-Host ""
Write-Host "Done. Артефакты:"
Write-Host "  docs/advanced-day-15/docker/results/attack-live-console.txt"
Write-Host "  docs/advanced-day-15/docker/results/attack-live-results.json"
Write-Host "  docs/advanced-day-15/docker/results/loop-live-console.txt"
Write-Host "  docs/advanced-day-15/docker/results/loop-live-runs/<run>/report.md"
Write-Host "  docs/advanced-day-15/docker/results/loop-live-runs/<run>/$Tasks/solution.py"
