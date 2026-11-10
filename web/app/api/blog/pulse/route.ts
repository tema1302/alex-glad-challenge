// GET /api/blog/pulse — единый агрегат «пульса контента» для сайта и Android.
// Только активные блоги, детерминированный порядок, без секретов.
// requireApiAuth: cookie-сессия или mobile Bearer.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { readBlogPulse } from '../../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const pulse = await readBlogPulse();
  return NextResponse.json(pulse, { headers: { 'Cache-Control': 'no-store' } });
}
