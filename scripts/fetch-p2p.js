#!/usr/bin/env node
/**
 * Fetch live P2P sell-side prices for the 16 calc currencies and report the
 * offset vs live USD spot (open.er-api.com). Used by the monthly margin-audit
 * routine to refresh `Binance P2P` offsetPct values in COUNTRIES.
 *
 * Source fallback chain (per currency):
 *   1. Binance P2P  (primary — deepest liquidity globally)
 *   2. Bybit P2P    (backup — strong in BD/GH/KES, similar liquidity)
 *   3. OKX P2P      (last resort — strong in GH/KES, doesn't support BDT/ETB)
 * If all three return zero ads, the offset is reported as `null` and the
 * country falls back to its next-highest competitor as the calc's ceiling.
 *
 * Why sell-side: the merchant is selling USDT (their customer's onward
 * remittance dollars). They take a BUY ad — someone advertising they want
 * to BUY USDT. In each exchange's API that's the SELL-side filter from the
 * searcher's perspective.
 *
 * Why median(top 5): the top ad is often an outlier (small volume, high
 * KYC, restrictive payment). Median of top 5 is what a typical merchant
 * could realistically offload at.
 *
 * Run: `node scripts/fetch-p2p.js`
 */

'use strict';
const https = require('https');

const JSON_ONLY = process.argv.includes('--json-only');
const log = JSON_ONLY ? function() {} : console.log;

const CURRENCIES = [
  ['BD','BDT'], ['PK','PKR'], ['LK','LKR'], ['ET','ETB'], ['GH','GHS'],
  ['CD','CDF'], ['AO','AOA'], ['KE','KES'], ['CO','COP'], ['UG','UGX'],
  ['GT','GTQ'], ['DO','DOP'], ['HN','HNL'], ['CR','CRC'], ['PY','PYG'], ['ZM','ZMW']
];

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function request(opts, body) {
  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      let raw = '';
      let bytes = 0;
      res.on('data', c => {
        bytes += c.length;
        if (bytes > MAX_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        raw += c;
      });
      res.on('error', () => resolve(null));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Validates whether a P2P price is plausible compared to spot FX market rate.
 * Ignores rates that deviate by more than 50% from the market spot rate.
 */
function isPlausiblePrice(price, mktRate) {
  if (!price || isNaN(price) || price <= 0) return false;
  if (!mktRate || isNaN(mktRate) || mktRate <= 0) return true;
  const ratio = price / mktRate;
  return ratio >= 0.5 && ratio <= 1.5;
}

// Binance P2P — POST to /bapi/c2c/v2/friendly/c2c/adv/search
async function binance(fiat, fx) {
  const body = JSON.stringify({ asset: 'USDT', fiat, page: 1, rows: 10, tradeType: 'SELL' });
  const j = await request({
    method: 'POST',
    host: 'p2p.binance.com',
    path: '/bapi/c2c/v2/friendly/c2c/adv/search',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0'
    }
  }, body);
  const data = (j && j.data) || [];
  const mkt = fx[fiat];
  return data
    .filter(d => d.adv && d.adv.price)
    .map(d => parseFloat(d.adv.price))
    .filter(p => isPlausiblePrice(p, mkt));
}

// Bybit P2P — POST to /fiat/otc/item/online (side "0" = sell, i.e. BUY ads from searcher's perspective)
async function bybit(fiat, fx) {
  const body = JSON.stringify({
    userId: '', tokenId: 'USDT', currencyId: fiat, payment: [],
    side: '0', size: '10', page: '1', amount: '',
    vaMaker: false, bulkMaker: false, canTrade: false
  });
  const j = await request({
    method: 'POST',
    host: 'api2.bybit.com',
    path: '/fiat/otc/item/online',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0'
    }
  }, body);
  const items = (j && j.result && j.result.items) || [];
  const mkt = fx[fiat];
  return items
    .filter(a => a.price)
    .map(a => parseFloat(a.price))
    .filter(p => isPlausiblePrice(p, mkt));
}

// OKX P2P — GET /v3/c2c/tradingOrders/books?side=sell&...
async function okx(fiat, fx) {
  const path = '/v3/c2c/tradingOrders/books'
    + `?quoteCurrency=${fiat}&baseCurrency=USDT&side=sell`
    + '&paymentMethod=all&userType=all&showTrade=false&showFollow=false'
    + '&showAlreadyTraded=false&isAbleFilter=false';
  const j = await request({
    method: 'GET',
    host: 'www.okx.com',
    path,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!j || !j.data || j.code !== 0) return [];
  const ads = j.data.sell || [];
  const mkt = fx[fiat];
  return ads
    .filter(a => a.price)
    .map(a => parseFloat(a.price))
    .filter(p => isPlausiblePrice(p, mkt));
}

async function fetchAllSources(fiat, fx) {
  // Try in order, return as soon as one returns >=3 ads (thin-market guard).
  const sources = [
    ['binance', binance],
    ['bybit',   bybit],
    ['okx',     okx]
  ];
  for (const [name, fn] of sources) {
    try {
      const prices = await fn(fiat, fx);
      if (prices.length >= 3) return { source: name, prices };
    } catch (e) { /* try next */ }
  }
  return { source: null, prices: [] };
}

async function fetchFx() {
  return new Promise((resolve) => {
    const req = https.get('https://open.er-api.com/v6/latest/USD', (res) => {
      let raw = '';
      let bytes = 0;
      res.on('data', c => {
        bytes += c.length;
        if (bytes > MAX_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        raw += c;
      });
      res.on('error', () => resolve({}));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw).rates || {});
        } catch (e) {
          resolve({});
        }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({}));
  });
}

(async () => {
  const fx = await fetchFx();
  const results = {};
  log('Currency | Mkt rate   | P2P med(5)   | offsetPct  | source   | n ads');
  log('---------|------------|--------------|------------|----------|------');
  for (const [code, fiat] of CURRENCIES) {
    const { source, prices } = await fetchAllSources(fiat, fx);
    const mkt = fx[fiat];
    if (!prices.length) {
      log(`${code} ${fiat.padEnd(4)} | ${(mkt||0).toFixed(2).padStart(10)} | (none)       | null       | (none)   | 0`);
      results[code] = { fiat, marketRate: mkt, p2pMedian: null, offsetPct: null, source: null, nAds: 0 };
      continue;
    }
    // Sort all valid prices ascending
    const sortedAll = prices.slice().sort((a, b) => a - b);
    const top5 = sortedAll.slice(0, 5);
    const midIdx = Math.floor(top5.length / 2);
    const median = top5.length % 2 === 0
      ? (top5[midIdx - 1] + top5[midIdx]) / 2
      : top5[midIdx];

    const offsetPct = mkt ? ((median / mkt - 1) * 100) : null;
    log(`${code} ${fiat.padEnd(4)} | ${(mkt||0).toFixed(2).padStart(10)} | ${median.toFixed(2).padStart(12)} | ${(offsetPct == null ? 'no fx' : offsetPct.toFixed(2) + '%').padStart(9)} | ${source.padEnd(8)} | ${prices.length}`);
    results[code] = {
      fiat,
      marketRate: mkt,
      p2pMedian: median,
      offsetPct: offsetPct == null ? null : +offsetPct.toFixed(1),
      source,
      nAds: prices.length
    };
    await new Promise(r => setTimeout(r, 200));
  }
  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
  } else {
    log('\nJSON:');
    log(JSON.stringify(results, null, 2));
  }
})();