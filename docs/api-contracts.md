# API-контракты web/

Реестр внешних контрактов HTTP API (`web/app/api/*`). Описывает текущее
поведение сервера; источник фактов — код (`challenge/src/core/*` + роуты).
При изменении контракта этот файл обновляется в том же коммите.

Ответы завёрнуты в общий конверт `jsonOk` (`{ ok: true, ... }`,
`web/lib/server/http.ts`); ошибки — через `requireApiAuth` / `withDb`.

## Геймификация: `stats`

Источник: `challenge/src/core/gamification.ts` — интерфейс `GamificationStats`
и `GamificationDb.getStats()`. Оба endpoint'а отдают поля **без преобразования**:

- `GET /api/gamification` → `stats` (`web/app/api/gamification/route.ts`);
- `GET /api/mobile/bootstrap` → `gamification.*` (`web/app/api/mobile/bootstrap/route.ts`;
  там же `achievements` — проекция `{ code, title, description, unlocked }`, без `unlockedAt`).

| Поле | Тип | Семантика |
|---|---|---|
| `xp` | `number` | Накопленный XP; только растёт. |
| `level` | `number` | Текущий уровень: `levelForXp(xp) = floor(sqrt(xp / 100)) + 1`. |
| `levelProgress` | `number` | **ДОЛЯ 0..1** прогресса внутри текущего уровня к следующему. НЕ процент и НЕ 0..100: клиент умножает на 100 сам. |
| `nextLevelXp` | `number` | **АБСОЛЮТНЫЙ XP-порог** следующего уровня: `xpForLevel(level) = 100·level²`. НЕ «сколько осталось» — остаток считается как `nextLevelXp − xp`. |
| `streak` | `number` | Текущая серия дней с активностью; сбрасывается после пропуска дня. |
| `bestStreak` | `number` | Лучшая серия за всё время. |

### Формулы и пример

```
xpForLevel(n) = 100·n²
levelProgress = (xp − xpForLevel(level − 1)) / (xpForLevel(level) − xpForLevel(level − 1))
```

Пример: `xp = 250` → `level = 2`, `levelProgress = (250 − 100) / (400 − 100) = 0.5`,
`nextLevelXp = 400`, до следующего уровня осталось `400 − 250 = 150` XP.

Границы: `levelProgress ∈ [0, 1)` для любого XP; `0` — только в точке
`xp = 100·n²` (ровно порог уровня: level-up). `award()` и `getStats()` используют
одну формулу (общий приватный helper `buildStats`), поэтому `award().stats`
всегда идентичен `getStats()`. Тест-инвариант: `0 <= levelProgress <= 1`
(`challenge/src/core/gamification.test.ts:44`).

### Потребители (обязаны трактовать как долю 0..1)

