import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Storm cell + warning overlay';
const endMarker = '/* ============================== Card error / toast helpers';
const stormCode = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));

assert.ok(stormCode.includes('function parseNwsStormMotion'), 'production warning-motion parser block not found');
assert.ok(stormCode.includes('function parseIemStormCell'), 'production radar-cell parser block not found');

globalThis.STORM_WARNING_RE = /^(Tornado Warning|Severe Thunderstorm Warning|Special Marine Warning)$/i;
globalThis.NORTHEAST_STORM_DOMAIN = { south: 37, west: -82.5, north: 47.5, east: -65 };
globalThis.ALERTS_STORM_REGION_URL = 'https://api.weather.gov/alerts/active';
globalThis.IEM_STORM_ATTR_URL = 'https://mesonet.agron.iastate.edu/geojson/nexrad_attr.py';

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
// One centroid-anchored track per warning now (declutter: no more one track per
// motion-description vertex) — origin is the mean of the polygon's exterior-ring vertices,
// not motion.locations[0]. For this triangular test polygon that mean is [40.6, -74.15].
assert.deepEqual(projection.origin.map(n => Math.round(n * 100) / 100), [40.6, -74.15]);
assert.equal(projection.track.length, 4);
assert.ok(projection.track[1][1] < projection.origin[1], '090° FROM motion must project west');

const firstStep = projection.track[1];
const meanLatRad = ((projection.origin[0] + firstStep[0]) / 2) * Math.PI / 180;
const northNm = (firstStep[0] - projection.origin[0]) * 60;
const eastNm = (firstStep[1] - projection.origin[1]) * 60 * Math.cos(meanLatRad);
assert.ok(Math.abs(Math.hypot(northNm, eastNm) - 3.75) < 0.03, '15 kt for 15 minutes must project 3.75 nm');

const malformed = structuredClone(alert);
malformed.properties.parameters.eventMotionDescription = ['unstructured motion text'];
assert.equal(parseNwsStormMotion(malformed), null);
assert.equal(buildStormProjection(malformed), null, 'no track may be invented without official motion metadata');

const noGeometry = structuredClone(alert);
noGeometry.geometry = null;
assert.equal(stormAlertInDomain(noGeometry), false);

const northeastAlert = structuredClone(alert);
northeastAlert.geometry.coordinates = [[[-74.6, 43.4], [-74.2, 43.4], [-74.2, 43.7], [-74.6, 43.4]]];
northeastAlert.properties.expires = new Date(Date.now() + 30 * 60000).toISOString();
assert.equal(stormAlertInDomain(northeastAlert), true, 'warning scope must match the Northeast radar-cell scope');

const cellNowMs = Date.parse('2026-07-15T12:30:00Z');
const cellFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-74.7, 41.1] },
  properties: {
    nexrad: 'KOKX', storm_id: 'A1', valid: '2026-07-15T12:25:00Z',
    drct: 270, sknt: 20, max_dbz: 56, top: 41, vil: 38,
    poh: 70, posh: 30, max_size: 1.25, tvs: 'NONE', meso: '4'
  }
};

const cell = parseIemStormCell(cellFeature, cellNowMs);
assert.equal(cell.id, 'A1');
assert.equal(cell.radar, 'KOKX');
assert.equal(cell.fromDeg, 270);
assert.equal(cell.bearingDeg, 90, 'IEM west motion is FROM the west and must project east');
assert.equal(cell.speedKt, 20);
assert.equal(cell.maxDbz, 56);

const missingAttributesFeature = structuredClone(cellFeature);
missingAttributesFeature.properties.max_dbz = null;
missingAttributesFeature.properties.top = '';
missingAttributesFeature.properties.poh = undefined;
const missingAttributesCell = parseIemStormCell(missingAttributesFeature, cellNowMs);
assert.equal(missingAttributesCell.maxDbz, null);
assert.equal(missingAttributesCell.topKft, null);
assert.equal(missingAttributesCell.hailProbability, null, 'missing radar attributes must not be reported as measured zeroes');

const cellProjection = buildRadarCellProjection(cell);
assert.deepEqual(
  cellProjection.times.map(ms => (ms - cell.validMs) / 60000),
  [0, 15, 30, 45, 60],
  'radar-cell tracks must have the example-style one-hour 15-minute time ticks'
);
assert.ok(cellProjection.track[1][1] > cell.lon, 'a cell moving from the west must project east');
const cellFirstStep = cellProjection.track[1];
const cellMeanLatRad = ((cell.lat + cellFirstStep[0]) / 2) * Math.PI / 180;
const cellNorthNm = (cellFirstStep[0] - cell.lat) * 60;
const cellEastNm = (cellFirstStep[1] - cell.lon) * 60 * Math.cos(cellMeanLatRad);
assert.ok(Math.abs(Math.hypot(cellNorthNm, cellEastNm) - 5) < 0.04, '20 kt for 15 minutes must project 5 nm');

