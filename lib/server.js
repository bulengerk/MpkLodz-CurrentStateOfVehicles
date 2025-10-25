const path = require('path');
const express = require('express');
const compression = require('compression');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

function defaultFetch() {
  /* istanbul ignore next */
  if (typeof fetch !== 'undefined') return fetch; // eslint-disable-line no-undef
  try {
    // eslint-disable-next-line global-require
    return require('node-fetch');
  } catch (err) {
    throw new Error('No fetch implementation found. Use Node.js >= 18 or install node-fetch.');
  }
}

function computeEtag(lastUpdatedAtMs, vehiclesJson) {
  if (!lastUpdatedAtMs) return 'W/"empty"';
  return `"${lastUpdatedAtMs}-${vehiclesJson.length}"`;
}

function deriveHeadsignFromLabel(label) {
  if (!label) return null;
  const text = label.toString().trim();
  if (!text) return null;
  const separatorMatch = text.match(/[-–>]{1,2}\s*(.+)$/);
  if (separatorMatch && separatorMatch[1]) {
    return separatorMatch[1].trim();
  }
  return null;
}

function createServer(options = {}) {
  const {
    feedUrl,
    refreshIntervalMs = 30000,
    fetchImpl = defaultFetch(),
    staticDir = path.join(__dirname, '..', 'public'),
    logger = console
  } = options;

  if (!feedUrl) {
    throw new Error('feedUrl is required to create the server');
  }

  const app = express();
  app.set('etag', false);
  app.use(compression({ threshold: 512 }));
  if (staticDir) {
    app.use(express.static(staticDir));
  }

  let vehicles = [];
  let vehiclesJson = '[]';
  let lastUpdatedAtMs = 0;
  let lastUpdateError = null;
  let inFlightUpdate = null;
  let intervalHandle = null;
  let httpServer = null;

  const currentEtag = () => computeEtag(lastUpdatedAtMs, vehiclesJson);

  async function refresh() {
    if (inFlightUpdate) return inFlightUpdate;
    inFlightUpdate = (async () => {
      try {
        const response = await fetchImpl(feedUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
        const items = [];
        for (const entity of feed.entity) {
          const vehicle = entity.vehicle;
          if (!vehicle || !vehicle.position || vehicle.position.latitude == null || vehicle.position.longitude == null) {
            continue;
          }
          const trip = vehicle.trip || {};
          const attribs = trip;
          const rawLabel = vehicle.vehicle && (vehicle.vehicle.label || vehicle.vehicle.id) ? vehicle.vehicle.label || vehicle.vehicle.id : null;
          const label = rawLabel != null ? rawLabel.toString().trim() : null;
          let headsign = vehicle.headsign
            || attribs.tripHeadsign
            || attribs.trip_headsign
            || attribs.headsign
            || attribs.tripDestination
            || attribs.destination
            || null;
          if (!headsign) {
            headsign = deriveHeadsignFromLabel(label);
          }
          const directionIdProvided = Object.prototype.hasOwnProperty.call(attribs, 'directionId')
            || Object.prototype.hasOwnProperty.call(attribs, 'direction_id');
          const directionId = directionIdProvided ? (attribs.directionId ?? attribs.direction_id ?? null) : null;
          items.push({
            id: (vehicle.vehicle && (vehicle.vehicle.id || vehicle.vehicle.label)) || entity.id || null,
            label,
            lat: vehicle.position.latitude,
            lon: vehicle.position.longitude,
            bearing: vehicle.position.bearing || null,
            speed: vehicle.position.speed || null,
            routeId: trip ? (trip.routeId || trip.route_id) : null,
            tripId: trip ? (trip.tripId || trip.trip_id) : null,
            timestamp: vehicle.timestamp ? Number(vehicle.timestamp) * 1000 : null,
            headsign: headsign ? headsign.toString().trim() : null,
            directionId
          });
        }
        vehicles = items;
        vehiclesJson = JSON.stringify(items);
        lastUpdatedAtMs = Date.now();
        lastUpdateError = null;
        logger.log(`[${new Date().toISOString()}] Updated positions: ${vehicles.length}`);
      } catch (err) {
        lastUpdateError = err;
        logger.error(`[${new Date().toISOString()}] Failed to update feed:`, err.message);
      }
    })();

    try {
      await inFlightUpdate;
    } finally {
      inFlightUpdate = null;
    }
    return vehicles;
  }

  async function ensureLatest() {
    if (inFlightUpdate) {
      try {
        await inFlightUpdate;
      } catch (err) {
        logger.error('ensureLatest error', err);
      }
    } else if (!vehicles.length) {
      await refresh();
    }
  }

  app.get('/positions', async (req, res) => {
    await ensureLatest();
    const etag = currentEtag();
    res.set('Cache-Control', 'public, max-age=1, must-revalidate');
    res.set('ETag', etag);
    if (lastUpdatedAtMs) {
      res.set('X-Feed-Updated-At', new Date(lastUpdatedAtMs).toISOString());
    }
    if (lastUpdateError) {
      res.set('X-Feed-Error', lastUpdateError.message || 'Unknown error');
    }

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.type('application/json').send(vehiclesJson);
  });

  if (staticDir) {
    app.get('/', (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  async function start(port = 3000) {
    await refresh();
    intervalHandle = setInterval(refresh, refreshIntervalMs);
    httpServer = await new Promise((resolve, reject) => {
      const serverInstance = app.listen(port);
      serverInstance.once('listening', () => resolve(serverInstance));
      serverInstance.once('error', reject);
    });
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    logger.log(`MPK Łódź realtime visualiser running on http://localhost:${actualPort}`);
    logger.log(`Fetching vehicle positions from ${feedUrl} every ${refreshIntervalMs / 1000}s`);
    return httpServer;
  }

  async function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
  }

  function getState() {
    return {
      vehicles,
      vehiclesJson,
      lastUpdatedAtMs,
      lastUpdateError,
      etag: currentEtag()
    };
  }

  return {
    app,
    refresh,
    start,
    stop,
    getState,
    getHttpServer: () => httpServer,
    options: {
      feedUrl,
      refreshIntervalMs
    }
  };
}

module.exports = {
  createServer
};
