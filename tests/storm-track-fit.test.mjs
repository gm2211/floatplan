import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Storm cell + warning overlay';
const endMarker = '/* ============================== Card error / toast helpers';
const stormCode = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));

assert.ok(stormCode.includes('function fitStormCellMotion'), 'SCIT least-squares fit block not found');
assert.ok(stormCode.includes('function resolveStormCellMotion'), 'fitted-vs-reported motion chooser not found');
assert.ok(stormCode.includes('function findHistoricalCellMatch'), 'history association block not found');
assert.ok(stormCode.includes('function stormTrackDiameterNm'), 'uncertainty whisker sizing block not found');

globalThis.STORM_WARNING_RE = /^(Tornado Warning|Severe Thunderstorm Warning|Special Marine Warning)$/i;
globalThis.NORTHEAST_STORM_DOMAIN = { south: 37, west: -82.5, north: 47.5, east: -65 };
globalThis.ALERTS_STORM_REGION_URL = 'https://api.weather.gov/alerts/active';
globalThis.IEM_STORM_ATTR_URL = 'https://mesonet.agron.iastate.edu/geojson/nexrad_attr.py';

// Evaluate the production pure parser/fit functions. Leaflet and DOM-dependent render
// functions are only declared here and are never invoked by these assertions.
(0, eval)(stormCode);

function historyFeature(lon, lat, overrides) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: Object.assign({
      nexrad: 'KOKX', storm_id: 'X', valid: '2026-07-15T11:30:00Z', drct: 270, sknt: 20
    }, overrides || {})
  };
}

/* ---- (1) a perfectly linear history recovers speed/heading and yields a tiny sigma ---- */

const nowMs = Date.parse('2026-07-15T12:00:00Z');
const TRUE_LAT = 40.70, TRUE_LON = -74.00, TRUE_BEARING = 90, TRUE_SPEED_KT = 20;
function trueHistoryPoint(minutesAgo) {
  const distanceNm = TRUE_SPEED_KT * minutesAgo / 60;
  const point = destinationPoint(TRUE_LAT, TRUE_LON, (TRUE_BEARING + 180) % 360, distanceNm);
  return { ms: nowMs - minutesAgo * 60000, lat: point[0], lon: point[1] };
}
const cleanHistory = [20, 15, 10, 5, 0].map(trueHistoryPoint);
const finalPoint = cleanHistory[cleanHistory.length - 1];
assert.equal(finalPoint.ms, nowMs);
assert.ok(Math.abs(finalPoint.lat - TRUE_LAT) < 1e-9 && Math.abs(finalPoint.lon - TRUE_LON) < 1e-9, 'zero-distance projection must land on the true current centroid');

const cleanFit = fitStormCellMotion(cleanHistory);
assert.ok(cleanFit, 'a 5-point history must produce a fit');
assert.ok(Math.abs(cleanFit.speedKt - TRUE_SPEED_KT) < 0.5, 'a perfectly linear history must recover the true speed within tolerance');
assert.ok(bearingDifferenceDeg(cleanFit.bearingDeg, TRUE_BEARING) < 2, 'a perfectly linear history must recover the true heading within tolerance');
assert.ok(cleanFit.sigmaNm <= 0.5, 'a perfectly linear history must yield a small residual');
assert.equal(stormConsistencyFactor(cleanFit.sigmaNm), 0.5, 'a small sigma must clamp the consistency factor to its 0.5 floor');

/* ---- (2) noisy history yields a larger diameter than clean history at the same lead time ---- */

function perturbedPerpendicular(point, offsetNm) {
  const bearing = offsetNm >= 0 ? (TRUE_BEARING + 90) % 360 : (TRUE_BEARING + 270) % 360;
  const shifted = destinationPoint(point.lat, point.lon, bearing, Math.abs(offsetNm));
  return { ms: point.ms, lat: shifted[0], lon: shifted[1] };
}
const noisyHistory = cleanHistory.map((point, index) =>
  index === cleanHistory.length - 1 ? point : perturbedPerpendicular(point, index % 2 === 0 ? 1.8 : -1.8)
);
const noisyFit = fitStormCellMotion(noisyHistory);
assert.ok(noisyFit.sigmaNm > cleanFit.sigmaNm, 'lateral scatter must raise the fit residual above the clean case');
const cleanDiameter60 = stormTrackDiameterNm(cleanFit.sigmaNm, 60);
const noisyDiameter60 = stormTrackDiameterNm(noisyFit.sigmaNm, 60);
assert.ok(noisyDiameter60 > cleanDiameter60, 'a noisier (less consistent) track must widen the uncertainty whisker at the same lead time');

/* ---- (3) diameter clamps at the 0.6 and 10 nm bounds ---- */

assert.equal(stormTrackDiameterNm(0.5, 1), 0.6, 'a tiny lead time with a steady fit must clamp to the 0.6 nm floor');
assert.equal(stormTrackDiameterNm(100, 60), 10, 'a wildly inconsistent fit at +60 min must clamp to the 10 nm ceiling');
assert.ok(stormTrackDiameterNm(1000, 1000) <= 10, 'the ceiling must hold regardless of how far out of range the inputs are');

/* ---- (4) fewer than 3 history points falls back to the radar-reported motion exactly ---- */

const reportedCell = { lat: 40.70, lon: -74.00, validMs: nowMs, bearingDeg: 270, speedKt: 25 };
assert.equal(fitStormCellMotion([]), null, 'zero history points cannot be fit');
assert.equal(fitStormCellMotion([cleanHistory[0], cleanHistory[1]]), null, 'two history points cannot be fit');

