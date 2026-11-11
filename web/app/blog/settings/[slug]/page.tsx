// /blog/settings/[slug] — серверная обёртка: slug из params → клиентская карточка.
import type { Metadata } from 'next';
import { BlogDetail } from './BlogDetail';

export const metadata: Metadata = { title: 'Блог' };
export const dynamic = 'force-dynamic';

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BlogDetail slug={slug} />;
}
