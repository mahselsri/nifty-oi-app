// Pure analysis engine. No network, no storage: easy to test and to replay later.
//
// Snapshot format (compact):
//   { t: ISO time, s: spot, e: expiry, d: { "25400": [ceLtp, ceOi, peLtp, peOi], ... } }

export const CFG = {
  step: 50,
  lookbackMin: 5, // compare OI / premium against ~5 minutes ago
  oiMovePct: 0.5, // OI change below this % counts as flat
  touchBuffer: 20, // points: Nifty within this of a wall = "at the wall"
  chaseMax: 35, // after a recent touch, still valid while within this many points
  recentMin: 10, // window used for "recently touched" and bounce
  minWallRatio: 1.3, // top OI / second OI on the same side
  skipFirstMin: 15, // no entries in the first 15 minutes
  noEntryAfter: 15 * 60, // no new entries after 15:00 IST
  breakMin: 10, // spot beyond wall this long => wall broken
  breakBuffer: 15, // points beyond the wall that count as broken
  bouncePts: 10, // points off the low/high that confirm rejection (grade A)
  migrateMin: 15, // wall migration look-back
  tradeStrikeMode: 'wall', // 'wall' = opposite wall strike (your rule) | 'atm'
  targetPct: 10,
  stopPct: 12,
  minPremium: 5, // below this, a 10% target is under 50 paise: flag it
};

const COLS = { CE: [0, 1], PE: [2, 3] };
const tOf = (s) => Date.parse(s.t);
const pct = (n, o) => (o ? ((n - o) / o) * 100 : 0);
const r05 = (x) => Math.round(x * 20) / 20; // Nifty options tick = 0.05
const lakh = (x) => x / 1e5;

export function leg(snap, strike, type) {
  const r = snap.d[strike];
  if (!r) return null;
  const [p, o] = COLS[type];
  return { ltp: r[p], oi: r[o] };
}

// CE wall: max call OI at/above spot (minus tol). PE wall: max put OI at/below spot (plus tol).
// tol keeps the wall in place when spot slips a little past it, so a break reads as a break.
export function findWall(snap, type, tol = 100) {
  const items = [];
  for (const k of Object.keys(snap.d)) {
    const s = Number(k);
    const ok = type === 'CE' ? s >= snap.s - tol : s <= snap.s + tol;
    if (ok) items.push([s, snap.d[k][COLS[type][1]]]);
  }
  items.sort((a, b) => b[1] - a[1]);
  if (!items.length || !items[0][1]) return null;
  const second = items[1] ? items[1][1] : 0;
  return { strike: items[0][0], oi: items[0][1], second, ratio: second ? items[0][1] / second : 99 };
}

export function classify(oiChg, pxChg, thr) {
  const oiUp = oiChg > thr;
  const oiDn = oiChg < -thr;
  const pxUp = pxChg > 0;
  if (oiUp && !pxUp) return 'DEFENDED'; // writers adding, wall holding
  if (oiUp && pxUp) return 'BUYING'; // buyers piling in, pressure through the wall
  if (oiDn && pxUp) return 'COVERING'; // writers exiting, wall breaking
  if (oiDn && !pxUp) return 'UNWINDING'; // no conviction
  return 'FLAT';
}

function statusOf(cur, ref, strike, type, cfg) {
  if (!ref) return { status: 'N/A', oiChg: 0, pxChg: 0 };
  const now = leg(cur, strike, type);
  const then = leg(ref, strike, type);
  if (!now || !then) return { status: 'N/A', oiChg: 0, pxChg: 0 };
  const oiChg = pct(now.oi, then.oi);
  const pxChg = pct(now.ltp, then.ltp);
  return { status: classify(oiChg, pxChg, cfg.oiMovePct), oiChg, pxChg };
}

function sustainedBeyond(hist, level, dir, cfg) {
  const tNow = tOf(hist[hist.length - 1]);
  const w = hist.filter((h) => tOf(h) >= tNow - cfg.breakMin * 60000);
  if (w.length < 3) return false;
  if (tOf(w[w.length - 1]) - tOf(w[0]) < cfg.breakMin * 60000 * 0.8) return false;
  return dir === 'up'
    ? w.every((h) => h.s > level + cfg.breakBuffer)
    : w.every((h) => h.s < level - cfg.breakBuffer);
}

function buildTrade(cur, strike, type, ctx, cfg) {
  const l = leg(cur, strike, type);
  if (!l || !l.ltp) return null;
  const info = ctx.sym ? ctx.sym(strike, type) : null;
  const ltp = l.ltp;
  return {
    symbol: info?.symbol || `NIFTY ${strike} ${type}`,
    strike,
    type,
    ltp,
    limit: r05(ltp), // place a limit order at/near this
    chaseMax: r05(ltp * 1.02), // don't pay more than +2% above signal price
    target: r05(ltp * (1 + cfg.targetPct / 100)),
    stop: r05(ltp * (1 - cfg.stopPct / 100)),
    lot: info?.lot || null,
    costPerLot: info?.lot ? Math.round(ltp * info.lot) : null,
    lowPremium: ltp < cfg.minPremium,
  };
}

