// Entry point for the MPK Łódź realtime visualiser.
// This file wires environment configuration into the reusable server factory.

const path = require('path');
const { createServer } = require('./lib/server');

let fetchImpl;
if (typeof fetch !== 'undefined') {
  fetchImpl = fetch; // eslint-disable-line no-undef
} else {
  try {
    // eslint-disable-next-line global-require
    fetchImpl = require('node-fetch');
  } catch (err) {
    throw new Error('No fetch implementation found. Use Node.js >= 18 or install node-fetch.');
  }
}

function parseEnvInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const FEED_URL = process.env.FEED_URL || 'https://otwarte.miasto.lodz.pl/transport_komunikacja/vehicle_positions';
const REFRESH_INTERVAL_MS = parseEnvInt(process.env.REFRESH_INTERVAL_MS, 30000);
const PORT = parseEnvInt(process.env.PORT, 3000);
const STALE_AFTER_MS = parseEnvInt(process.env.STALE_AFTER_MS, REFRESH_INTERVAL_MS * 4);
const FETCH_TIMEOUT_MS = parseEnvInt(process.env.FETCH_TIMEOUT_MS, 10000);
const MAX_BACKOFF_MS = parseEnvInt(
  process.env.MAX_BACKOFF_MS,
  Math.max(REFRESH_INTERVAL_MS * 8, 5 * 60 * 1000)
);

const server = createServer({
  feedUrl: FEED_URL,
  refreshIntervalMs: REFRESH_INTERVAL_MS,
  staleAfterMs: STALE_AFTER_MS,
  fetchTimeoutMs: FETCH_TIMEOUT_MS,
  maxBackoffMs: MAX_BACKOFF_MS,
  fetchImpl,
  staticDir: path.join(__dirname, 'public'),
  logger: console
});

server.start(PORT).catch(err => {
  console.error('Failed to start server:', err);
  process.exitCode = 1;
});

process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
