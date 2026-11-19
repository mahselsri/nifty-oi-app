import { NextResponse } from 'next/server';
import { authorized } from '../../../lib/auth.js';
import { getRedis } from '../../../lib/store.js';
import { istNow, isMarketOpen } from '../../../lib/time.js';
import { getUniverse, pickExpiry, takeSnapshot } from '../../../lib/snapshot.js';
import { analyze } from '../../../lib/analyze.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STALE_MS = 30000; // many viewers / a cron pinger share one snapshot per 30s

export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const expiryQ = url.searchParams.get('expiry');
  const now = istNow();
  const open = isMarketOpen(now);

  try {
    const redis = getRedis();
    const token = await redis.get('kite:token');
    let key = null;
    let transient = null;
    let expiryDay = false;

    if (token && (open || force)) {
      const uni = await getUniverse(redis, token, now.date);
      const expiry = pickExpiry(uni, now, expiryQ);
      expiryDay = expiry === now.date;
      key = `snaps:${now.date}:${expiry}`;
      const last = (await redis.lrange(key, -1, -1))[0];
      const stale = !last || Date.now() - Date.parse(last.t) > STALE_MS;
      if (stale) {
        const gotLock = await redis.set('lock:snap', '1', { nx: true, ex: 15 });
        if (gotLock) {
          const snap = await takeSnapshot(token, uni, expiry);
          if (open) {
            await redis.rpush(key, snap);
            await redis.expire(key, 60 * 86400);
            await redis.set('last:key', key);
          } else {
            transient = snap; // after-hours test fetch: show it, don't pollute history
          }
        }
      }
    } else {
      key = await redis.get('last:key');
    }

    if (!token && !key) {
      return NextResponse.json({ needsLogin: true, market: { open, time: now.label } });
    }

    let hist = key ? await redis.lrange(key, -60, -1) : [];
    const first = key ? await redis.lindex(key, 0) : null;
    if (transient) hist = [transient];

    const day = key ? key.split(':')[1] : now.date;
    const uni = (await redis.get(`uni:${day}`)) || [];
    const symMap = new Map(uni.map((x) => [`${x.k}|${x.t}|${x.e}`, x]));
    const exp = hist.length ? hist[hist.length - 1].e : null;
    const ctx = {
      nowMin: open ? now.minutes : null,
      expiryDay: exp === now.date,
      sym: (strike, type) => {
        const x = symMap.get(`${strike}|${type}|${exp}`);
        return x ? { symbol: x.s, lot: x.l } : null;
      },
    };
    if (open && ctx.nowMin == null) ctx.nowMin = now.minutes;

    const a = analyze(hist, first, ctx);

    // Log approach/entry events so you can review what the app said and when.
    if (open && a.side && a.state) {
      const sig = `${a.state}|${a.side}|${a.trade?.symbol || ''}`;
      if ((await redis.get('sig:last')) !== sig) {
        await redis.set('sig:last', sig);
        const lk = `signals:${now.date}`;
        await redis.rpush(lk, {
          t: new Date().toISOString(),
          state: a.state,
          side: a.side,
          reason: a.reason,
          symbol: a.trade?.symbol || null,
          ltp: a.trade?.ltp || null,
          spot: a.spot,
        });
        await redis.ltrim(lk, -200, -1);
        await redis.expire(lk, 60 * 86400);
      }
    }

    const signals = await redis.lrange(`signals:${now.date}`, -15, -1);
    return NextResponse.json({
      market: { open, time: now.label, date: now.date, forced: !open && force },
      needsLogin: !token,
      analysis: a,
      signals: signals.reverse(),
    });
  } catch (e) {
    const tokenErr = e.type === 'TokenException' || /token|api_key/i.test(e.message || '');
    return NextResponse.json(
      { error: e.message || 'Snapshot failed', needsLogin: tokenErr, market: { open, time: now.label } },
      { status: tokenErr ? 200 : 502 },
    );
  }
}
