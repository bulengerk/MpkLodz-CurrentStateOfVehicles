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

const FEED_URL = process.env.FEED_URL || 'https://otwarte.miasto.lodz.pl/transport_komunikacja/vehicle_positions';
const REFRESH_INTERVAL_MS = parseInt(process.env.REFRESH_INTERVAL_MS || '30000', 10);
const PORT = parseInt(process.env.PORT || '3000', 10);

const server = createServer({
  feedUrl: FEED_URL,
  refreshIntervalMs: REFRESH_INTERVAL_MS,
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
