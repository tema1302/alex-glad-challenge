// server-only хелпер cookie-сессии для Server Components (layout/страницы).
// Живёт отдельно, чтобы next/headers не утаскивался в lib/auth.ts (его импортирует
// middleware — без server-only). Next 15: cookies() async, канон как await headers().
import 'server-only';
import { cookies } from 'next/headers';
import { isValidSession, SESSION_COOKIE } from '../auth';

export async function isAdminAuthed(): Promise<boolean> {
  const store = await cookies();
  return isValidSession(store.get(SESSION_COOKIE)?.value);
}
