// scripts/send-apk-telegram.mts — доставка собранного APK владельцу в Telegram.
//
// Правило проекта (AGENTS.md §14): пуш в `main` завершается отправкой свежего
// debug-APK. Скрипт — только доставка готового файла: сборка отдельным шагом,
// ошибки доставки не смешиваются с ошибками сборки.
//
// Секреты (STRICT): TG_BOT_TOKEN / TG_CHAT_ID читаются только из окружения или
// gitignored `.env` через core/env; в код, логи и коммиты не попадают.
//
// Использование:
//   pnpm apk:send                     — отправить текущий APK
//   pnpm apk:send -- --force          — отправить, даже если SHA уже доставлен
//   pnpm apk:send -- --check          — проверить бота и чат, ничего не отправляя
//   pnpm apk:send -- --apk <path> --caption "<текст>"
//
// Коды выхода: 0 — отправлено/пропущен дубль; 1 — нет APK или креденшалов;
// 2 — Telegram отклонил отправку / сеть.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTgBotConfig, loadEnvUpward } from '../challenge/src/core/env.js';
import { netFetch } from '../challenge/src/core/net.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);
loadEnvUpward();

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(name);

const apkPath = path.resolve(
  argValue('--apk') ?? 'android/app/build/outputs/apk/debug/app-debug.apk',
);
const checkOnly = hasFlag('--check');
const force = hasFlag('--force');

/** Токен не должен утечь в лог даже из текста сетевой ошибки. */
function sanitize(message: string): string {
  return message.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<скрыт>');
}

function fail(code: number, message: string): never {
  console.error(sanitize(message));
  process.exit(code);
}

const cfg = getTgBotConfig();
if (!cfg) fail(1, 'Нет TG_BOT_TOKEN / TG_CHAT_ID: заполните .env или окружение');

async function api<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await netFetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    label: 'Telegram Bot API',
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string; result?: T }
    | null;
  if (!res.ok || !data?.ok) {
    fail(2, `Telegram ${method}: ${data?.description ?? `HTTP ${res.status}`}`);
  }
  return data.result as T;
}

if (checkOnly) {
  const me = await api<{ id: number; username?: string; first_name?: string }>('getMe', {});
  const chat = await api<{ id: number; type: string; title?: string; username?: string }>(
    'getChat',
    { chat_id: cfg.chatId },
  );
  console.log(
    `bot: @${me.username ?? me.first_name ?? me.id}; ` +
      `chat: ${chat.type} ${chat.title ?? chat.username ?? chat.id}`,
  );
  process.exit(0);
}

if (process.env.TG_DELIVER_SKIP === '1') {
  console.log('APK delivery skipped: TG_DELIVER_SKIP=1 (явная команда владельца)');
  process.exit(0);
}

const stat = statSync(apkPath, { throwIfNoEntry: false });
if (!stat) fail(1, `APK не найден: ${apkPath}\nСначала соберите: android\\gradlew.bat :app:assembleDebug`);

const bytes = readFileSync(apkPath);
const sizeMb = (bytes.length / (1024 * 1024)).toFixed(1);
const sha = createHash('sha256').update(bytes).digest('hex');

/** Каталог git (в worktree `.git` — файл, поэтому спрашиваем git). */
function gitDir(): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(repoRoot, out);
  } catch {
    return path.join(repoRoot, '.git');
  }
}

const deliveredMarker = path.join(gitDir(), 'tg-delivered-sha');
let lastSha = '';
try {
  lastSha = readFileSync(deliveredMarker, 'utf8').trim();
} catch {
  // маркера ещё нет — первая доставка
}

if (!force && lastSha === sha) {
  console.log(`APK уже доставлен: sha256=${sha.slice(0, 12)}… (--force — отправить заново)`);
  process.exit(0);
}

function gitSummary(): string {
  try {
    const shaShort = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return `${shaShort} · ${subject}`;
  } catch {
    return 'without-git';
  }
}

function apkVersion(): string {
  try {
    const gradle = readFileSync(path.join(repoRoot, 'android/app/build.gradle.kts'), 'utf8');
    const name = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
    const code = /versionCode\s*=\s*(\d+)/.exec(gradle)?.[1];
    return [name, code ? `(${code})` : undefined].filter(Boolean).join(' ') || 'unknown';
  } catch {
    return 'unknown';
  }
}

const caption =
  argValue('--caption') ??
  [
    `«Артель» ${apkVersion()} · debug APK`,
    `alex-glad-challenge · ${gitSummary()}`,
    `${sizeMb} МБ · sha256 ${sha.slice(0, 12)}…`,
    `Собрано ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');

const form = new FormData();
form.append('chat_id', cfg.chatId);
form.append('caption', caption);
form.append(
  'document',
  new Blob([bytes], { type: 'application/vnd.android.package-archive' }),
  path.basename(apkPath),
);

const res = await netFetch(`https://api.telegram.org/bot${cfg.botToken}/sendDocument`, {
  method: 'POST',
  body: form,
  timeoutMs: 120_000,
  label: 'Telegram Bot API',
});
const data = (await res.json().catch(() => null)) as
  | { ok?: boolean; description?: string; result?: { message_id?: number } }
  | null;
if (!res.ok || !data?.ok) {
  fail(2, `Telegram sendDocument: ${data?.description ?? `HTTP ${res.status}`}`);
}

writeFileSync(deliveredMarker, `${sha}\n`, 'utf8');
console.log(
  `APK отправлен: message_id=${data.result?.message_id ?? '?'}, ` +
    `${sizeMb} МБ, ${path.basename(apkPath)}, sha256=${sha}`,
);