function evalSide(side, cur, hist, ref, old, walls, ctx, cfg) {
  const isLong = side === 'LONG'; // LONG = Nifty at floor -> buy CE
  const w = isLong ? walls.pe : walls.ce;
  const wType = isLong ? 'PE' : 'CE';
  const spot = cur.s;
  const tNow = tOf(cur);
  const st = statusOf(cur, ref, w.strike, wType, cfg);

  const recent = hist.filter((h) => tOf(h) >= tNow - cfg.recentMin * 60000);
  const ext = isLong ? Math.min(...recent.map((h) => h.s)) : Math.max(...recent.map((h) => h.s));
  const dist = isLong ? spot - w.strike : w.strike - spot; // points to the wall (negative = beyond it)
  const touched = isLong ? ext <= w.strike + cfg.touchBuffer : ext >= w.strike - cfg.touchBuffer;
  const inZone = dist <= cfg.touchBuffer || (touched && dist <= cfg.chaseMax);
  const bounce = isLong ? spot - ext : ext - spot;

  const startMin = 9 * 60 + 15 + cfg.skipFirstMin;
  const timeOk = ctx.nowMin == null ? true : ctx.nowMin >= startMin && ctx.nowMin <= cfg.noEntryAfter;
  const broken = sustainedBeyond(hist, w.strike, isLong ? 'down' : 'up', cfg);

  let migrated = false;
  let migDetail = 'No wall shift in the last ' + cfg.migrateMin + ' min';
  if (old) {
    const ow = findWall(old, wType);
    if (ow && ((isLong && w.strike < ow.strike) || (!isLong && w.strike > ow.strike))) {
      migrated = true;
      migDetail = `Wall moved ${ow.strike} -> ${w.strike} (${isLong ? 'down' : 'up'}): don't fade it`;
    }
  } else {
    migDetail = 'Not enough history yet';
  }

  const label = isLong ? 'floor' : 'ceiling';
  const checks = [
    {
      label: 'Nifty at the wall',
      ok: inZone,
      detail: `Nifty ${spot.toFixed(1)} is ${Math.abs(dist).toFixed(0)} pts ${dist >= 0 ? (isLong ? 'above' : 'below') : 'beyond'} ${label} ${w.strike}`,
    },
    {
      label: 'Time window',
      ok: timeOk,
      detail: timeOk ? 'Inside entry window (09:30-15:00)' : 'Outside entry window (09:30-15:00)',
    },
    {
      label: 'Wall not broken',
      ok: !broken,
      detail: broken ? `Spot held beyond ${w.strike} for ${cfg.breakMin}+ min` : 'Spot has not held beyond the wall',
    },
    {
      label: `Dominant wall (>= ${cfg.minWallRatio}x)`,
      ok: w.ratio >= cfg.minWallRatio,
      detail: `${lakh(w.oi).toFixed(0)}L vs next ${lakh(w.second).toFixed(0)}L = ${w.ratio.toFixed(2)}x`,
    },
    { label: 'No adverse wall migration', ok: !migrated, detail: migDetail },
    {
      label: `${wType} OI up, premium down (${cfg.lookbackMin}m)`,
      ok: st.status === 'N/A' ? null : st.status === 'DEFENDED',
      detail:
        st.status === 'N/A'
          ? `Need ${cfg.lookbackMin} min of snapshots`
          : `${st.status}: OI ${st.oiChg >= 0 ? '+' : ''}${st.oiChg.toFixed(1)}%, premium ${st.pxChg >= 0 ? '+' : ''}${st.pxChg.toFixed(1)}%`,
    },
    {
      label: `Bounce >= ${cfg.bouncePts} pts off the ${isLong ? 'low' : 'high'} (bonus)`,
      ok: bounce >= cfg.bouncePts,
      bonus: true,
      detail: `${Math.max(0, bounce).toFixed(0)} pts off the ${cfg.recentMin}-min ${isLong ? 'low' : 'high'}`,
    },
  ];

  let state, reason;
  if (!inZone) {
    state = 'IDLE';
    reason = `Nifty is ${Math.abs(dist).toFixed(0)} pts from the ${label} ${w.strike}. Zone starts within ${cfg.touchBuffer} pts.`;
  } else if (!timeOk) {
    state = 'SKIP';
    reason = checks[1].detail;
  } else if (broken) {
    state = 'SKIP';
    reason = `${label} ${w.strike} is broken: Nifty held beyond it. Do not counter-trade.`;
  } else if (w.ratio < cfg.minWallRatio) {
    state = 'SKIP';
    reason = `${label} ${w.strike} is not dominant (${w.ratio.toFixed(2)}x). Resistance/support is spread over strikes.`;
  } else if (migrated) {
    state = 'SKIP';
    reason = migDetail;
  } else if (st.status === 'N/A') {
    state = 'COLLECTING';
    reason = `Collecting history. Need ${cfg.lookbackMin} minutes of snapshots to read OI direction.`;
  } else if (st.status === 'DEFENDED') {
    state = 'ENTRY';
    reason = `${wType} wall ${w.strike} is being defended: OI rising while premium falls.`;
  } else if (st.status === 'BUYING' || st.status === 'COVERING') {
    state = 'SKIP';
    reason = `${wType} ${w.strike} shows ${st.status}: ${st.status === 'COVERING' ? 'writers are exiting, wall may break' : 'buyers are pushing through the wall'}.`;
  } else {
    state = 'WAIT';
    reason = `${wType} ${w.strike} is ${st.status}. Wait for OI to rise with falling premium.`;
  }

  return { side, wall: w, wType, st, checks, state, reason, bounceOk: bounce >= cfg.bouncePts };
}

