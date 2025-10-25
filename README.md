# MPK Łódź – Real-Time Vehicle Visualisation

This project is a compact Node.js application that fetches GTFS Realtime data for MPK Łódź public transport and renders it on a Leaflet map. A lightweight Express server downloads the binary GTFS-RT feed, decodes it with `gtfs-realtime-bindings`, exposes a JSON endpoint, and serves the static client that animates vehicle markers in the browser.

## Repository Structure

- `package.json` – project metadata, runtime dependencies (`express`, `compression`, `gtfs-realtime-bindings`) and scripts for starting the server, linting, and running Node’s built-in test runner.
- `main.js` – loads environment configuration and starts the Express app created by `lib/server.js`, wiring in timeouts/backoff settings and static assets.
- `lib/server.js` – feed refresher and HTTP server factory. Handles GTFS-RT decoding, hashed ETags, stale feed detection, exponential backoff with timeouts, and exposes `/positions` plus a `/healthz` endpoint.
- `public/index.html` – Leaflet-based client that polls `/positions`, animates markers, filters lines, highlights stale/error states, and shows per-vehicle details.
- `test/server.test.js` – lightweight Node test harness that exercises the server’s caching, stale detection, and health endpoint.
- `README.md` – this document.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Optional configuration**
   - `FEED_URL` – alternate GTFS-RT `vehicle_positions` endpoint (HTTP(S) or `file:` URI).
   - `REFRESH_INTERVAL_MS` – how often the server refreshes the upstream feed (default 30000 ms, clamped to ≥5000 ms).
   - `STALE_AFTER_MS` – threshold after which cached data is considered stale and served with HTTP 503 (defaults to `REFRESH_INTERVAL_MS * 4`).
   - `FETCH_TIMEOUT_MS` – abort upstream requests after this many milliseconds (default 10000).
   - `MAX_BACKOFF_MS` – upper bound for exponential backoff after repeated failures (default `max(REFRESH_INTERVAL_MS * 8, 5 minutes)`).

   Example (Linux/macOS):
   ```bash
   export FEED_URL=https://example.com/vehicle_positions.bin
   export REFRESH_INTERVAL_MS=15000
   export STALE_AFTER_MS=60000
   export FETCH_TIMEOUT_MS=8000
   export MAX_BACKOFF_MS=120000
   ```

3. **Start the server**
   ```bash
   npm start
   ```

   Visit `http://localhost:3000` to open the map. Markers update automatically; use the filter input or geolocation button as needed.

4. **Developer tooling**
   - `npm run lint` – run ESLint on the Node sources.
   - `npm test` – execute the Node test suite (uses the built-in `node --test`).

## Deployment – Render

1. Commit and push this repository to a Git provider Render can access (GitHub, GitLab, or Bitbucket).
2. In the Render dashboard choose **New > Web Service** and select the repository. Render will detect the `render.yaml` manifest at the root and pre-populate the service settings.
3. Confirm the generated values or tweak them as needed:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node 18 (enforced via the `NODE_VERSION` variable and `package.json` engines field).
4. Provide any secrets for the GTFS feed under **Environment > Environment Variables**. At minimum set `FEED_URL` if you need a custom feed, plus optional tuning flags such as `REFRESH_INTERVAL_MS`, `STALE_AFTER_MS`, and `FETCH_TIMEOUT_MS`.
5. Click **Create Web Service**. Render will install dependencies, launch `npm start`, and expose the app at the generated URL. Subsequent `git push` operations trigger automatic redeploys.

The supplied `render.yaml` pins a starter instance. Adjust the `plan` or add more environment variables in that file if you need higher concurrency, different regions, or staging environments.

## How It Works

1. **Feed fetch & decode** – `lib/server.js` uses `fetch()` (with timeouts and exponential backoff) to download the GTFS-RT protobuf, decodes it via `gtfs-realtime-bindings`, and stores the parsed vehicles (id, lat/lon, speed, bearing, routeId, tripId, headsign, etc.). Responses are cached with SHA-1–based ETags so multiple clients reuse the same snapshot.
2. **API layer** – Express serves `/positions` (JSON), `/healthz`, and static assets from `public/`. `/positions` returns cached data, honours `If-None-Match`, and emits headers describing staleness and upstream failures. When data exceeds `STALE_AFTER_MS`, clients receive HTTP 503 with warning headers.
3. **Client rendering** – The Leaflet page centres on Łódź, adds OpenStreetMap tiles, polls `/positions`, and animates markers with smooth interpolation. Dynamic route filtering accepts alphanumeric lines, removes stale markers, and surfaces feed errors/staleness directly in the UI. The interface is responsive, optimised for desktop and mobile.

## Monitoring & Operations

- `/healthz` returns a JSON payload (`ok`, `stalenessMs`, `consecutiveFailures`, `lastError`, etc.) and responds with HTTP 503 when data is stale or the last refresh failed.
- `/positions` includes headers `X-Feed-Staleness-Ms`, `X-Feed-Stale`, `X-Feed-Error`, and `X-Feed-Warning` to aid external monitoring or alerting.

## Notes & Next Steps

- Attribution: data provided by [otwarte.miasto.lodz.pl](https://otwarte.miasto.lodz.pl/). Ensure the licence permits your intended use (e.g. commercial/AdSense).
- Enhancements to consider: integrating GTFS static feeds for stop names, adding service alerts/trip updates, or switching to WebSockets/SSE for instant push updates.
- When deploying publicly, add a privacy policy (especially if you use browser geolocation) and comply with cookie/GDPR rules.

Enjoy exploring MPK Łódź in real time!
