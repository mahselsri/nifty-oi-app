# Nifty OI Walls (analysis only, no orders)

Finds the ceiling (max call OI) and floor (max put OI) for the nearest Nifty expiry, reads whether
writers are defending them, and tells you which option to buy, the entry limit, target and stop.
It never places orders.

## Deploy (about 10 minutes)

1. **Push to GitHub** and import the repo in Vercel (framework: Next.js, no settings to change).
2. **Add Redis:** Vercel project > Storage > Marketplace > *Upstash Redis* > connect to the project.
   This injects the Redis env vars automatically.
3. **Environment variables** (Project > Settings > Environment Variables):
   - `KITE_API_KEY` from developers.kite.trade (no secret is needed or used)
   - `ACCESS_KEY`: any long random string (stops strangers using your deployment)
4. Redeploy, then open `https://YOUR-APP.vercel.app/?key=YOUR_ACCESS_KEY` once (the browser remembers it).

## Every trading day

1. Before 09:15 open the app. If it shows the **Token** box, paste today's Kite access token and click Save. The token is never stored in env
   vars; it lives in Redis until 6 AM, when Kite expires it. The **Token** button re-opens the box any time.
2. Keep the page open. It refreshes every minute and stores a snapshot each time.
3. Want logging while the page is closed? Create a free job on cron-job.org that calls
   `https://YOUR-APP.vercel.app/api/snapshot?key=YOUR_ACCESS_KEY` every minute, 09:15 to 15:30 IST, Mon to Fri.
   (Vercel's own cron on the free plan runs only once a day, so it can't do this.)

## Reading the screen

| State | Meaning |
|---|---|
| ENTRY | Nifty is at a wall, the wall is dominant and being defended (OI up, premium down). Shows the option, limit price, target, stop |
| WAIT | At the wall but OI is flat or unwinding. Wait |
| SKIP | Wall broken, not dominant, migrating, buyers/covering at the wall, or outside 09:30 to 15:00 |
| COLLECTING | Needs about 5 minutes of snapshots to read OI direction |
| IDLE | Nifty is between the walls. The plan panel shows what to watch |

**Grade A** means a 10+ point bounce off the wall has already happened. **Grade B** is an early entry
(OI confirms but no bounce yet): wait for the bounce or take half size.

## Tuning

All thresholds are in `lib/analyze.js` (`CFG`): wall ratio, touch buffer, lookback, stop and target,
and `tradeStrikeMode` (`'wall'` buys the opposite wall's strike as in your rule, `'atm'` buys at-the-money).

## Data and backtesting

Every snapshot is saved. `GET /api/export?date=YYYY-MM-DD&key=...` returns the day's snapshots as JSON.
`lib/analyze.js` is pure (no network), so a replay script can feed it stored snapshots.

## Local run and tests

```
npm install
npm test          # runs the analysis engine tests on synthetic chains
npm run dev       # needs the env vars above in .env.local
```

Notes: `/api/snapshot?force=1` (the "Fetch now" button) fetches after hours as a connection test
and does not store anything. Check Zerodha's site for current Kite Connect plan pricing and rules.
