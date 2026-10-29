# Задача: антимайнер — регулярная проверка системы

## Контекст

29.10.2026 на этой машине (Windows, AMD Ryzen 5 3600, AMD Radeon RX 7600, Windows Defender)
был найден и удалён скрытый криптомайнер:

- **Майнеры:** SRBMiner / peakminer, замаскированные под `SecurityHealthHost.exe`
  (алгоритм pearlhash, монета PRL, майнили только когда пользователь неактивен).
- **Сторож (watchdog):** `RuntimeHost.exe`, работал через process hollowing
  в `C:\WINDOWS\Microsoft.NET\Framework\v4.0.30319\InstallUtil.exe` (PID 34416),
  имел C2-канал (`wss://...:8443/ws`), получал команды `CLIENT_UPDATE`,
  восстанавливал автозапуск после удаления, отправлял SysInfo о машине.
- **Папки малвари (уже в карантине):**
  - `C:\Users\user\AppData\Roaming\Microsoft\Windows\Caches\4259B89A\` (сторож)
  - `C:\Users\user\AppData\Local\Microsoft\Windows\Caches\B283B4E1\` (майнеры srbminer/peakminer)
  - `C:\Users\user\AppData\Local\Microsoft\Windows\Caches\4259B89A\Content.IE5\...` (резервная копия)
  - Карантин: `E:\IT\alex-glad-challenge\quarantine-miner\`
- **Удалённые точки автозапуска:**
  - задача планировщика `Windows System Health Check` (и варианты `Windows System Health`, `Windows System Health Monitor`)
  - ключ реестра `HKCU\Software\Microsoft\Windows\CurrentVersion\Run :: WinSysCache`
  - ярлык `RuntimeHost.lnk` в папке «Автозагрузка»
- Defender опознал компоненты как `Trojan:Win32/Wacatac.B!ml`, `Commando.A!ml`, `Commandrob.A!ml`.
- Первичное заражение предположительно произошло задолго до обнаружения
  (папка `Roaming\Microsoft\Windows\Caches` создана 07.06.2026). Подозреваемый вектор —
  неподписанная программа **Moshi Hook** (`C:\Users\user\AppData\Local\Programs\Moshi Hook\`),
  установленная 22.10.2026; виновность не доказана.

## Цель

Убедиться, что майнер не восстановился и не появился заново. Машина под контролем пользователя;
скрипты выполнять через PowerShell 5.1 (без оператора `??`; bash съедает `$_` — скрипты писать
в файл и запускать `powershell -NoProfile -ExecutionPolicy Bypass -File <script>.ps1`).

## Что проверять при каждом запуске

### 1. Планировщик задач
- Все задачи, чьи действия указывают на `AppData`, `Caches`, `Temp`, `ProgramData\Microsoft\Windows\Caches`.
- Задачи с именами `*Health*`, `*Cache*`, `*Runtime*`, `*System*`, созданные после 29.10.2026.
- Сравнить с известными легитимными: Zoom, CometUpdater.

### 2. Службы Windows
- `Win32_Service`, где `PathName` содержит `AppData`, `Caches`, `Temp`.
- Неподписанные исполняемые файлы служб.

### 3. Автозапуск
- `HKCU/HKLM:\Software\Microsoft\Windows\CurrentVersion\Run` и `RunOnce` —
  новые значения, особенно `WinSysCache` или ссылки на `Caches`.
- Папка `shell:startup` (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) —
  ярлыки вроде `RuntimeHost.lnk`.
- WMI-подписки `root\subscription` (`__EventFilter`, `CommandLineEventConsumer`).

### 4. Процессы
- Процессы с именами `SecurityHealthHost.exe`, `RuntimeHost.exe` **не из** `C:\Windows\*`.
- Процессы, запущенные из путей `*\Microsoft\Windows\Caches\*`, `*\srbminer*`, `*\peakminer*`, `*\bzminer*`.
- Подозрительные `InstallUtil.exe` без командной строки (признак process hollowing).

### 5. Файловая система
- Существование папок:
  - `%APPDATA%\Microsoft\Windows\Caches\4259B89A`, `%APPDATA%\Microsoft\Windows\Caches\B283B4E1`
  - `%LOCALAPPDATA%\Microsoft\Windows\Caches\4259B89A`, `...\B283B4E1`
  - `C:\ProgramData\Microsoft\Windows\Caches\4259B89A`
- Файлы `SecurityHealthHost.exe`, `RuntimeHost.exe`, `miner.dat`, `.mout`, `WinRing0x64.sys`
  вне `C:\Windows` и вне карантина `E:\IT\alex-glad-challenge\quarantine-miner\`.

### 6. GPU
- Счётчик `\GPU Engine(*)\Utilization Percentage` (2–3 замера по 1 с):
  процессы с `engtype_compute` выше ~10% — признак скрытого майнинга.
- `\GPU Process Memory(*)\Dedicated Usage` — кто занимает видеопамять.

### 7. Сеть
- Исходящие соединения на порты `1200`, `3360`, `4041`, `8048`, `8443` от процессов
  вне браузеров/системных (пулы майнеров и C2).

### 8. Windows Defender
- `Get-MpThreatDetection` — новые обнаружения за последние 24 часа.
- Убедиться, что realtime-защита включена (`Get-MpComputerStatus`).

### 9. Moshi Hook (отдельным пунктом)
- Существует ли ещё `C:\Users\user\AppData\Local\Programs\Moshi Hook\` и автозапуск `MoshiHook`.
- Напомнить пользователю принять решение об удалении, если он не устанавливал её осознанно.

## Формат отчёта

1. **Вердикт:** `ЧИСТО` / `ПОДОЗРЕНИЕ` / `ЗАРАЖЕНИЕ ПОВТОРНО`.
2. Таблица по каждому из 9 разделов: что проверено, что найдено.
3. При находках: точные пути/PID/имена, степень уверенности, рекомендуемые действия
   (не удалять ничего без подтверждения пользователя — только карантин/отчёт).
4. Если всё чисто — короткий отчёт без лишних деталей.

## Ограничения

- Ничего не удалять и не останавливать без явного подтверждения пользователя.
  Исключение: файлы в карантине не трогать вообще.
- Не читать и не выводить содержимое `.env`, ключей, паролей, сессий.
- Все проверки — только чтение (Get-*, реестр, счётчики производительности).
