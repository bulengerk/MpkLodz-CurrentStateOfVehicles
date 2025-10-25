const path = require('path');
const crypto = require('crypto');
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
  const payload = typeof vehiclesJson === 'string' ? vehiclesJson : JSON.stringify(vehiclesJson || []);
  const hash = crypto.createHash('sha1').update(payload).digest('hex');
  if (!lastUpdatedAtMs) return `W/"empty-${hash}"`;
  return `"${lastUpdatedAtMs}-${hash}"`;
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
    fetchImpl = defaultFetch(),
    staticDir = path.join(__dirname, '..', 'public'),
    logger = console
  } = options;

  let refreshIntervalMs = options.refreshIntervalMs == null ? 30000 : Number(options.refreshIntervalMs);
  const MIN_REFRESH_INTERVAL_MS = 5000;
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) {
    logger.warn('Invalid refreshIntervalMs provided; defaulting to 30000ms');
    refreshIntervalMs = 30000;
  }
  if (refreshIntervalMs < MIN_REFRESH_INTERVAL_MS) {
    logger.warn(`refreshIntervalMs too aggressive (${refreshIntervalMs}ms); clamping to ${MIN_REFRESH_INTERVAL_MS}ms`);
    refreshIntervalMs = MIN_REFRESH_INTERVAL_MS;
  }

  let staleAfterMs = options.staleAfterMs == null ? refreshIntervalMs * 4 : Number(options.staleAfterMs);
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    logger.warn('Invalid staleAfterMs provided; defaulting to refreshIntervalMs * 4');
    staleAfterMs = refreshIntervalMs * 4;
  }
  const minimumStale = refreshIntervalMs * 2;
  if (staleAfterMs < minimumStale) {
    logger.warn(`staleAfterMs (${staleAfterMs}ms) too low; bumping to ${minimumStale}ms to avoid false positives`);
    staleAfterMs = minimumStale;
  }

  let fetchTimeoutMs = options.fetchTimeoutMs == null ? 10000 : Number(options.fetchTimeoutMs);
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    logger.warn('Invalid fetchTimeoutMs provided; defaulting to 10000ms');
    fetchTimeoutMs = 10000;
  }
  let maxBackoffMs = options.maxBackoffMs == null ? 5 * 60 * 1000 : Number(options.maxBackoffMs);
  if (!Number.isFinite(maxBackoffMs) || maxBackoffMs <= refreshIntervalMs) {
    const fallback = Math.max(refreshIntervalMs * 4, 5 * 60 * 1000);
    logger.warn(`maxBackoffMs (${maxBackoffMs}) too low; defaulting to ${fallback}`);
    maxBackoffMs = fallback;
  }
  const MAX_BACKOFF_MULTIPLIER = 16;

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
  let vehiclesEtag = computeEtag(0, vehiclesJson);
  let lastUpdatedAtMs = 0;
  let lastUpdateError = null;
  let inFlightUpdate = null;
  let refreshTimer = null;
  let hasStopped = false;
  let consecutiveFailures = 0;
  let httpServer = null;

  const currentEtag = () => vehiclesEtag || computeEtag(lastUpdatedAtMs, vehiclesJson);

  async function refresh() {
    if (inFlightUpdate) return inFlightUpdate;
    inFlightUpdate = (async () => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const fetchOptions = controller ? { signal: controller.signal } : {};
      let timeoutId = null;
      try {
        if (controller && Number.isFinite(fetchTimeoutMs) && fetchTimeoutMs > 0) {
          timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);
        }
        const response = await fetchImpl(feedUrl, fetchOptions);
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
          const vehicleDescriptor = vehicle.vehicle || {};
          const rawLabel = vehicleDescriptor && (vehicleDescriptor.label || vehicleDescriptor.id)
            ? vehicleDescriptor.label || vehicleDescriptor.id
            : null;
          const rawVehicleType = Object.prototype.hasOwnProperty.call(vehicleDescriptor, 'type')
            ? vehicleDescriptor.type
            : null;
          const rawRouteType = Object.prototype.hasOwnProperty.call(attribs, 'routeType')
            ? attribs.routeType
            : (Object.prototype.hasOwnProperty.call(attribs, 'route_type') ? attribs.route_type : null);
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
          const vehicleType = rawVehicleType != null ? rawVehicleType : rawRouteType;
          items.push({
            id: (vehicleDescriptor && (vehicleDescriptor.id || vehicleDescriptor.label)) || entity.id || null,
            label,
            lat: vehicle.position.latitude,
            lon: vehicle.position.longitude,
            bearing: vehicle.position.bearing || null,
            speed: vehicle.position.speed || null,
            routeId: trip ? (trip.routeId || trip.route_id) : null,
            tripId: trip ? (trip.tripId || trip.trip_id) : null,
            timestamp: vehicle.timestamp ? Number(vehicle.timestamp) * 1000 : null,
            headsign: headsign ? headsign.toString().trim() : null,
            directionId,
            vehicleType
          });
        }
        const snapshotTimestamp = Date.now();
        vehicles = items;
        vehiclesJson = JSON.stringify(items);
        vehiclesEtag = computeEtag(snapshotTimestamp, vehiclesJson);
        lastUpdatedAtMs = snapshotTimestamp;
        lastUpdateError = null;
        consecutiveFailures = 0;
        logger.log(`[${new Date().toISOString()}] Updated positions: ${vehicles.length}`);
      } catch (err) {
        lastUpdateError = err;
        consecutiveFailures += 1;
        const context = err && err.name === 'AbortError' ? ' (timeout)' : '';
        logger.error(`[${new Date().toISOString()}] Failed to update feed${context}:`, err && err.message ? err.message : err);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    })();

    try {
      await inFlightUpdate;
    } finally {
      inFlightUpdate = null;
    }
    return vehicles;
  }

  function scheduleNextRefresh() {
    if (hasStopped) return;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    const backoffMultiplier = Math.min(Math.pow(2, Math.max(0, consecutiveFailures - 1)), MAX_BACKOFF_MULTIPLIER);
    const delay = Math.min(refreshIntervalMs * backoffMultiplier, maxBackoffMs);
    refreshTimer = setTimeout(async () => {
      await refresh();
      scheduleNextRefresh();
    }, delay);
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
    const etag = vehiclesEtag || currentEtag();
    res.set('Cache-Control', 'public, max-age=1, must-revalidate');
    res.set('ETag', etag);
    if (lastUpdatedAtMs) {
      res.set('X-Feed-Updated-At', new Date(lastUpdatedAtMs).toISOString());
    }
    if (lastUpdateError) {
      res.set('X-Feed-Error', lastUpdateError.message || 'Unknown error');
    }

    const stalenessMs = lastUpdatedAtMs ? Date.now() - lastUpdatedAtMs : null;
    if (stalenessMs != null && Number.isFinite(stalenessMs)) {
      res.set('X-Feed-Staleness-Ms', String(stalenessMs));
    }
    const isStale = stalenessMs != null && stalenessMs > staleAfterMs;
    if (isStale) {
      res.set('X-Feed-Stale', 'true');
      res.set('Retry-After', String(Math.ceil(refreshIntervalMs / 1000)));
      res.set('X-Feed-Warning', `Data older than ${staleAfterMs}ms`);
    }

    if (!isStale && req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const statusCode = isStale ? 503 : 200;
    res.status(statusCode).type('application/json').send(vehiclesJson);
  });

  if (staticDir) {
    app.get('/', (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.get('/healthz', (req, res) => {
    const state = getState();
    const now = Date.now();
    const stalenessMs = state.lastUpdatedAtMs ? now - state.lastUpdatedAtMs : null;
    const feedIsStale = stalenessMs != null && stalenessMs > staleAfterMs;
    const hadError = Boolean(lastUpdateError);
    const statusOk = !hadError && !feedIsStale;
    const payload = {
      ok: statusOk,
      feedUrl,
      refreshIntervalMs,
      staleAfterMs,
      lastUpdatedAt: state.lastUpdatedAtMs ? new Date(state.lastUpdatedAtMs).toISOString() : null,
      stalenessMs,
      consecutiveFailures,
      lastError: lastUpdateError ? { message: lastUpdateError.message || String(lastUpdateError.name || 'Error') } : null
    };
    res.status(statusOk ? 200 : 503).json(payload);
  });

  async function start(port = 3000) {
    await refresh();
    hasStopped = false;
    scheduleNextRefresh();
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
    hasStopped = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
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
      etag: vehiclesEtag || currentEtag(),
      refreshIntervalMs,
      staleAfterMs,
      fetchTimeoutMs,
      consecutiveFailures,
      isStale: lastUpdatedAtMs ? Date.now() - lastUpdatedAtMs > staleAfterMs : true
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
      refreshIntervalMs,
      staleAfterMs,
      fetchTimeoutMs,
      maxBackoffMs
    }
  };
}

module.exports = {
  createServer
};
