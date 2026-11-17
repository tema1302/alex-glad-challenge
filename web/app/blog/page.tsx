// /blog — хаб «моё пространство» (S1): тонкая server-страница; весь рендер —
// презентационный BlogHubView на props (пульс + внимание). Гейт — middleware
// (путь не в PUBLIC_PATHS → гость уходит в /login). force-dynamic: live-БД.
import type { Metadata } from 'next';

import { readBlogPulse, readHubAttention } from '../../lib/server/blogs';
import { BlogHubView } from './BlogHubView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Моё пространство' };

export default async function BlogHubPage() {
  const [pulse, attention] = await Promise.all([readBlogPulse(), readHubAttention()]);
  return <BlogHubView pulse={pulse} attention={attention} />;
}
