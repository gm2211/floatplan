import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Storm warning overlay';
const endMarker = '/* ============================== Card error / toast helpers';
const stormCode = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));

assert.ok(stormCode.includes('function parseNwsStormMotion'), 'production storm parser block not found');

globalThis.STORM_WARNING_RE = /^(Tornado Warning|Severe Thunderstorm Warning|Special Marine Warning)$/i;
globalThis.NYC_RADAR_DOMAIN = { south: 39.4, west: -76, north: 42.2, east: -71.6 };
globalThis.ALERTS_STORM_REGION_URL = 'https://api.weather.gov/alerts/active';

// Evaluate the production pure parser/projection functions. Leaflet and DOM-dependent
// render functions are only declared here and are never invoked by these assertions.
(0, eval)(stormCode);

const observedIso = '2026-07-15T01:00:00-04:00';
const observedMs = Date.parse(observedIso);
const alert = {
  geometry: {
    type: 'Polygon',
    coordinates: [[[-74.4, 40.5], [-73.9, 40.5], [-73.9, 40.9], [-74.4, 40.5]]]
  },
  properties: {
    event: 'Severe Thunderstorm Warning',
    expires: new Date(observedMs + 40 * 60000).toISOString(),
    parameters: {
      eventMotionDescription: [`${observedIso}...storm...090DEG...015KT...40.70,-74.20 40.75, -74.10`]
    }
  }
};

const motion = parseNwsStormMotion(alert);
assert.equal(motion.observedMs, observedMs);
assert.equal(motion.fromDeg, 90);
assert.equal(motion.bearingDeg, 270, 'NWS FROM direction must reverse to a motion bearing');
assert.equal(motion.speedKt, 15);
assert.deepEqual(motion.locations, [[40.7, -74.2], [40.75, -74.1]]);

const projection = buildStormProjection(alert);
assert.deepEqual(
  projection.times.map(ms => (ms - observedMs) / 60000),
  [0, 15, 30, 40],
  'projection must use 15-minute steps and include the exact expiration'
);
assert.equal(projection.tracks.length, 2);
assert.equal(projection.tracks[0].length, 4);
assert.ok(projection.tracks[0][1][1] < motion.locations[0][1], '090° FROM motion must project west');

const firstStep = projection.tracks[0][1];
const meanLatRad = ((motion.locations[0][0] + firstStep[0]) / 2) * Math.PI / 180;
const northNm = (firstStep[0] - motion.locations[0][0]) * 60;
const eastNm = (firstStep[1] - motion.locations[0][1]) * 60 * Math.cos(meanLatRad);
assert.ok(Math.abs(Math.hypot(northNm, eastNm) - 3.75) < 0.03, '15 kt for 15 minutes must project 3.75 nm');

const malformed = structuredClone(alert);
malformed.properties.parameters.eventMotionDescription = ['unstructured motion text'];
assert.equal(parseNwsStormMotion(malformed), null);
assert.equal(buildStormProjection(malformed), null, 'no track may be invented without official motion metadata');

const noGeometry = structuredClone(alert);
noGeometry.geometry = null;
assert.equal(stormAlertInDomain(noGeometry), false);

console.log('storm track parser and projection assertions passed');
