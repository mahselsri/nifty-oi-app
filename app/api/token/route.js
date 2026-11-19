import { NextResponse } from 'next/server';
import { authorized } from '../../../lib/auth.js';
import { tokenIsValid } from '../../../lib/kite.js';
import { getRedis } from '../../../lib/store.js';
import { secondsUntilNext6amIST } from '../../../lib/time.js';

export const dynamic = 'force-dynamic';

// POST { token } : paste today's Kite access_token. Only KITE_API_KEY is needed; no secret.
export async function POST(req) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }
  const raw = String(body?.token || '').trim().replace(/^["']|["']$/g, '');
  if (!/^[A-Za-z0-9]{16,64}$/.test(raw)) {
    return NextResponse.json({ ok: false, error: 'That does not look like a Kite token.' }, { status: 400 });
  }

  if (!(await tokenIsValid(raw))) {
    return NextResponse.json(
      { ok: false, error: 'Kite rejected this token (expired, or it belongs to a different API key).' },
      { status: 400 },
    );
  }
  const access = raw;

  await getRedis().set('kite:token', access, { ex: secondsUntilNext6amIST() });
  return NextResponse.json({ ok: true });
}
