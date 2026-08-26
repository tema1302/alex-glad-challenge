// /jira — публичный генератор Jira-задач (meetup-web). Server Component: каркас —
// паттерн /harness (hero + SectionShell, контейнер max-w-6xl владеет страница,
// гостевая ветка layout — main без контейнера). Единственный client-компонент —
// JiraForm. Флаги провайдеров — с сервера через getKeysStatus(): наружу только
// Boolean/имена провайдера-модели, значения ключей никогда не покидают lib/server.
import type { Metadata } from 'next';
import { SectionShell } from '../components/landing/SectionShell';
import { SectionLabel } from '../components/ui/SectionLabel';
import { getKeysStatus } from '../../lib/server/env';
import { jiraExample, jiraLead, jiraMeta } from '../../data/jira';
import { JiraForm, type JiraProviderFlags } from './JiraForm';

// page-local metadata (openGraph НЕ добавляем: без metadataBase — build-warning).
export const metadata: Metadata = {
  title: jiraMeta.title,
  description: jiraMeta.description,
};

export default function JiraPage() {
  const keys = getKeysStatus();
  const providers: JiraProviderFlags = {
    cloudConfigured: keys.cloud.configured,
    cloudProvider: keys.cloud.provider ?? null,
    localConfigured: keys.local.configured,
    localModel: keys.local.model ?? null,
  };

  return (
    <>
      {/* Hero: тезис + формула — тот же канон гостевых страниц, что у /harness */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-5 pb-12 pt-10 md:pb-16 md:pt-20">
          <SectionLabel>{jiraLead.label}</SectionLabel>
          <h1 className="font-mono text-3xl font-semibold uppercase leading-[0.95] tracking-tight text-ink md:text-5xl">
            {jiraLead.headline}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-dim md:text-base">
            {jiraLead.subhead}
          </p>
        </div>
      </section>

      <SectionShell n="01" label="генерация">
        <JiraForm providers={providers} example={jiraExample} />
      </SectionShell>
    </>
  );
}