const tick = buildStormTrackTick(cellProjection.track[1], cell.bearingDeg, 0.7);
assert.equal(tick.length, 2);
assert.ok(tick[0][0] > tick[1][0], 'eastbound track tick must run perpendicular north-south');

const staleCell = structuredClone(cellFeature);
staleCell.properties.valid = new Date(cellNowMs - 31 * 60000).toISOString();
assert.equal(parseIemStormCell(staleCell, cellNowMs), null, 'stale radar cells must not remain on the map');

const stationaryCell = structuredClone(cellFeature);
stationaryCell.properties.sknt = 0;
assert.equal(parseIemStormCell(stationaryCell, cellNowMs), null, 'zero-motion cells cannot produce a track');
const effectivelyStationaryCell = structuredClone(cellFeature);
effectivelyStationaryCell.properties.sknt = 4;
assert.equal(parseIemStormCell(effectivelyStationaryCell, cellNowMs), null, 'SCIT motion below 5 kt must not create a misleading track');

const outsideCell = structuredClone(cellFeature);
outsideCell.geometry.coordinates = [-96, 35];
assert.equal(parseIemStormCell(outsideCell, cellNowMs), null, 'national feed cells outside the Northeast must be ignored');

const weakerCrossRadarFeature = structuredClone(cellFeature);
weakerCrossRadarFeature.geometry.coordinates = [-74.695, 41.105];
weakerCrossRadarFeature.properties.nexrad = 'KENX';
weakerCrossRadarFeature.properties.storm_id = 'M7';
weakerCrossRadarFeature.properties.max_dbz = 48;
const sameRadarFeature = structuredClone(cellFeature);
sameRadarFeature.geometry.coordinates = [-74.69, 41.11];
sameRadarFeature.properties.storm_id = 'B1';
sameRadarFeature.properties.max_dbz = 50;
const deduped = dedupeRadarStormCells([
  cell,
  parseIemStormCell(weakerCrossRadarFeature, cellNowMs),
  parseIemStormCell(sameRadarFeature, cellNowMs)
], 24);
assert.deepEqual(deduped.map(item => item.id).sort(), ['A1', 'B1'], 'overlapping cross-radar centroids must collapse without hiding same-radar cells');

const conflictingCrossRadarFeature = structuredClone(weakerCrossRadarFeature);
conflictingCrossRadarFeature.properties.storm_id = 'C1';
conflictingCrossRadarFeature.properties.drct = 90;
const conflictingCells = dedupeRadarStormCells([
  cell,
  parseIemStormCell(conflictingCrossRadarFeature, cellNowMs)
], 24);
assert.equal(conflictingCells.length, 2, 'nearby cross-radar cells with incompatible motion must remain distinct');

const manyCells = Array.from({ length: 30 }, (_, index) => ({ ...cell, id: String(index), lon: cell.lon + index * 0.05 }));
assert.equal(dedupeRadarStormCells(manyCells, 5).length, 5, 'deduplication must retain its caller-supplied feed cap');

const nearbyWeakCell = { ...cell, id: 'near', lat: 40.72, lon: -74.01, maxDbz: 35 };
const distantStrongCell = { ...cell, id: 'far', lat: 45, lon: -80, maxDbz: 65 };
const selectedCells = selectRadarStormCells(
  [distantStrongCell, nearbyWeakCell],
  { south: 40.5, west: -74.3, north: 41, east: -73.7 },
  1
);
assert.equal(selectedCells[0].id, 'near', 'a visible NYC cell must not be hidden by stronger distant cells');

const approachingCell = { ...cell, id: 'approaching', lat: 40.72, lon: -74.7, bearingDeg: 90, speedKt: 40, maxDbz: 35 };
const nearbyDepartingCell = { ...cell, id: 'departing', lat: 40.72, lon: -74.2, bearingDeg: 270, speedKt: 40, maxDbz: 65, tvs: 'TVS' };
assert.equal(
  selectRadarStormCells([nearbyDepartingCell, approachingCell], null, 1)[0].id,
  'approaching',
  'closest projected approach to Pier 25 must outrank present distance and storm attributes'
);

const equalApproachWeak = { ...cell, id: 'weak', lat: 40.72, lon: -74.3, bearingDeg: 90, speedKt: 10, maxDbz: 35, tvs: '' };
const equalApproachSignificant = { ...equalApproachWeak, id: 'significant', maxDbz: 58, tvs: 'TVS' };
assert.equal(
  selectRadarStormCells([equalApproachWeak, equalApproachSignificant], null, 1)[0].id,
  'significant',
  'meteorological significance must break equal-approach ties'
);
const equalApproachOlder = { ...equalApproachWeak, id: 'older', validMs: cell.validMs - 5 * 60000 };
const equalApproachNewer = { ...equalApproachWeak, id: 'newer', validMs: cell.validMs };
assert.equal(
  selectRadarStormCells([equalApproachOlder, equalApproachNewer], null, 1)[0].id,
  'newer',
  'recency must break ties when projected approach and significance are equal'
);

