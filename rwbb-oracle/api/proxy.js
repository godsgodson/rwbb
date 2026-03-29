// /api/proxy.js — RWBB Oracle universal proxy
// Runs server-side on Vercel, so no CORS issues ever.
// Supports: rss, market, fg, poly, gdelt

const https = require('https');
const http  = require('http');
const { URL } = require('url');

// Simple in-memory cache (resets per cold start, but Vercel keeps functions warm)
const CACHE = new Map();
const TTL = {
  rss:    60  * 1000,   // 1 min
  market: 30  * 1000,   // 30 sec
  fg:     120 * 1000,   // 2 min
  poly:   60  * 1000,   // 1 min
  gdelt:  120 * 1000,   // 2 min
};

function fetchUrl(rawUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch(e) { return reject(new Error('Invalid URL: ' + rawUrl)); }
    const lib = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RWBBOracle/5.0)',
        'Accept': 'application/json, application/rss+xml, application/xml, text/xml, text/html, */*',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: timeoutMs,
    };
    const req = lib.request(options, res => {
      // Follow redirects (up to 5)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : u.origin + res.headers.location;
        return fetchUrl(redirectUrl, timeoutMs).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { type, url, q, timespan, theme } = req.query;

  // ── GDELT ──────────────────────────────────────────────────
  if (type === 'gdelt') {
    const query    = q || 'war attack cyber';
    const ts       = timespan || '48h';
    const cacheKey = `gdelt:${query}:${ts}`;
    if (CACHE.has(cacheKey) && Date.now() - CACHE.get(cacheKey).ts < TTL.gdelt) {
      const cached = CACHE.get(cacheKey);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.data);
    }
    try {
      const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=25&format=json&sort=DateDesc&timespan=${ts}`;
      const r = await fetchUrl(gdeltUrl, 18000);
      const jsonStart = r.body.indexOf('{');
      const body = jsonStart >= 0 ? r.body.slice(jsonStart) : r.body;
      CACHE.set(cacheKey, { ts: Date.now(), data: body });
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(body);
    } catch(e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── RSS feed ───────────────────────────────────────────────
  if (type === 'rss') {
    if (!url) return res.status(400).json({ error: 'url required' });
    const cacheKey = `rss:${url}`;
    if (CACHE.has(cacheKey) && Date.now() - CACHE.get(cacheKey).ts < TTL.rss) {
      const cached = CACHE.get(cacheKey);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', cached.ct || 'text/xml');
      return res.status(200).send(cached.data);
    }
    try {
      const r = await fetchUrl(url, 14000);
      if (r.status >= 400) return res.status(r.status).json({ error: 'Upstream error ' + r.status });
      const ct = r.headers['content-type'] || 'text/xml';
      CACHE.set(cacheKey, { ts: Date.now(), data: r.body, ct });
      res.setHeader('Content-Type', ct);
      return res.status(200).send(r.body);
    } catch(e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── Market data (Yahoo Finance) ────────────────────────────
  if (type === 'market') {
    const sym = url || '%5EGSPC';
    const cacheKey = `market:${sym}`;
    if (CACHE.has(cacheKey) && Date.now() - CACHE.get(cacheKey).ts < TTL.market) {
      const cached = CACHE.get(cacheKey);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.data);
    }
    try {
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=5d&interval=15m`;
      const r = await fetchUrl(yahooUrl, 14000);
      CACHE.set(cacheKey, { ts: Date.now(), data: r.body });
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(r.body);
    } catch(e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── Fear & Greed ───────────────────────────────────────────
  if (type === 'fg') {
    const cacheKey = 'fg:altme';
    if (CACHE.has(cacheKey) && Date.now() - CACHE.get(cacheKey).ts < TTL.fg) {
      const cached = CACHE.get(cacheKey);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.data);
    }
    try {
      const r = await fetchUrl('https://api.alternative.me/fng/?limit=35&format=json', 10000);
      CACHE.set(cacheKey, { ts: Date.now(), data: r.body });
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(r.body);
    } catch(e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── Polymarket ─────────────────────────────────────────────
  if (type === 'poly') {
    const cacheKey = 'poly:markets';
    if (CACHE.has(cacheKey) && Date.now() - CACHE.get(cacheKey).ts < TTL.poly) {
      const cached = CACHE.get(cacheKey);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.data);
    }
    try {
      const r = await fetchUrl('https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume&ascending=false&limit=20', 12000);
      CACHE.set(cacheKey, { ts: Date.now(), data: r.body });
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(r.body);
    } catch(e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── BTC price ──────────────────────────────────────────────
  if (type === 'btc') {
    const cacheKey = 'btc:price';
    if (CACHE.has(cacheKey) && Date.now() - CACHE.get(cacheKey).ts < TTL.market) {
      const cached = CACHE.get(cacheKey);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.data);
    }
    // Try Binance first, CoinCap fallback
    for (const btcUrl of [
      'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
      'https://api.coincap.io/v2/assets/bitcoin',
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    ]) {
      try {
        const r = await fetchUrl(btcUrl, 10000);
        if (r.status === 200) {
          const body = JSON.stringify({ _src: btcUrl, _raw: JSON.parse(r.body) });
          CACHE.set(cacheKey, { ts: Date.now(), data: body, src: btcUrl });
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).send(body);
        }
      } catch(e) { /* try next */ }
    }
    return res.status(502).json({ error: 'All BTC sources failed' });
  }

  return res.status(400).json({ error: 'Unknown type. Use: rss, market, fg, poly, btc, gdelt' });
};
