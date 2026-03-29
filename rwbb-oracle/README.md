# RWBB ORACLE v6.0 — Vercel Deployment

## Why this works (no more CORS errors)

All external API calls now go through `/api/proxy.js` — a **Vercel serverless function** that runs on the server side. Browsers have CORS restrictions; servers don't. So instead of your browser hitting Binance/Yahoo/Reddit directly, it asks YOUR OWN endpoint which fetches it server-side.

```
Browser → /api/proxy?type=rss&url=...  →  Vercel Function  →  External API
                                                ↑
                                       No CORS here (server)
```

## Project Structure

```
rwbb-oracle/
├── api/
│   └── proxy.js        ← Vercel serverless function (the proxy)
├── public/
│   └── index.html      ← The full Oracle UI
├── package.json
├── vercel.json         ← Routing config
└── README.md
```

## Deploy to Vercel (3 steps)

### Option A — Vercel CLI
```bash
npm i -g vercel
cd rwbb-oracle
vercel --prod
```

### Option B — GitHub + Vercel UI
1. Push this folder to a GitHub repo
2. Go to https://vercel.com/new
3. Import the repo → Deploy
4. Done. Vercel auto-detects the `api/` folder and deploys the function.

## Local Development
```bash
npm i -g vercel
vercel dev
# Opens at http://localhost:3000
```

## What the proxy handles

| Type | Endpoint | Used for |
|------|----------|---------|
| `type=rss` | `/api/proxy?type=rss&url=<feed>` | All 70+ RSS feeds |
| `type=market&url=%5EGSPC` | `/api/proxy?type=market&url=...` | S&P 500 via Yahoo |
| `type=market&url=%5EVIX` | same | VIX |
| `type=btc` | `/api/proxy?type=btc` | BTC price (Binance → CoinCap → Kraken) |
| `type=fg` | `/api/proxy?type=fg` | Fear & Greed (alternative.me) |
| `type=poly` | `/api/proxy?type=poly` | Polymarket top markets |
| `type=gdelt` | `/api/proxy?type=gdelt&q=...` | GDELT article search |

## Caching
The proxy has in-memory caching per function instance:
- RSS: 60s
- Markets: 30s  
- Fear & Greed: 2 min
- Polymarket: 60s
- GDELT: 2 min

Plus Vercel's CDN edge caching (`s-maxage=60`) on top.
