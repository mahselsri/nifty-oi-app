'use client';
import { useCallback, useEffect, useState } from 'react';

const L = (x) => (x / 1e5).toFixed(1);
const sgn = (x) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`);
const cls = (x) => (x == null ? '' : x >= 0 ? 'pos' : 'neg');
const tm = (iso) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });

function getKey() {
  try {
    const q = new URLSearchParams(window.location.search).get('key');
    if (q) {
      localStorage.setItem('oikey', q);
      return q;
    }
    return localStorage.getItem('oikey') || '';
  } catch {
    return new URLSearchParams(window.location.search).get('key') || '';
  }
}

function Trade({ t, label }) {
  if (!t) return null;
  return (
    <div>
      <div className="small">{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>
        {t.symbol} <span className="small">(strike {t.strike} {t.type})</span>
      </div>
      <div className="grid4">
        <div className="kv"><div className="k">Entry (limit)</div><div className="v">₹{t.limit.toFixed(2)}</div></div>
        <div className="kv"><div className="k">Max chase</div><div className="v">₹{t.chaseMax.toFixed(2)}</div></div>
        <div className="kv"><div className="k">Target</div><div className="v pos">₹{t.target.toFixed(2)}</div></div>
        <div className="kv"><div className="k">Stop-loss</div><div className="v neg">₹{t.stop.toFixed(2)}</div></div>
      </div>
      {t.costPerLot != null && <div className="small" style={{ marginTop: 6 }}>1 lot ({t.lot}) ≈ ₹{t.costPerLot.toLocaleString('en-IN')}</div>}
      {t.lowPremium && <div className="small neg" style={{ marginTop: 4 }}>Premium under ₹5: a 10% target is only a few paise. Consider the ATM option instead.</div>}
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTok, setShowTok] = useState(false);
  const [tok, setTok] = useState('');
  const [tokMsg, setTokMsg] = useState('');

  const saveToken = async () => {
    setTokMsg('Checking…');
    try {
      const key = getKey();
      const r = await fetch('/api/token' + (key ? '?key=' + encodeURIComponent(key) : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok }),
      });
      const j = await r.json();
      if (j.ok) {
        setTok('');
        setTokMsg('');
        setShowTok(false);
        load();
      } else setTokMsg(j.error || 'Failed');
    } catch (e) {
      setTokMsg(String(e.message || e));
    }
  };

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const key = getKey();
      const qs = new URLSearchParams();
      if (key) qs.set('key', key);
      if (force) qs.set('force', '1');
      const r = await fetch('/api/snapshot?' + qs.toString(), { cache: 'no-store' });
      const j = await r.json();
      if (r.status === 401) setErr('Unauthorized. Open the page once as /?key=YOUR_ACCESS_KEY');
      else if (j.error && !j.needsLogin) setErr(j.error);
      else setErr('');
      setData((prev) => (j.analysis || j.needsLogin ? j : prev));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  const a = data?.analysis;
  useEffect(() => {
    if (!a) return;
    document.title = a.state === 'ENTRY' && a.trade ? `ENTRY: buy ${a.trade.symbol}` : `Nifty OI Walls · ${a.state}`;
  }, [a]);

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Nifty OI Walls</h1>
          <div className="meta">
            {a?.expiry ? `Expiry ${a.expiry} · ` : ''}
            {data?.market ? (data.market.open ? 'Market open' : 'Market closed') : ''}
            {a ? ` · ${a.snapshots} snapshots · last ${tm(a.t)} IST` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => load(true)} disabled={busy}>{busy ? 'Loading…' : 'Fetch now'}</button>
          <button className="btn" onClick={() => setShowTok((v) => !v)}>Token</button>
        </div>
      </header>

      {err && <div className="err">{err}</div>}
      {(data?.needsLogin || showTok) && (
        <div className="card">
          <h2>Kite token</h2>
          <div className="small" style={{ marginBottom: 8 }}>
            {data?.needsLogin ? 'No valid token (they reset every morning ~6 AM). ' : ''}
            Paste today&apos;s Kite access token. It is stored server-side until 6 AM and never shown again.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="password"
              autoComplete="off"
              value={tok}
              onChange={(e) => setTok(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && tok && saveToken()}
              placeholder="Paste token"
              style={{ flex: '1 1 240px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', font: 'inherit' }}
            />
            <button className="btn primary" onClick={saveToken} disabled={!tok}>Save token</button>
          </div>
          {tokMsg && <div className="small neg" style={{ marginTop: 6 }}>{tokMsg}</div>}
        </div>
      )}
      {a?.expiryDay && <div className="warn">Expiry day: heavy pinning and whipsaws. Test these sessions separately before trusting signals.</div>}
      {data?.market && !data.market.open && a && (
        <div className="warn">Market is closed. Showing the last stored session{data.market.forced ? ' (test fetch, not stored)' : ''}.</div>
      )}

      {!a && !data?.needsLogin && !err && <div className="card">Loading…</div>}

      {a && a.state === 'NO_DATA' && <div className="card">{a.reason}</div>}

      {a && a.state !== 'NO_DATA' && (
        <>
          <div className="card">
            <span className={`badge ${a.state}`}>{a.state}</span>{' '}
            {a.grade && <span className={`badge ${a.grade === 'A' ? 'ENTRY' : 'WAIT'}`}>Grade {a.grade}</span>}
            <div className="big">
              {a.state === 'ENTRY' && a.trade ? `Buy ${a.trade.symbol}` : a.state === 'IDLE' ? 'No trade: Nifty between walls' : a.state === 'COLLECTING' ? 'Collecting data…' : a.state === 'WAIT' ? 'Wait for confirmation' : 'Skip this setup'}
            </div>
            <div>{a.reason}</div>
            {a.gradeNote && <div className="small" style={{ marginTop: 4 }}>{a.gradeNote}</div>}
            {a.state === 'ENTRY' && a.trade && (
              <div style={{ marginTop: 12 }}>
                <Trade t={a.trade} label={a.side === 'LONG' ? 'Floor defended → buy CE' : 'Ceiling defended → buy PE'} />
                {a.trade.atm && a.trade.atm.strike !== a.trade.strike && <div style={{ marginTop: 12 }}><Trade t={a.trade.atm} label="Alternative: at-the-money" /></div>}
              </div>
            )}
          </div>

          <div className="grid2">
            {[['Ceiling (CE wall)', a.ceiling, 'CE'], ['Floor (PE wall)', a.floor, 'PE']].map(([title, w, typ]) => (
              <div className="card" key={typ}>
                <h2>{title}</h2>
                <div className="big">{w.strike} {typ}</div>
                <div className="kv"><span className="k">OI </span><span className="v">{L(w.oi)}L</span> <span className="small">({w.ratio.toFixed(2)}x next{w.ratio < a.cfg.minWallRatio ? ' – weak' : ''})</span></div>
                <div className="small" style={{ marginTop: 6 }}>
                  {w.status} · OI <span className={cls(w.oiChg)}>{sgn(w.oiChg)}</span> · premium <span className={cls(w.pxChg)}>{sgn(w.pxChg)}</span> ({a.cfg.lookbackMin}m)
                </div>
                <div className="small">Added today: {w.dayAdd >= 0 ? '+' : ''}{L(w.dayAdd)}L · LTP ₹{w.ltp?.toFixed(2)}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Nifty {a.spot.toFixed(2)} · checklist for {a.side === 'LONG' ? 'floor bounce (buy CE)' : 'ceiling rejection (buy PE)'}</h2>
            <ul className="checks">
              {a.checks.map((c) => (
                <li key={c.label}>
                  <span className={`dot ${c.ok === true ? 'pos' : c.ok === false ? (c.bonus ? 'small' : 'neg') : 'small'}`}>{c.ok === true ? '✓' : c.ok === false ? (c.bonus ? '–' : '✗') : '…'}</span>
                  <span><b>{c.label}</b><br /><span className="small">{c.detail}</span></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Plan for both directions (prices are current LTP)</h2>
            {a.setups.map((s) => (
              <div key={s.side} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <b>{s.action}</b>{s.nearest ? ' ← nearest' : ''}
                <div className="small">Watch Nifty {s.side === 'LONG' ? '≤' : '≥'} {s.triggerSpot} (wall {s.wallStrike}), then need OI rising with premium falling.</div>
                {s.buy && <div className="small">Would buy <b>{s.buy.symbol}</b> now ₹{s.buy.ltp.toFixed(2)} → target ₹{s.buy.target.toFixed(2)}, stop ₹{s.buy.stop.toFixed(2)}{s.alt && s.alt.strike !== s.buy.strike ? ` · ATM alt ${s.alt.symbol} ₹${s.alt.ltp.toFixed(2)}` : ''}</div>}
              </div>
            ))}
          </div>

          <div className="card scroll">
            <h2>OI around ATM (change vs {a.cfg.lookbackMin} min ago) · PCR {a.pcr ? a.pcr.toFixed(2) : '–'}</h2>
            <table>
              <thead><tr><th>Strike</th><th>CE OI (L)</th><th>CE chg</th><th>CE LTP</th><th>PE LTP</th><th>PE chg</th><th>PE OI (L)</th></tr></thead>
              <tbody>
                {a.rows.map((r) => (
                  <tr key={r.strike} className={`${r.strike === a.atm ? 'atm' : ''} ${r.strike === a.ceiling.strike || r.strike === a.floor.strike ? 'wallrow' : ''}`}>
                    <td>{r.strike}</td>
                    <td>{L(r.ceOi)}</td><td className={cls(r.ceChg)}>{sgn(r.ceChg)}</td><td>{r.ceLtp.toFixed(2)}</td>
                    <td>{r.peLtp.toFixed(2)}</td><td className={cls(r.peChg)}>{sgn(r.peChg)}</td><td>{L(r.peOi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data?.signals?.length > 0 && (
        <div className="card">
          <h2>Signal log (today)</h2>
          <table>
            <tbody>
              {data.signals.map((s, i) => (
                <tr key={i}>
                  <td>{tm(s.t)}</td>
                  <td><span className={`badge ${s.state}`}>{s.state}</span></td>
                  <td style={{ textAlign: 'left' }}>{s.side} {s.symbol ? `· ${s.symbol} ₹${s.ltp}` : ''}<br /><span className="small">{s.reason}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="small">Analysis only. This app never places orders. Not investment advice; options can lose their full premium.</p>
    </div>
  );
}
