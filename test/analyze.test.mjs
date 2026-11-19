import assert from 'node:assert/strict';
import { analyze, CFG } from '../lib/analyze.js';

const base = Date.parse('2026-11-19T05:30:00Z'); // 11:00 IST
const FLOOR = 25300;
const CEIL = 25500;

// Build one snapshot. wall OI / premiums are parameters; every other strike has 100L OI.
function mk(minute, spot, { ceOi = 300e5, peOi = 280e5, pePx = 30, cePx = 40 } = {}) {
  const d = {};
  for (let s = 24900; s <= 25900; s += 50) d[s] = [10, 100e5, 10, 100e5];
  d[CEIL] = [cePx, ceOi, 200, 100e5];
  d[FLOOR] = [200, 100e5, pePx, peOi];
  return { t: new Date(base + minute * 60000).toISOString(), s: spot, e: '2026-11-24', d };
}
const ctx = {
  nowMin: 11 * 60,
  sym: (k, t) => ({ symbol: `NIFTY${k}${t}`, lot: 65 }),
};
const run = (hist) => analyze(hist, hist[0], ctx);

// 1. Floor touched, put OI rising, premium falling -> ENTRY (buy the ceiling CE)
{
  const h = [];
  for (let i = 0; i <= 8; i++) h.push(mk(i, 25330 - i * 3, { peOi: 280e5 + i * 1.5e5, pePx: 30 - i * 0.6 }));
  const a = run(h);
  assert.equal(a.state, 'ENTRY', a.reason);
  assert.equal(a.side, 'LONG');
  assert.equal(a.trade.strike, CEIL);
  assert.equal(a.trade.type, 'CE');
  assert.equal(a.trade.target, Math.round(a.trade.ltp * 1.1 * 20) / 20);
  assert.ok(a.trade.stop < a.trade.ltp);
  assert.equal(a.grade, 'B'); // price still falling, no bounce yet
  console.log('ok 1 entry long (grade B, no bounce yet):', a.reason);
}

// 2. Same, but Nifty has bounced 12 points off the low -> grade A
{
  const h = [];
  for (let i = 0; i <= 8; i++) h.push(mk(i, i < 5 ? 25310 - i * 2 : 25302 + (i - 4) * 4, { peOi: 280e5 + i * 1.5e5, pePx: 30 - i * 0.6 }));
  const a = run(h);
  assert.equal(a.state, 'ENTRY', a.reason);
  assert.equal(a.grade, 'A');
  console.log('ok 2 grade A after bounce');
}

// 3. Put OI falling + premium rising -> COVERING -> SKIP
{
  const h = [];
  for (let i = 0; i <= 8; i++) h.push(mk(i, 25330 - i * 3, { peOi: 280e5 - i * 2e5, pePx: 30 + i }));
  const a = run(h);
  assert.equal(a.state, 'SKIP');
  assert.match(a.reason, /COVERING/);
  console.log('ok 3 covering ->', a.state);
}

// 4. Spot parked below the floor for 12 min -> broken -> SKIP
{
  const h = [];
  for (let i = 0; i <= 12; i++) h.push(mk(i, 25270));
  const a = run(h);
  assert.equal(a.state, 'SKIP');
  assert.match(a.reason, /broken/);
  assert.equal(a.floor.strike, FLOOR); // wall must not jump away
  console.log('ok 4 broken floor ->', a.state);
}

// 5. Mid range -> IDLE
{
  const h = [];
  for (let i = 0; i <= 8; i++) h.push(mk(i, 25400));
  const a = run(h);
  assert.equal(a.state, 'IDLE');
  console.log('ok 5 mid-range -> IDLE');
}

// 6. Ceiling touched, call OI rising, premium falling -> ENTRY SHORT (buy the floor PE)
{
  const h = [];
  for (let i = 0; i <= 8; i++) h.push(mk(i, 25480 + i, { ceOi: 300e5 + i * 2e5, cePx: 40 - i }));
  const a = run(h);
  assert.equal(a.state, 'ENTRY', a.reason);
  assert.equal(a.side, 'SHORT');
  assert.equal(a.trade.strike, FLOOR);
  assert.equal(a.trade.type, 'PE');
  console.log('ok 6 entry short:', a.trade.symbol);
}

// 7. Weak wall (second strike nearly as big) -> SKIP
{
  const h = [];
  for (let i = 0; i <= 8; i++) {
    const s = mk(i, 25330 - i * 3, { peOi: 280e5 + i * 1.5e5, pePx: 30 - i * 0.6 });
    s.d[25250][3] = 270e5; // neighbouring put strike almost equal
    h.push(s);
  }
  const a = run(h);
  assert.equal(a.state, 'SKIP');
  assert.match(a.reason, /not dominant/);
  console.log('ok 7 weak wall ->', a.state);
}

// 8. Too little history -> COLLECTING
{
  const h = [mk(0, 25320), mk(1, 25315), mk(2, 25312)];
  const a = run(h);
  assert.equal(a.state, 'COLLECTING');
  console.log('ok 8 collecting ->', a.state);
}

// 9. Opening window -> SKIP
{
  const h = [];
  for (let i = 0; i <= 8; i++) h.push(mk(i, 25330 - i * 3, { peOi: 280e5 + i * 1.5e5, pePx: 30 - i * 0.6 }));
  const a = analyze(h, h[0], { ...ctx, nowMin: 9 * 60 + 20 });
  assert.equal(a.state, 'SKIP');
  console.log('ok 9 opening window ->', a.state);
}

// 10. Adverse wall migration for a SHORT (ceiling moved up) -> SKIP
{
  const h = [];
  for (let i = 0; i <= 20; i++) {
    const moved = i >= 12;
    const s = mk(i, 25480 + (i % 3), { ceOi: 300e5 + i * 2e5, cePx: 40 - i * 0.5 });
    if (!moved) {
      // early on, the biggest call strike is 25400, then it migrates to 25500
      s.d[25400][1] = 320e5;
      s.d[25500][1] = 150e5;
    }
    h.push(s);
  }
  const a = analyze(h, h[0], ctx);
  assert.equal(a.state, 'SKIP', a.reason);
  assert.match(a.reason, /moved|migrat/i);
  console.log('ok 10 migration ->', a.state, a.reason);
}

console.log('\nall tests passed');