const cappedCells = Array.from({ length: 12 }, (_, index) => ({
  ...cell, id: 'cap-' + index, lat: 40.72 + index * 0.01, lon: -74.4, bearingDeg: 90
}));
assert.equal(selectRadarStormCells(cappedCells, null, 24).length, 4, 'render selection must never exceed four radar-cell tracks');
assert.equal(selectRadarStormCells(cappedCells, null).length, 4, 'the default render selection cap must be four');
assert.ok(stormCode.includes('approachNm: radarCellProjectedApproachNm(cell, pier)'), 'projected approach must be computed once per cell before sorting');
assert.ok(stormCode.includes('minutes <= 60; minutes += 1'), 'projected approach must use minute resolution for fast cells');

assert.deepEqual(buildStormLegendItems(0, [], 0), [], 'empty overlays must not show a legend');
const severeLegend = buildStormLegendItems(0, [alert], 1);
assert.deepEqual(
  severeLegend.map(item => item.label),
  ['Severe thunderstorm warning area', 'NWS warning motion'],
  'the key must list only the active warning type and its drawn motion'
);
assert.ok(!severeLegend.some(item => item.label.includes('Tornado')), 'tornado key must stay hidden without a tornado warning');
assert.deepEqual(buildStormLegendItems(1, [], 0).map(item => item.label), ['Radar cell track']);
const tornadoAlert = structuredClone(alert);
tornadoAlert.properties.event = 'Tornado Warning';
assert.deepEqual(buildStormLegendItems(0, [tornadoAlert], 0).map(item => item.label), ['Tornado warning area']);

assert.ok(html.includes('Storm cells &amp; NWS warnings'));
assert.ok(html.includes('NEXRAD storm cells and motion'));
assert.ok(html.includes('<details class="radar-storm-legend hidden" id="radarStormLegend">'), 'overlay key must start hidden and collapsed');
assert.ok(html.includes('<summary>Overlay key</summary>'));
assert.ok(html.includes('storm-key-warning::before'), 'warning areas need outlined swatches distinct from reflectivity colors');
assert.ok(html.includes('<span class="radar-storm-status hidden"'), 'empty storm status must not occupy a row');
assert.ok(html.includes('if (body.innerHTML !== nextHtml) body.innerHTML = nextHtml;'), 'unchanged key content must preserve disclosure state');
assert.ok(!html.includes("clearStormTrackLayer();\n  setRadarStormStatus('');"), 'map movement must not transiently clear live regions');
assert.ok(!html.includes('No radar-tracked storm cells or active NWS warnings'), 'normal no-data state must stay silent');
assert.ok(!html.includes('Storm cell and warning overlay is off.'), 'unchecked state must stay silent');
// Frame-adaptive geometry replaced the old "compute isEndpoint once per static loop" contract:
// each entry now keeps a fixed pool of hover-only pointDots plus one always-permanent
// endpointDot, and updateStormFrameGeometry() decides per playback frame which pool slot (if
// any) is the current endpoint — see stormFrameGeometry/updateStormFrameGeometry below.
assert.ok(
  stormCode.includes('{ permanent: false, direction: \'right\', className: \'storm-time-label\' }'),
  'intermediate radar-cell/warning tick dots must stay hover-only'
);
assert.ok(
  stormCode.includes('{ permanent: true, direction: \'right\', className: \'storm-time-label\' }'),
  'each track must have exactly one permanently-labeled endpoint dot'
);
assert.ok(stormCode.includes('function stormFrameGeometry('), 'frame-adaptive track geometry function not found');
assert.ok(stormCode.includes('function updateStormFrameGeometry('), 'frame-adaptive geometry updater not found');
assert.ok(
  !stormCode.includes('function updateStormFrameMarkers('),
  'the old marker-only-moves updater must be replaced, not left alongside the new one'
);
// Declutter: per-vertex parallel warning tracks are gone in favor of one centroid-anchored
// track per warning (buildStormProjection.origin / .track), same endpoint-only-permanent
// labeling rule as radar-cell tracks.
assert.ok(
  !stormCode.includes('projection.tracks.forEach'),
  'per-vertex parallel warning tracks must be removed'
);
assert.ok(
  stormCode.includes('function polygonCentroid('),
  'warning tracks must anchor at a computed polygon centroid, not per-vertex motion locations'
);

console.log('warning and radar-cell storm track assertions passed');