export function analyze(hist, first, ctx = {}, cfg = CFG) {
  const cur = hist[hist.length - 1];
  if (!cur) return { state: 'NO_DATA', reason: 'No snapshots yet. Open the page during market hours or force a fetch.' };

  const tNow = tOf(cur);
  const rev = [...hist].reverse();
  const ref = rev.find((h) => tOf(h) <= tNow - cfg.lookbackMin * 60000) || null;
  const old = rev.find((h) => tOf(h) <= tNow - cfg.migrateMin * 60000) || null;
  const spanMin = (tNow - tOf(hist[0])) / 60000;

  const ce = findWall(cur, 'CE');
  const pe = findWall(cur, 'PE');
  const base = { t: cur.t, spot: cur.s, expiry: cur.e, spanMin, snapshots: hist.length, cfg };
  if (!ce || !pe) return { ...base, state: 'NO_DATA', reason: 'Could not find walls in the captured strikes.' };

  const wallInfo = (w, type) => {
    const st = statusOf(cur, ref, w.strike, type, cfg);
    const f = first ? leg(first, w.strike, type) : null;
    const l = leg(cur, w.strike, type);
    return { ...w, ...st, ltp: l?.ltp, dayAdd: f ? w.oi - f.oi : 0 };
  };
  const walls = { ce, pe };
  const ceiling = wallInfo(ce, 'CE');
  const floor = wallInfo(pe, 'PE');

  const atm = Math.round(cur.s / cfg.step) * cfg.step;
  const nearSide = Math.abs(cur.s - pe.strike) <= Math.abs(ce.strike - cur.s) ? 'LONG' : 'SHORT';
  const ev = evalSide(nearSide, cur, hist, ref, old, walls, ctx, cfg);

  const tradeFor = (side) => {
    const buyType = side === 'LONG' ? 'CE' : 'PE';
    const oppWall = side === 'LONG' ? ce.strike : pe.strike;
    const strike = cfg.tradeStrikeMode === 'atm' ? atm : oppWall;
    return {
      main: buildTrade(cur, strike, buyType, ctx, cfg),
      atm: buildTrade(cur, atm, buyType, ctx, cfg),
    };
  };

  const setups = ['LONG', 'SHORT'].map((side) => {
    const t = tradeFor(side);
    return {
      side,
      action: side === 'LONG' ? 'Buy CE when Nifty drops to the floor' : 'Buy PE when Nifty rises to the ceiling',
      wallStrike: side === 'LONG' ? pe.strike : ce.strike,
      triggerSpot: side === 'LONG' ? pe.strike + cfg.touchBuffer : ce.strike - cfg.touchBuffer,
      buy: t.main,
      alt: t.atm,
      nearest: side === nearSide,
    };
  });

  const trade = ev.state === 'ENTRY' || ev.state === 'WAIT' || ev.state === 'SKIP' ? tradeFor(nearSide) : null;

  // OI table around ATM, change measured against the lookback snapshot
  const rows = [];
  for (let k = atm - 6 * cfg.step; k <= atm + 6 * cfg.step; k += cfg.step) {
    const c = leg(cur, k, 'CE');
    const p = leg(cur, k, 'PE');
    if (!c || !p) continue;
    const rc = ref ? leg(ref, k, 'CE') : null;
    const rp = ref ? leg(ref, k, 'PE') : null;
    rows.push({
      strike: k,
      ceOi: c.oi,
      peOi: p.oi,
      ceLtp: c.ltp,
      peLtp: p.ltp,
      ceChg: rc ? pct(c.oi, rc.oi) : null,
      peChg: rp ? pct(p.oi, rp.oi) : null,
    });
  }
  let sumCe = 0;
  let sumPe = 0;
  for (const k of Object.keys(cur.d)) {
    sumCe += cur.d[k][1];
    sumPe += cur.d[k][3];
  }

  return {
    ...base,
    atm,
    ceiling,
    floor,
    state: ev.state,
    side: ev.side,
    reason: ev.reason,
    grade: ev.state === 'ENTRY' ? (ev.bounceOk ? 'A' : 'B') : null,
    gradeNote:
      ev.state === 'ENTRY'
        ? ev.bounceOk
          ? 'OI confirms and Nifty has bounced off the wall.'
          : `Early entry: no ${cfg.bouncePts}-pt bounce yet. Safer to wait for it, or take half size.`
        : null,
    checks: ev.checks,
    trade: trade ? { ...trade.main, atm: trade.atm } : null,
    setups,
    rows,
    pcr: sumCe ? sumPe / sumCe : null,
    expiryDay: ctx.expiryDay || false,
  };
}
