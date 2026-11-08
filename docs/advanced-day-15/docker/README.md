# Docker-полигон для боя по Day 15

Запускает **присланный** пайплайн в контейнере: их офлайн-тесты, их gateway с
LLM-заглушкой, HTTP-атаки и их execution loop. Реальная модель и ключи не
нужны; сеть нужна только для `docker compose build` (скачать `python:3.13-slim`
и Flask).

Два режима:

- **детерминированный** (заглушка) — `./run-battle.ps1 -PipelineDir <путь>`;
- **живой** (локальная модель через Ollama) — `./run-live.ps1 -PipelineDir <путь>`;
  полное описание, требования и фактические результаты — `../runbook.md`.

## Что внутри

| Файл | Роль |
|---|---|
| `Dockerfile` | Python 3.13 + Flask 3.1.3 + git/curl |
| `docker-compose.yml` | `init` (копия пайплайна в volume), `stub` (LLM-заглушка), `gateway`, `attacker`, `probes`, `tests`, `loop` |
| `stub_upstream.py` | OpenAI-compatible заглушка: отвечает по маркеру `[[stub:...]]` или по стадии loop |
| `attack_client.py` | 15 HTTP-атак + 3 контроля, таблица и `attack-results.json` |
| `wait_for_gateway.py` | ждёт `/health` |
| `run-battle.ps1` | полный прогон одной командой |

Почему `attacker` и `loop` идут с `network_mode: service:gateway`: их `app.py`
жёстко слушает `127.0.0.1`, поэтому порт наружу не публикуется, а атакующий
контейнер делит network namespace с шлюзом и ходит на `127.0.0.1:5013`.

## Запуск

Нужен Docker Desktop (Linux containers). Из этой папки:

    ./run-battle.ps1 -PipelineDir C:\Users\user\Downloads\pipeline_day15

Или вручную, шаг за шагом:

    $env:PIPELINE_DIR = "C:/Users/user/Downloads/pipeline_day15"

    docker compose build

    docker compose run --rm init

    docker compose run --rm probes

    docker compose run --rm tests

    docker compose up -d stub gateway

    docker compose run --rm attacker

    docker compose restart gateway

    docker compose run --rm loop

    docker compose down

Все команды — из `docs/advanced-day-15/docker`. `PIPELINE_DIR` — папка, в
которой лежат `gateway/` и `loop/` присланного пайплайна.

## Что смотреть в результатах

Файлы в `results/` — UTF-8, открываются в VS Code/Notepad без настроек. Для
кириллицы в консоли PowerShell перед запуском:

    chcp 65001

- `results/attack-console.txt` — таблица: `A01…A15` пробития, `C01…C03`
  контроли; внизу строка `AUDIT /audit отдаёт percent-секрет: ДА`.
- `results/attack-results.json` — те же данные машинно.
- `results/probes-console.txt` — 41 офлайн-проба (`breached=32 held=9`).
- `results/tests-console.txt` — их собственные тесты (должны быть зелёные:
  это baseline, а не защита от наших векторов).
- `results/loop-console.txt` + `results/loop-runs/<run>/report.md` — loop
  закоммитил код с обфусцированным секретом, потому что ревью-заглушка
  ответила `{"findings": []}`, а детерминированного backstop у них нет.
  Бонус: в `results.json` будет `"secrets_in_code": []`, а в `report.md` —
  «Мимо обоих: не найдено», хотя в `X1/solution.py` лежит
  `KEY = ''.join(['sk-', 'proj-…'])`: их `in_code` не декодирует join.

Для скриншотов достаточно: `attack-console.txt` (15/15 + controls),
`tests-console.txt` (их тесты зелёные), `loop-runs/<run>/X1/solution.py` +
`report.md` (коммит с секретом и «не найдено»).

## Важно

- Сгенерированный код исполняется **внутри контейнера** без ключей и без
  доступа к вашему репозиторию: это и есть причина запускать loop только здесь.
- В контейнер монтируется копия пайплайна в named volume `pipeline`; исходная
  папка партнёра не меняется. Сброс: `docker compose down -v`.
- Секреты в атаках — фейковые (`sk-…`, `ghp_…`), destructive-команды не
  исполняются: это только текст ответа/находки guard'а.
- Порт наружу не открывается; шлюз доступен только контейнерам полигона.
