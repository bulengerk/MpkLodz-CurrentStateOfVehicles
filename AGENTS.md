# Repository Guidelines

## Project Structure & Module Organization
- `main.js` runs the Express server, schedules GTFS-RT fetches, and exposes `/positions` for clients.
- `public/index.html` hosts the Leaflet map and consumes the JSON feed served by Node.
- `package.json` defines runtime dependencies (`express`, `gtfs-realtime-bindings`) and the single `start` script; keep all new scripts grouped here.
- Place any future client assets inside `public/` and shared utilities in a `lib/` folder under the root to keep server-only code separated.

## Build, Test, and Development Commands
- `npm install` installs Node dependencies; run after cloning or when dependencies change.
- `npm start` executes `node main.js`, starting the local server on `http://localhost:3000` and polling the Łódź feed every 30s.
- Set environment overrides inline, e.g. `FEED_URL=https://example.test/bin npm start` to target alternative GTFS-RT feeds.

## Coding Style & Naming Conventions
- Use modern Node (v18+) so the global `fetch` path in `main.js` remains valid; keep imports via `require` for consistency.
- Follow the existing two-space indentation, single quotes, and `const`/`let` usage; upper-case environment driven constants such as `FEED_URL`.
- Prefer descriptive names that match GTFS semantics (`routeId`, `tripId`); avoid abbreviations unless they mirror the feed.

## Testing Guidelines
- No automated test suite exists yet; when adding one, colocate under `test/` and mirror filenames (`main.test.js`).
- For manual verification, run `npm start` and confirm `/positions` returns a JSON array while the map refreshes markers without console errors.
- Document any new diagnostic endpoints or monitoring hooks in `README.md` until formal tests land.

## Commit & Pull Request Guidelines
- Write commit subjects in imperative English (e.g. `Add manual fallback fetch message`) and keep them under ~65 characters.
- Reference related issues in the body and note key configuration changes, especially feed URLs or interval tweaks.
- Pull requests should include: summary of server/client changes, screenshots or GIFs for UI updates inside `public/`, steps to reproduce, and confirmation that `npm start` succeeds locally.

## Configuration & Operations Tips
- Default refresh cadence is 30s; adjust `REFRESH_INTERVAL_MS` thoughtfully to balance freshness and API load.
- Validate third-party feed availability before deployment and capture failures via the existing console logging.
- When deploying, pin Node version via `.nvmrc` or host settings so the runtime offers global `fetch`.
