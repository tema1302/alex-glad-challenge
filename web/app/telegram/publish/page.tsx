// /telegram/publish — компоузер TG-постинга (ТЗ §7.1). Server-обёртка: tg-статус
// из getKeysStatus (channelLabel — маска chat_id, не секрет) → клиентский TgComposer.
// Сама страница — тонкая: состояния form/confirming/sending/done|error живут в клиенте.
import type { Metadata } from 'next';
import { getKeysStatus } from '../../../lib/server/env';
import { SectionHead } from '../../components/ui/SectionHead';
import { TgComposer } from './TgComposer';

export const metadata: Metadata = { title: 'TG-постинг' };

export default function TelegramPublishPage() {
  const bot = getKeysStatus().botApi;
  return (
    <div className="space-y-6">
      <SectionHead
        code="tg · post"
        title="TG-постинг"
        description="Публикация в канал через Bot API: разметка, превью, подтверждение, история. Реальный внешний эффект — только после confirm."
      />
      <TgComposer tgConfigured={bot.configured} channelLabel={bot.channelLabel} />
    </div>
  );
}
