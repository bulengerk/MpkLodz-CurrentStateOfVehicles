const express = require('express');
const path = require('path');
// Attempt to use the global fetch implementation available in Node 18 and later.
// If unavailable (e.g. in older Node versions), fall back to requiring
// `node-fetch`.  Note that `node-fetch` is not declared as a dependency in
// package.json; if you run on a legacy Node version you may need to install
// it manually (`npm install node-fetch@2`).
let fetchFn;
if (typeof fetch !== 'undefined') {
  fetchFn = fetch;
} else {
  try {
    // eslint-disable-next-line global-require
    fetchFn = require('node-fetch');
  } catch (err) {
    throw new Error('No fetch implementation found. Use Node.js >= 18 or install node-fetch.');
  }
}
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

// Configuration
// The URL of the GTFS‑RT vehicle positions feed. You can override this via
// an environment variable, e.g. `FEED_URL=https://example.com/vehicle_positions.bin node main.js`.
const FEED_URL = process.env.FEED_URL || 'https://otwarte.miasto.lodz.pl/transport_komunikacja/vehicle_positions';
// How often (in milliseconds) to refresh the vehicle positions.
const REFRESH_INTERVAL_MS = parseInt(process.env.REFRESH_INTERVAL_MS || '30000', 10);
// The port on which the web server will listen.
const PORT = parseInt(process.env.PORT || '3000', 10);

// In‑memory store for the latest vehicle positions.  Each entry contains
// latitude, longitude, bearing, speed and identifiers from the feed.  Clients
// query this list via the `/positions` endpoint.
let vehicles = [];

/**
 * Fetch the GTFS‑RT feed and update the in‑memory list of vehicles.
 *
 * The feed is encoded using Protocol Buffers.  The gtfs‑realtime‑bindings
 * library provides definitions for decoding these messages into JavaScript
 * objects.  Only entities containing a vehicle position are kept.  If a
 * vehicle does not include geographic coordinates it is ignored.
 */
async function updateFeed() {
  try {
    const response = await fetchFn(FEED_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    // Decode the binary feed into a FeedMessage object.  The arrayBuffer() call
    // reads the response body into an ArrayBuffer, which is then wrapped
    // by a Uint8Array for the decoder.
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    // Extract vehicle positions.  Each entity may include a vehicle object
    // containing the current GPS coordinates and other metadata.
    const positions = [];
    for (const entity of feed.entity) {
      const vehicle = entity.vehicle;
      if (!vehicle || !vehicle.position || vehicle.position.latitude == null || vehicle.position.longitude == null) {
        continue;
      }
      positions.push({
        id: (vehicle.vehicle && (vehicle.vehicle.id || vehicle.vehicle.label)) || entity.id || null,
        label: vehicle.vehicle ? vehicle.vehicle.label : null,
        lat: vehicle.position.latitude,
        lon: vehicle.position.longitude,
        bearing: vehicle.position.bearing || null,
        speed: vehicle.position.speed || null,
        routeId: vehicle.trip ? (vehicle.trip.routeId || vehicle.trip.route_id) : null,
        tripId: vehicle.trip ? (vehicle.trip.tripId || vehicle.trip.trip_id) : null,
        timestamp: vehicle.timestamp ? Number(vehicle.timestamp) * 1000 : null
      });
    }
    vehicles = positions;
    console.log(`[${new Date().toISOString()}] Updated positions: ${vehicles.length}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to update feed:`, err.message);
  }
}

// Kick off periodic updates.  Immediately update once at startup, then
// schedule recurring updates on the interval defined above.  If the feed
// cannot be fetched or parsed the previous positions will remain in place.
updateFeed();
setInterval(updateFeed, REFRESH_INTERVAL_MS);

// Set up the Express application.  Use an absolute path for the public
// directory so that static file resolution does not depend on the working
// directory.  The static middleware will serve files such as index.html,
// JavaScript and CSS from the `public` folder.
const app = express();
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Endpoint that returns the latest vehicle positions as JSON.  Clients
// periodically poll this endpoint to refresh the markers on the map.  The
// response is structured as an array of objects with lat, lon and various
// identifiers.
app.get('/positions', (req, res) => {
  res.json(vehicles);
});

// Explicitly serve the index file at the root URL.  This handler is
// registered after the static middleware so it only fires when no static
// resource matches the request (i.e. `/`).
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start the web server.
app.listen(PORT, () => {
  console.log(`MPK Łódź realtime visualiser running on http://localhost:${PORT}`);
  console.log(`Fetching vehicle positions from ${FEED_URL} every ${REFRESH_INTERVAL_MS / 1000}s`);
});