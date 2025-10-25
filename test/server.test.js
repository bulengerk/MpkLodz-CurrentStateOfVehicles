const test = require('node:test');
const assert = require('node:assert/strict');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { setTimeout: delay } = require('node:timers/promises');

const { createServer } = require('../lib/server');

function buildFeed({
  entityId = 'veh-1',
  vehicleId = 'veh-1',
  routeId = '10',
  tripId = 'trip-10',
  latitude = 51.75,
  longitude = 19.45,
  timestamp = Math.floor(Date.now() / 1000),
  vehicleType = 0
} = {}) {
  const message = {
    header: {
      gtfs_realtime_version: '2.0'
    },
    entity: [
      {
        id: entityId,
        vehicle: {
          trip: {
            routeId,
            tripId,
            routeType: vehicleType
          },
          vehicle: {
            id: vehicleId,
            label: routeId,
            type: vehicleType
          },
          position: {
            latitude,
            longitude,
            bearing: 90
          },
          timestamp
        }
      }
    ]
  };
  const buffer = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
  return Buffer.from(buffer);
}

async function getPort(server) {
  const httpServer = server.getHttpServer();
  if (!httpServer) {
    throw new Error('HTTP server not running');
  }
  const address = httpServer.address();
  if (typeof address === 'object' && address) {
    return address.port;
  }
  throw new Error('Unable to determine server port');
}

test('createServer serves latest positions with stable ETag', async () => {
  const feedBuffer = buildFeed();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => feedBuffer
    };
  };

  const server = createServer({
    feedUrl: 'test://feed',
    fetchImpl,
    refreshIntervalMs: 10_000,
    staleAfterMs: 2_000,
    fetchTimeoutMs: 100
  });

  await server.start(0);
  assert.equal(fetchCalls, 1);

  const port = await getPort(server);
  const url = (path) => `http://127.0.0.1:${port}${path}`;

  const firstResponse = await fetch(url('/positions'));
  assert.strictEqual(firstResponse.status, 200);
  const firstBody = await firstResponse.json();
  assert.ok(Array.isArray(firstBody));
  assert.equal(firstBody.length, 1);
  assert.equal(firstBody[0].routeId, '10');
  assert.equal(firstBody[0].vehicleType, 0);

  const etag = firstResponse.headers.get('etag');
  assert.match(etag, /^"\d+-[a-f0-9]{40}"$/);

  const cachedResponse = await fetch(url('/positions'), {
    headers: { 'If-None-Match': etag }
  });
  assert.strictEqual(cachedResponse.status, 304);

  await server.stop();
});

test('positions endpoint marks stale data with 503', async () => {
  const feedBuffer = buildFeed();
  const server = createServer({
    feedUrl: 'test://feed-stale',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => feedBuffer
    }),
    refreshIntervalMs: 10_000,
    staleAfterMs: 10,
    fetchTimeoutMs: 100
  });

  await server.start(0);
  const port = await getPort(server);
  const url = (path) => `http://127.0.0.1:${port}${path}`;

  await delay(25);

  const response = await fetch(url('/positions'));
  assert.strictEqual(response.status, 503);
  assert.equal(response.headers.get('x-feed-stale'), 'true');
  const payload = await response.json();
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 1);

  await server.stop();
});

test('slow upstream is aborted and reported in health endpoint', async () => {
  const hangingFetch = (url, options = {}) => new Promise((_, reject) => {
    if (options && options.signal) {
      options.signal.addEventListener('abort', () => {
        const abortError = new Error('Fetch aborted by timeout');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    }
  });

  const server = createServer({
    feedUrl: 'test://slow',
    fetchImpl: hangingFetch,
    refreshIntervalMs: 10_000,
    staleAfterMs: 100,
    fetchTimeoutMs: 20
  });

  await server.start(0);
  const state = server.getState();
  assert.equal(state.consecutiveFailures, 1);
  assert.ok(state.lastUpdateError);
  assert.equal(state.lastUpdateError.name || 'AbortError', 'AbortError');

  const port = await getPort(server);
  const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.strictEqual(healthResponse.status, 503);
  const healthBody = await healthResponse.json();
  assert.equal(healthBody.ok, false);
  assert.equal(healthBody.feedUrl, 'test://slow');
  assert.ok(healthBody.lastError);

  await server.stop();
});
