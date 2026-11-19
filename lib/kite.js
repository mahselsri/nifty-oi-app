// Minimal Kite Connect REST client. READ-ONLY: no order endpoints are used anywhere.

const BASE = 'https://api.kite.trade';

function authHeaders(token) {
  return { 'X-Kite-Version': '3', Authorization: `token ${process.env.KITE_API_KEY}:${token}` };
}

// True if this access token works right now.
export async function tokenIsValid(token) {
  try {
    const r = await fetch(`${BASE}/user/profile`, { headers: authHeaders(token), cache: 'no-store' });
    const j = await r.json();
    return j.status === 'success';
  } catch {
    return false;
  }
}

export async function quote(token, keys) {
  const qs = keys.map((k) => 'i=' + encodeURIComponent(k)).join('&');
  const r = await fetch(`${BASE}/quote?${qs}`, { headers: authHeaders(token), cache: 'no-store' });
  const j = await r.json();
  if (j.status !== 'success') {
    const e = new Error(j.message || 'Quote failed');
    e.type = j.error_type;
    throw e;
  }
  return j.data;
}

// Returns [{s: tradingsymbol, k: strike, t: 'CE'|'PE', e: 'YYYY-MM-DD', l: lotSize}] for NIFTY options.
export async function fetchNiftyOptions(token) {
  const r = await fetch(`${BASE}/instruments/NFO`, { headers: authHeaders(token), cache: 'no-store' });
  if (!r.ok) {
    const e = new Error(`Instruments fetch failed (${r.status})`);
    if (r.status === 403) e.type = 'TokenException';
    throw e;
  }
  const lines = (await r.text()).split('\n');
  const head = lines[0].split(',').map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const iSym = ix('tradingsymbol'), iName = ix('name'), iExp = ix('expiry');
  const iStr = ix('strike'), iLot = ix('lot_size'), iTyp = ix('instrument_type');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    const typ = c[iTyp];
    if (typ !== 'CE' && typ !== 'PE') continue;
    if (c[iName].replace(/"/g, '') !== 'NIFTY') continue;
    out.push({
      s: c[iSym].replace(/"/g, ''),
      k: Number(c[iStr]),
      t: typ,
      e: c[iExp].replace(/"/g, ''),
      l: Number(c[iLot]),
    });
  }
  return out;
}
