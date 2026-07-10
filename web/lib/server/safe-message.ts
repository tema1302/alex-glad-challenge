// Страховка от утечки секрета/URL/пути через network-error в error-event'ах SSE
// и в Response.json({error}). Вырезает Bearer-токены, URL, Windows-пути.
// server-only: используется только в Route Handlers / server-модулях (P2b, DRY).
import 'server-only';

export function safeMessage(m: string): string {
  return m
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b[A-Za-z]:\\[^\s"']*/g, '<path>');
}
