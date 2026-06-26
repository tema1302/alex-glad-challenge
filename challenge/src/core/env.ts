// Загрузка .env из корня репозитория (вверх от cwd).
// Импортируется из точки входа cli.ts, чтобы переменные были доступны
// всем модулям, включая telegram.ts, даже если LlmClient не используется.

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadEnvUpward(): void {
  if (loaded) return;
  loaded = true;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, '.env'))) {
      dotenvConfig({ path: path.join(dir, '.env') });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig();
}
