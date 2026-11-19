import { fetchNiftyOptions, quote } from './kite.js';

const WINDOW = 30; // strikes captured each side of ATM
const STEP = 50;

export async function getUniverse(redis, token, dateStr) {
  const k = `uni:${dateStr}`;
  const cached = await redis.get(k);
  if (cached) return cached;
  const all = await fetchNiftyOptions(token);
  const exps = [...new Set(all.map((x) => x.e))].filter((e) => e >= dateStr).sort().slice(0, 2);
  const uni = all.filter((x) => exps.includes(x.e));
  await redis.set(k, uni, { ex: 3 * 86400 });
  return uni;
}

export function pickExpiry(uni, now, override) {
  const exps = [...new Set(uni.map((x) => x.e))].sort();
  if (override && exps.includes(override)) return override;
  let e = exps[0];
  // After the close on expiry day, the next expiry is the live one.
  if (e === now.date && now.minutes >= 15 * 60 + 30 && exps[1]) e = exps[1];
  return e;
}

export async function takeSnapshot(token, uni, expiry) {
  const idx = await quote(token, ['NSE:NIFTY 50']);
  const spot = idx['NSE:NIFTY 50'].last_price;
  const atm = Math.round(spot / STEP) * STEP;
  const lo = atm - WINDOW * STEP;
  const hi = atm + WINDOW * STEP;
  const sel = uni.filter((x) => x.e === expiry && x.k >= lo && x.k <= hi);
  const q = await quote(token, sel.map((x) => 'NFO:' + x.s)); // limit 500 per call; we use ~122
  const d = {};
  for (const x of sel) {
    const r = q['NFO:' + x.s];
    if (!r) continue;
    const row = (d[x.k] ||= [0, 0, 0, 0]);
    if (x.t === 'CE') {
      row[0] = r.last_price;
      row[1] = r.oi;
    } else {
      row[2] = r.last_price;
      row[3] = r.oi;
    }
  }
  return { t: new Date().toISOString(), s: spot, e: expiry, d };
}