| Потребитель | Использование |
|---|---|
| Web UI `/gamification` | `web/app/gamification/page.tsx` — `Math.round(levelProgress * 100)` для процентов. |
| Android дашборд | `android/.../ui/screens/dashboard/DashboardScreen.kt` — Double-доля, `coerceIn(0f, 1f)`; контракт в `data/api/ApiModels.kt` (трактовка «доля» закреплена issue #61). |
| TG-бот | `challenge/src/core/tg/bot.ts` — `Math.round(levelProgress * 100)` в сообщении статуса. |

## Мобильный вход: `POST /api/mobile/login`

Источник: `web/app/api/mobile/login/route.ts`. Вход приложения Артель по паролю
рабочего пространства (`WEB_ADMIN_PASSWORD`); адрес сервера пользователь
вводит в приложении при первом входе (как адрес сайта) и он запоминается
на устройстве как последний успешный; пароль в APK не зашивается.
Cookie НЕ выдаётся — наружу только stateless session-токен (тот же
`createSessionValue()`, что у cookie-сессии админа: HMAC, TTL 7 дней).
Rate-limit общий с `/api/auth/login`: 10 неудач / 15 мин, глобальное окно.

Запрос: `{ "password": string }` (zod `loginSchema`).

| Код | Ответ | Условие |
|---|---|---|
| 200 | `{ ok: true, token, expiresAt }`, `Cache-Control: no-store`, без Set-Cookie | пароль верный (окно rate-limit сбрасывается) |
| 400 | `{ ok: false, error }` | невалидное тело |
| 401 | `{ ok: false, error: 'Неверный пароль' }` | неверный пароль (регистрирует неудачу) |
| 429 | `{ ok: false, error }` + `Retry-After: 900` | порог rate-limit |
| 503 | `{ ok: false, error }` | не заданы `WEB_ADMIN_PASSWORD`/`WEB_AUTH_SECRET` |

Токен передаётся как `Authorization: Bearer <token>` и принимается
`isMobileAuthed`/`requireApiAuth` (например, `GET /api/mobile/bootstrap`)
наравне со статическим `MOBILE_API_TOKEN`; сам `MOBILE_API_TOKEN` остаётся
для автоматизации/скриптов. Пароль клиента нигде не сохраняется — только
выданный токен (DataStore на Android).

Отзыва нет: токен живёт до `exp`, инвалидация — только смена
`WEB_AUTH_SECRET`; «выход» на Android удаляет токен только на устройстве.
Bearer-сессия проходит middleware только для `/api/*`; cookie-only
`requireAuth`-роуты (summary, rag/*, blog digest/publish, telegram/publish,
tg/collect) её не принимают. Ошибки 400/401/429/503 также отдают
`Cache-Control: no-store`.

## Проверка

- Инвариант доли: `pnpm --filter challenge test` (`gamification.test.ts`).
- Типы роутов: `pnpm --filter web typecheck`.

## Blog Studio: блоги и промпты агентов

Источник: `web/app/api/blogs/**`, `web/app/api/blog/pulse/route.ts`,
`challenge/src/core/db.ts`, `challenge/src/core/blogAgentPrompts.ts`.
Полное описание — `docs/blog-studio.md`.

### `GET /api/blogs`

Активные блоги по умолчанию; `?includeArchived=1` — вместе с архивом. Ответ
`{ blogs: BlogDto[], profiles: string[] }`, `Cache-Control: no-store`.

`BlogDto` (camelCase, единый маппер `toBlogDto`):

| Поле | Тип | Семантика |
|---|---|---|
| `id`, `slug`, `name` | `number/string/string` | slug стабилен после создания |
| `profile`, `hasProfile` | `string \| null`, `boolean` | профиль голоса существует |
| `tgChatId`, `tgChatIdSet` | `string \| null`, `boolean` | пусто = общий канал |
| `stylePreset` | `'default' \| 'antonov'` | пресет стиля |
| `sources`, `sourcesCount` | `string[]`, `number` | RSS-источники |
| `status`, `archivedAt` | `'active' \| 'archived'`, `string \| null` | архив |
| `systemPrompt`, `contextPrompt` | `string \| null` | легаси-промпты |
| `counts` | `{ posts, news, styleSamples, postsLast7Days, lastPostAt }` | статистика |
| `lastPostAt`, `agentPromptsCount` | `string \| null`, `number` | активность/override |
| `readyForNews` | `boolean` | `hasProfile && sourcesCount > 0` |

### `POST /api/blogs`

`requireApiAuth` (cookie/Bearer). Тело `blogCreateSchema`:
`slug` `^[a-z0-9]+(?:-[a-z0-9]+)*$` 2–64, `name` 1–120, `profile?`,
`tgChatId?`, `stylePreset?`, `sources?` (≤20 http(s)). Ответы: `201 {ok, blog}`,
`400` — валидация/неизвестный профиль, `409` — дубль slug, `401` — нет auth.

### `PATCH /api/blogs/[slug]`

`requireApiAuth`. Поля `blogPatchSchema`: `name?`, `profile?`, `tgChatId?`,
`stylePreset?`, `status?('active'|'archived')`, `systemPrompt?`, `contextPrompt?`,
`sources?`. Пустая строка промпта = `null`; `sources: []` = сброс на дефолтные
фиды. Ответ `{ok, blog: BlogDto}`; `404` — неизвестный slug.

### `GET /api/blogs/[slug]/agent-prompts`

`requireApiAuth`, `Cache-Control: no-store`. Ответ:

```json
{
  "blog": { "slug": "main", "name": "Главный" },
  "prompts": [{
    "agent": "factcheck.verdict",
    "label": "Фактчекер: вердикт",
    "description": "...",
    "group": "quality",
    "defaultPrompt": "...",
    "prompt": "кастомный или null",
    "effectivePrompt": "...",
    "source": "blog | legacy-blog-system | preset | default",
    "isOverridden": true,
    "updatedAt": "2026-11-10 12:00:00",
    "maxLength": 8000,
    "editableScope": "..."
  }]
}
```

Порядок разрешения: `blog_agent_prompts` → `blogs.system_prompt` (только
`post.writer`/`post.topic`) → `style_preset` → встроенный default.

### `PUT /api/blogs/[slug]/agent-prompts`

`requireApiAuth`. Тело `{ agent: BlogAgentId, prompt: string | null }`;
`null`/пустая строка сбрасывают override. `post.writer` пишется в
`blogs.system_prompt` (легаси-совместимость), остальные — в
`blog_agent_prompts`. Ответ `{ok, blog, prompt: <элемент реестра>}`.
`400` — неизвестный агент/длина >8000, `404` — неизвестный блог, `401` — нет auth.

### `GET /api/blog/pulse`

`requireApiAuth`, `Cache-Control: no-store`. Только активные блоги.

```json
{
  "generatedAt": "2026-11-10T12:00:00.000Z",
  "totals": { "blogs": 2, "active": 2, "needsAttention": 1, "posts": 6, "postsLast7Days": 3, "customPrompts": 2 },
  "blogs": [{
    "id": 1, "slug": "main", "name": "Главный",
    "hasProfile": true, "sourcesCount": 1, "readyForNews": true,
    "counts": { "posts": 4, "news": 5, "styleSamples": 1, "postsLast7Days": 3, "lastPostAt": "..." },
    "lastPostAt": "...", "agentPromptsCount": 2
  }]
}
```

### Архивный блог

`news`, `scout`, `blogs/[slug]/posts`, `digest/generate` возвращают `400` с
понятным сообщением; автоматизация и расписание помечают запуск ошибкой
«блог в архиве — пропущено». Чтение постов/новостей остаётся доступным.
