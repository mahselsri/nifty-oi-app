import { NextResponse } from 'next/server';
import { authorized } from '../../../lib/auth.js';
import { getRedis } from '../../../lib/store.js';
import { istNow } from '../../../lib/time.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// /api/export?date=2026-11-19  -> all stored snapshots for that day (for backtesting/replay)
export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const date = new URL(req.url).searchParams.get('date') || istNow().date;
  const redis = getRedis();
  const keys = await redis.keys(`snaps:${date}:*`);
  const out = {};
  for (const k of keys) out[k] = await redis.lrange(k, 0, -1);
  return NextResponse.json(out);
}
