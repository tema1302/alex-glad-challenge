// Восстановление после ChunkLoadError: после редеплоя браузер может держать HTML,
// который ссылается на уже отсутствующий чанк. `reset()` error boundary ре-рендерит
// сегмент, но не перезапрашивает документ — нужен один жёсткий reload, чтобы получить
// свежий HTML с актуальными хешами чанков. Замок в sessionStorage не даёт уйти в
// reload-цикл, если чанк реально отсутствует на сервере.

const CHUNK_ERROR_RE =
  /loading chunk|chunkloaderror|loading css chunk|failed to fetch dynamically imported module/i;
const LOCK_KEY = 'web:chunk-reload-at';
const LOCK_TTL_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ChunkLoadError' || CHUNK_ERROR_RE.test(error.message))
  );
}

// Возвращает true ровно один раз в окне TTL — вызывающий обязан сделать
// window.location.reload(). null/undefined storage (privacy mode, SSR) =
// восстановление недоступно, чтобы не рисковать бесконечным циклом.
export function claimChunkReload(
  error: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
): boolean {
  if (!isChunkLoadError(error) || !storage) return false;

  const now = Date.now();
  let last = 0;
  try {
    const raw = storage.getItem(LOCK_KEY);
    last = raw === null ? 0 : Number(raw);
  } catch {
    return false;
  }
  if (Number.isFinite(last) && now - last < LOCK_TTL_MS) return false;

  try {
    storage.setItem(LOCK_KEY, String(now));
  } catch {
    return false;
  }
  return true;
}
