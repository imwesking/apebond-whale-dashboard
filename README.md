# ApeBond Wallet Watch Dashboard

Local dashboard for ApeBond wallet reach, bonded volume, and Wallet Watch rankings.

## Run

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Local API: `http://localhost:8787`

## Commercial Insights

Open `/commercial-insights` for closed-month sales comparisons, product performance, buyer segments, concentration, and current or inactive repeat buyers. The page defaults to the latest completed UTC month covered by the historical index and compares it with the previous month and the same month last year.

`GET /api/commercial-insights?month=YYYY-MM` calculates the section from the existing all-time index and cached catalogue. Opening or refreshing it does not start additional wallet or bond scans. New buyers follow Acquisition's first-observed-purchase-month definition. Inactive repeat buyers purchased in at least two distinct months in the preceding twelve calendar months and made no purchase in the selected month; their previous volume is not a forecast.

Catalogue flags describe the current catalogue, not historical availability. "Not marked sold out" does not establish that an offer can currently be purchased. The page shows separate sales and catalogue timestamps and warns when coverage is incomplete or stale.

## Production

```bash
npm run build
npm start
```

The production server serves the React build and API on one port. Docker uses port `3000`.

```bash
docker build -t apebond-whale-dashboard:latest .
```

Current Dokploy deployment:

- Project: `ApeBond Wallet Dashboard`
- App/service: `apebond-whale-dashboard`
- Domain: `https://apebond-whale-dashboard.204.168.217.98.sslip.io`

## Notes

- All-time mode builds a local cache from ApeBond bond detail APIs. It serves the cached index first and refreshes automatically every day at 04:00 Europe/Madrid, so normal dashboard usage does not repeatedly scan ApeBond.
- The scheduled all-time refresh can be adjusted with `ALL_TIME_REFRESH_TIME_ZONE`, `ALL_TIME_REFRESH_HOUR`, and `ALL_TIME_REFRESH_MINUTE`; defaults are `Europe/Madrid`, `4`, and `0`.
- In Dokploy, the all-time cache is persisted in the service volume mounted at `/app/.cache`; browsers do not build their own all-time cache.
- Period scopes use ApeBond period APIs with a 5-minute server cache: `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`.
- Wallet detail views use a 10-minute server cache per wallet.
- No dashboard credentials are stored. The app reads ApeBond API endpoints directly.
