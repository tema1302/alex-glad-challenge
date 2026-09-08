// /blog/digest — «дайджест одним кликом» (next-feature-2, П-2). Server-обёртка по
// образцу /telegram/publish: tg-статус из getKeysStatus (channelLabel — маска chat_id)
// → SectionHead + клиентский DigestComposer. Админ-only: middleware сам гейтит путь
// (нет в PUBLIC_PATHS → гость получает 302 /login?next=…), страница лишнего auth не дублирует.
import type { Metadata } from 'next';
import { getKeysStatus } from '../../../lib/server/env';
import { SectionHead } from '../../components/ui/SectionHead';
import { DigestComposer } from './DigestComposer';

export const metadata: Metadata = { title: 'Дайджест' };

export default function BlogDigestPage() {
  const bot = getKeysStatus().botApi;
  return (
    <div className="space-y-6">
      <SectionHead
        code="blog · digest"
        title="Дайджест одним кликом"
        description="LLM собирает подборку по новостям недели — проверь, отредактируй и отправь в канал"
      />
      <DigestComposer tgConfigured={bot.configured} channelLabel={bot.channelLabel} />
    </div>
  );
}
