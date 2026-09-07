// TgMessage — имитация сообщения Telegram (тёмная тема, ТЗ §7.1 п.3): пузырь
// на «чатовом» фоне, стили descendants — .tg-msg в globals.css. HTML проходит
// общий whitelist sanitizeTgHtml (web/lib/shared/tg-html.ts) — тот же парсер,
// что на сервере перед отправкой.
import { sanitizeTgHtml } from '../../../lib/shared/tg-html';

export function TgMessage({ html }: { html: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-[#182533] px-3.5 py-2.5">
      <div className="tg-msg" dangerouslySetInnerHTML={{ __html: sanitizeTgHtml(html) }} />
    </div>
  );
}
