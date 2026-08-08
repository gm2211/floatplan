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
globalThis.STORM_HISTORY_LAG_MIN = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5];

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
assert.equal(
  latestIemStormCellValidMs([staleCell, cellFeature]),
  Date.parse(cellFeature.properties.valid),
  'feed freshness must use the newest valid scan rather than array order'
);

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
assert.ok(html.includes('Loading storm tracks…'), 'initial storm metadata load must be visible rather than silently empty');
assert.ok(html.includes('Updating stale storm tracks…'), 'expired SCIT data must trigger an explicit refresh state');
assert.ok(html.includes('No fresh moving radar cells or active storm warnings.'), 'a fresh empty feed must explain why no tracks are drawn');
assert.ok(!html.includes('Storm cell and warning overlay is off.'), 'unchecked state must stay silent');
assert.ok(html.includes("if (mode === radarState.mode) {\n    loadRadarData(true);\n    loadStormCells();\n    loadStormAlerts();"),
  'tapping the active radar mode must refresh imagery and storm metadata together');
assert.ok(html.includes("loadRadarData(true);\n  loadStormCells();\n  loadStormAlerts();\n}"),
  'switching radar modes must not reuse an expired storm snapshot');
assert.ok(html.includes('var stormAlertLoadInFlight = null;') && html.includes('var stormCellLoadInFlight = null;'),
  'concurrent mode/load refreshes must deduplicate storm feed requests');
assert.ok(html.includes("document.addEventListener('visibilitychange', refreshRadarStormFeedsOnResume);"),
  'returning to an old radar tab must refresh expired storm metadata');
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

/* ---- zoom/pan must actually re-derive the displayed selection ---- */
// Regression: selectRadarStormCells declared visibleDomain and never read it, so the moveend
// re-render always rebuilt the same four cells ranked purely by approach to Pier 25. Zooming
// out to bring a distant storm on screen added no track, and zooming in never dropped one.

const HARBOR_VIEW = { south: 40.5, west: -74.3, north: 41.0, east: -73.7 };
const UPSTATE_VIEW = { south: 41.6, west: -76.9, north: 42.2, east: -76.1 };
const WIDE_VIEW = { south: 38.0, west: -78.0, north: 43.0, east: -71.0 };

// Slow, so its hour-long track stays parked inside whichever view frames it. It ranks LAST on
// approach-to-Pier-25, so only the viewport can ever pull it into the selection.
const distantParkedCell = { ...cell, id: 'distant', lat: 41.9, lon: -76.5, bearingDeg: 90, speedKt: 5, maxDbz: 60 };
const harborCell = { ...cell, id: 'harbor', lat: 40.72, lon: -74.05, bearingDeg: 90, speedKt: 20 };
const bothCells = [harborCell, distantParkedCell];

assert.equal(
  selectRadarStormCells(bothCells, HARBOR_VIEW, 1)[0].id,
  'harbor',
  'framing the harbor must keep the harbor cell selected'
);
assert.equal(
  selectRadarStormCells(bothCells, UPSTATE_VIEW, 1)[0].id,
  'distant',
  'zooming in on a distant storm must derive ITS track, not stay pinned to the pier-nearest cell'
);
assert.notDeepEqual(
  selectRadarStormCells(bothCells, HARBOR_VIEW, 2).map(c => c.id),
  selectRadarStormCells(bothCells, UPSTATE_VIEW, 2).map(c => c.id),
  'changing the map view must reorder the derived selection'
);
assert.deepEqual(
  selectRadarStormCells(bothCells, WIDE_VIEW, 2).map(c => c.id),
  ['harbor', 'distant'],
  'when everything is in view, approach to Pier 25 must remain the ranking'
);
// Out-of-view cells still fill leftover slots: the card is about approaching weather, not only
// weather that happens to be framed right now.
assert.deepEqual(
  selectRadarStormCells(bothCells, UPSTATE_VIEW, 4).map(c => c.id),
  ['distant', 'harbor'],
  'out-of-view cells must still fill remaining slots rather than being dropped'
);

// A cell just outside the view but crossing it within the hour is precisely what the card is
// for, so track intersection — not present centroid position — decides visibility.
const inboundCell = { ...cell, id: 'inbound', lat: 40.72, lon: -74.9, bearingDeg: 90, speedKt: 45 };
assert.ok(
  selectRadarStormCells([inboundCell], HARBOR_VIEW, 1).length === 1 &&
    radarCellTrackIntersectsDomain(inboundCell, HARBOR_VIEW),
  'a cell outside the view whose projected track crosses it must count as in view'
);
const recedingCell = { ...cell, id: 'receding', lat: 40.72, lon: -74.9, bearingDeg: 270, speedKt: 45 };
assert.ok(
  !radarCellTrackIntersectsDomain(recedingCell, HARBOR_VIEW),
  'a cell outside the view moving away from it must not count as in view'
);

// A null domain (tests, or a map that has not sized itself yet) must not reorder anything.
assert.deepEqual(
  selectRadarStormCells(bothCells, null, 4).map(c => c.id),
  selectRadarStormCells(bothCells, undefined, 4).map(c => c.id),
  'an absent viewport must leave the approach-ranked order untouched'
);

assert.ok(
  stormCode.includes('inView: visibleDomain ? radarCellTrackIntersectsDomain(cell, visibleDomain) : true'),
  'the map viewport must feed cell selection, not be accepted and ignored'
);
assert.ok(
  stormCode.includes('updateStormFrameGeometry(currentRadarFrameTimeMs());'),
  'a pan/zoom rebuild must re-anchor to the frame currently on screen'
);
assert.ok(
  html.includes("radarState.map.on('moveend'"),
  'pan and zoom must re-derive the storm overlay for the new view'
);

/* ---- exactly one cell marker, and it rides the displayed frame ---- */
// Regression: a second, same-sized marker pinned to the latest detection carried the identity
// tooltip, so on any older frame the labelled dot floated away from the echo it named.
assert.ok(
  stormCode.includes(".bindTooltip('Cell ' + cell.id + ' · ' + cell.radar, { direction: 'top' })"),
  'the cell identity tooltip must still exist'
);
assert.equal(
  stormCode.split("'Cell ' + cell.id + ' · ' + cell.radar").length - 1,
  1,
  'a cell must have exactly one identity-labelled marker'
);
assert.ok(
  /var positionMarker = L\.circleMarker\(origin, \{[\s\S]{0,240}?\}\)\s*\n?\s*\.bindTooltip\('Cell '/.test(stormCode),
  'the identity tooltip must ride the frame-anchored position marker'
);

console.log('warning and radar-cell storm track assertions passed');