const twoPointMotion = resolveStormCellMotion(reportedCell, [cleanHistory[0], cleanHistory[1]]);
assert.equal(twoPointMotion.source, 'reported');
assert.equal(twoPointMotion.speedKt, reportedCell.speedKt);
assert.equal(twoPointMotion.bearingDeg, reportedCell.bearingDeg);
assert.equal(twoPointMotion.sigmaNm, null, 'without a usable fit, sigma must be null rather than a measured value');

// Mis-association / sanity guard: a >=3 point fit that disagrees with the reported motion by
// more than 60 deg heading must also fall back to reported motion (same as no fit at all).
const disagreeingCell = { lat: TRUE_LAT, lon: TRUE_LON, validMs: nowMs, bearingDeg: 0, speedKt: 20 };
const disagreeingMotion = resolveStormCellMotion(disagreeingCell, cleanHistory);
assert.equal(disagreeingMotion.source, 'reported', 'a fit disagreeing >60 deg from the reported heading must be discarded');
assert.equal(disagreeingMotion.sigmaNm, null);

/* ---- (5) association prefers same radar+storm_id and rejects incompatible candidates ---- */

const currentCell = { id: 'A1', radar: 'KOKX', lat: 40.72, lon: -74.00, bearingDeg: 90, validMs: nowMs };

// Same id is authoritative even when a different-id candidate sits closer.
const sameIdFeature = historyFeature(-74.05, 40.70, { storm_id: 'A1', nexrad: 'KOKX', drct: 0 });
const closerDifferentIdFeature = historyFeature(-74.001, 40.721, { storm_id: 'Z9', nexrad: 'KOKX', drct: 270 });
const idMatch = findHistoricalCellMatch(currentCell, [closerDifferentIdFeature, sameIdFeature]);
assert.equal(idMatch.id, 'A1', 'a matching radar+storm_id must be preferred over a closer but differently-identified cell');

// No id match: nearest cell within 10 km with a compatible (<=60 deg) reported bearing is accepted.
const compatibleNearby = destinationPoint(currentCell.lat, currentCell.lon, 45, 4);
const compatibleFeature = historyFeature(compatibleNearby[1], compatibleNearby[0], { storm_id: 'Q0', nexrad: 'KOKX', drct: 270 });
const nearestMatch = findHistoricalCellMatch(currentCell, [compatibleFeature]);
assert.ok(nearestMatch, 'a nearby cell with compatible reported motion must be accepted absent an id match');
assert.equal(nearestMatch.id, 'Q0');

// Bearing mismatch beyond 60 deg is rejected even within 10 km.
const bearingMismatchNearby = destinationPoint(currentCell.lat, currentCell.lon, 45, 4);
const bearingMismatchFeature = historyFeature(bearingMismatchNearby[1], bearingMismatchNearby[0], { storm_id: 'Q1', nexrad: 'KOKX', drct: 0 });
assert.equal(
  findHistoricalCellMatch(currentCell, [bearingMismatchFeature]),
  null,
  'a nearby candidate whose reported motion differs by more than 60 deg must be rejected'
);

// Distance beyond 10 km is rejected even with a perfectly compatible bearing.
const tooFar = destinationPoint(currentCell.lat, currentCell.lon, 45, 15);
const tooFarFeature = historyFeature(tooFar[1], tooFar[0], { storm_id: 'Q2', nexrad: 'KOKX', drct: 270 });
assert.equal(
  findHistoricalCellMatch(currentCell, [tooFarFeature]),
  null,
  'a candidate beyond 10 km must be rejected regardless of bearing compatibility'
);

/* ---- (6) association gates on the SCIT first-guess (backtracked) position, not the
   current one — a fast mover's true ancestor lies well upstream of its current centroid ---- */

// 30 kt eastbound cell; candidates are from a scan 30 minutes earlier, so the first-guess
// position is 15 nm due WEST of the current centroid.
const fastCell = { id: 'F1', radar: 'KOKX', lat: 40.72, lon: -74.00, bearingDeg: 90, speedKt: 30, validMs: nowMs };
const firstGuess = destinationPoint(fastCell.lat, fastCell.lon, 270, 15);

// The true ancestor sits at the first-guess position — far from the current centroid, but it
// must be accepted.
const ancestorFeature = historyFeature(firstGuess[1], firstGuess[0], { storm_id: 'G7', nexrad: 'KOKX', drct: 270 });
const ancestorMatch = findHistoricalCellMatch(fastCell, [ancestorFeature]);
assert.ok(ancestorMatch, 'the true ancestor near the backtracked first-guess position must be accepted');
assert.equal(ancestorMatch.id, 'G7');

// A bearing-compatible impostor at the cell's CURRENT position is ~15 nm from the first
// guess and must now be rejected — this was the mis-association that poisoned fits.
const impostorFeature = historyFeature(fastCell.lon, fastCell.lat, { storm_id: 'G8', nexrad: 'KOKX', drct: 270 });
assert.equal(
  findHistoricalCellMatch(fastCell, [impostorFeature]),
  null,
  'a candidate near the current position but far from the first-guess position must be rejected'
);

// Same-id candidates are still preferred, but only when near the first guess: a recycled id
// sitting at the current centroid (15 nm from the first guess) must fall through.
const recycledIdFeature = historyFeature(fastCell.lon, fastCell.lat, { storm_id: 'F1', nexrad: 'KOKX', drct: 270 });
const recycledResult = findHistoricalCellMatch(fastCell, [recycledIdFeature, ancestorFeature]);
assert.equal(recycledResult.id, 'G7', 'a same-id candidate far from the first guess must lose to a plausible ancestor');

console.log('SCIT motion fit and uncertainty whisker assertions passed');
