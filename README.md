# zar-calc-data

Auto-generated data file for the [ZAR merchant profit calculator](https://github.com/zarpay/merchant-profit-calculator).

This repo holds two things:

- **`p2p.json`** — the actual data. Refreshed hourly by the workflow in this repo (`.github/workflows/refresh-p2p.yml`), which runs `scripts/fetch-p2p.js` against live Binance / Bybit / OKX P2P endpoints for the 16 currencies the calc supports.
- **`scripts/fetch-p2p.js`** — the fetcher itself. **Mirrored** from [`scripts/fetch-p2p.js` in the calc repo](https://github.com/zarpay/merchant-profit-calculator/blob/main/scripts/fetch-p2p.js). When that script changes, copy the new version here too — they're meant to stay in sync.

The calc reads `p2p.json` CORS-open via jsDelivr at:

```
https://cdn.jsdelivr.net/gh/zarpay/zar-calc-data@main/p2p.json
```

**Do not edit `p2p.json` by hand** — the next cron run will overwrite it.

The workflow uses the repo's default `GITHUB_TOKEN` to commit back to itself, so there's no PAT to maintain. If you ever need to trigger a refresh manually: `gh workflow run refresh-p2p.yml --repo zarpay/zar-calc-data`.
