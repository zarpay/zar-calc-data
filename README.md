# zar-calc-data

Auto-generated data file for the [ZAR merchant profit calculator](https://github.com/zarpay/merchant-profit-calculator).

This repo holds **one file** — `p2p.json` — refreshed hourly by the calc repo's [`refresh-p2p.yml`](https://github.com/zarpay/merchant-profit-calculator/blob/main/.github/workflows/refresh-p2p.yml) GitHub Action. The action scrapes live Binance / Bybit / OKX P2P sell-side prices for the 16 currencies the calc supports, computes the offset vs the mid-market FX rate, and pushes the result here.

The calc reads it CORS-open via jsDelivr at:

```
https://cdn.jsdelivr.net/gh/zarpay/zar-calc-data@main/p2p.json
```

**Do not edit `p2p.json` by hand** — the next cron run will overwrite it.
