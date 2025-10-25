# MPK Łódź – Real-Time Vehicle Visualisation

This project is a compact Node.js application that fetches GTFS Realtime data for MPK Łódź public transport and renders it on a Leaflet map. A lightweight Express server downloads the binary GTFS-RT feed, decodes it with `gtfs-realtime-bindings`, exposes a JSON endpoint, and serves the static client that animates vehicle markers in the browser.

## Repository Structure

- `package.json` – project metadata and runtime dependencies (`express`, `compression`, `gtfs-realtime-bindings`). The client relies on the global `fetch` API available in Node 18+. If you must use an older Node, install `node-fetch@2` manually and the app will fall back to it.
- `main.js` – Express server that periodically downloads the `vehicle_positions` feed, decodes it, caches the latest snapshot, and exposes `/positions` as JSON. The feed URL can be overridden with the `FEED_URL` environment variable; otherwise the official Open Data Łódź endpoint is used. Responses are cached in-memory, shared across clients, and served with gzip compression.
- `public/index.html` – Leaflet-based client. It polls `/positions`, animates the markers, filters by route, offers quick geolocation, and rotates vehicle icons using the reported bearing. The map shows the feed timestamp and data attribution.
- `README.md` – this document.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Optional configuration**
   - `FEED_URL` – alternate GTFS-RT vehicle_positions endpoint (HTTP(S) or `file:` URI).
   - `REFRESH_INTERVAL_MS` – how often the server refreshes the upstream feed (default 30000 ms).

   Example (Linux/macOS):
   ```bash
   export FEED_URL=https://example.com/vehicle_positions.bin
   export REFRESH_INTERVAL_MS=15000
   ```

3. **Start the server**
   ```bash
   npm start
   ```

   Visit `http://localhost:3000` to open the map. Markers update automatically; use the filter input or geolocation button as needed.

## How It Works

1. **Feed fetch & decode** – `updateFeed()` in `main.js` uses `fetch()` to download the GTFS-RT protobuf, decodes it via `gtfs-realtime-bindings`, and stores the parsed vehicles (id, lat/lon, speed, bearing, routeId, tripId, headsign, etc.). Responses are cached, and an ETag is emitted so multiple clients reuse the same snapshot.
2. **API layer** – Express serves `/positions` (JSON) and static assets from `public/`. The endpoint returns a cached payload and honours `If-None-Match` for efficient polling.
3. **Client rendering** – The Leaflet page centres on Łódź, adds OpenStreetMap tiles, polls `/positions`, and animates markers with smooth interpolation. Popups display line and headsign; icons rotate towards the reported bearing. The interface is responsive, optimised for desktop and mobile.

## Notes & Next Steps

- Attribution: data provided by [otwarte.miasto.lodz.pl](https://otwarte.miasto.lodz.pl/). Ensure the licence permits your intended use (e.g. commercial/AdSense).
- Enhancements to consider: integrating GTFS static feeds for stop names, adding service alerts/trip updates, or switching to WebSockets/SSE for instant push updates.
- When deploying publicly, add a privacy policy (especially if you use browser geolocation) and comply with cookie/GDPR rules.

Enjoy exploring MPK Łódź in real time!
