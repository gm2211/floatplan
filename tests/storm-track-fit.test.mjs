import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Storm cell + warning overlay';
const endMarker = '/* ============================== Card error / toast helpers';
const stormCode = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));
const radarLagMatch = html.match(/var RADAR_LAG_STEPS_MIN = \[([^\]]+)\]/);
assert.ok(radarLagMatch, 'radar playback lag list not found');
globalThis.RADAR_LAG_STEPS_MIN = radarLagMatch[1].split(',').map(value => Number(value.trim()));
globalThis.STORM_HISTORY_LAG_MIN = RADAR_LAG_STEPS_MIN.filter(lagMin => lagMin > 0);
globalThis.fiveMinBucketMs = (timeMs) => Math.floor(timeMs / 300000) * 300000;

assert.ok(stormCode.includes('function fitStormCellMotion'), 'SCIT least-squares fit block not found');
assert.ok(stormCode.includes('function resolveStormCellMotion'), 'fitted-vs-reported motion chooser not found');
assert.ok(stormCode.includes('function findHistoricalCellMatch'), 'history association block not found');
assert.ok(stormCode.includes('function stormTrackDiameterNm'), 'uncertainty whisker sizing block not found');
assert.ok(
  html.includes('var STORM_HISTORY_LAG_MIN = RADAR_LAG_STEPS_MIN.filter(function (lagMin) { return lagMin > 0; });'),
  'storm history fetches must stay derived from every historical radar-loop frame'
);
assert.ok(
  stormCode.includes('var STORM_FIT_MAX_POINTS = 10;'),
  'each frame-relative SCIT fit must remain capped at 10 points'
);

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

// Historical snapshots must retain their own reported motion so an older playback frame can
// fall back to the report known then instead of the current cell's latest report.
const reportSnapshotMs = nowMs - 10 * 60000;
const reportSnapshotPosition = destinationPoint(TRUE_LAT, TRUE_LON, 270, 2);
const historyWithReports = buildStormCellHistory(
  {
    id: 'R1', radar: 'KOKX', lat: TRUE_LAT, lon: TRUE_LON, validMs: nowMs,
    bearingDeg: 90, speedKt: 20
  },
  [{
    bucketMs: reportSnapshotMs,
    features: [historyFeature(reportSnapshotPosition[1], reportSnapshotPosition[0], {
      storm_id: 'R1', nexrad: 'KOKX', valid: new Date(reportSnapshotMs).toISOString(),
      drct: 270, sknt: 12
    })]
  }]
);
assert.equal(historyWithReports[0].bearingDeg, 90, 'a past history point must retain its reported bearing');
assert.equal(historyWithReports[0].speedKt, 12, 'a past history point must retain its reported speed');
assert.equal(historyWithReports.at(-1).speedKt, 20, 'the current point must retain its separate latest report');

/* ---- (7) stormFrameGeometry re-anchors the whole track to an arbitrary radar-frame time ---- */

assert.ok(stormCode.includes('function stormFrameGeometry'), 'frame-adaptive track geometry block not found');

const motionForCell = { bearingDeg: TRUE_BEARING, speedKt: TRUE_SPEED_KT, sigmaNm: cleanFit.sigmaNm };
const cellEntry = { historyPoints: cleanHistory, anchorMs: nowMs, motion: motionForCell, horizonMs: STORM_NO_HORIZON_CAP };

// (a) frameTimeMs === anchorMs must reproduce buildRadarCellProjection's static track exactly.
const atAnchor = stormFrameGeometry(cellEntry, nowMs);
const staticProjection = buildRadarCellProjection(
  { lat: TRUE_LAT, lon: TRUE_LON, validMs: nowMs, bearingDeg: TRUE_BEARING, speedKt: TRUE_SPEED_KT },
  motionForCell
);
assert.equal(atAnchor.times.length, 5, 'a cell frame at its own anchor must produce the static 5-point spread');
assert.ok(
  Math.abs(atAnchor.pos[0] - TRUE_LAT) < 1e-9 && Math.abs(atAnchor.pos[1] - TRUE_LON) < 1e-9,
  'pos at anchor must equal the latest observed centroid'
);
atAnchor.track.forEach((point, index) => {
  assert.ok(
    Math.abs(point[0] - staticProjection.track[index][0]) < 1e-9 && Math.abs(point[1] - staticProjection.track[index][1]) < 1e-9,
    'track point ' + index + ' at frame===anchor must match the static projection exactly'
  );
});

// (b) frameTimeMs 30 min before the anchor must anchor pos on the interpolated observed
// history, and the forward track must lead FROM that upstream position, not from the anchor.
const frame30Before = nowMs - 30 * 60000;
const before = stormFrameGeometry(cellEntry, frame30Before);
const expectedPos = interpolateAlongSeries(cleanHistory, frame30Before);
assert.ok(
  Math.abs(before.pos[0] - expectedPos[0]) < 1e-9 && Math.abs(before.pos[1] - expectedPos[1]) < 1e-9,
  'pos before the anchor must equal the interpolated observed-history position'
);
assert.equal(before.times[0], frame30Before, 'the first time tick must be the displayed frame time itself');
assert.equal(before.track.length, 5, 'a cell 30 minutes before its anchor must still get the full 5-point forward spread');
assert.ok(
  Math.abs(before.track[0][0] - before.pos[0]) < 1e-9 && Math.abs(before.track[0][1] - before.pos[1]) < 1e-9,
  'the track must start exactly at the frame-time position'
);
const stepFromFramePos = destinationPoint(before.pos[0], before.pos[1], TRUE_BEARING, TRUE_SPEED_KT * 0.25);
assert.ok(
  Math.abs(before.track[1][0] - stepFromFramePos[0]) < 1e-9 && Math.abs(before.track[1][1] - stepFromFramePos[1]) < 1e-9,
  'the +15 min track point must extrapolate from the frame-time (upstream) position, not the anchor'
);

// (c) A warning frame beyond its own endMs must collapse the track to the single final point,
// frozen at the position projected up to endMs (not extrapolated further past it).
const warningAnchorMs = nowMs - 60 * 60000;
const warningEndMs = nowMs;
const warningEntry = {
  historyPoints: [{ ms: warningAnchorMs, lat: TRUE_LAT, lon: TRUE_LON }],
  anchorMs: warningAnchorMs,
  motion: { bearingDeg: TRUE_BEARING, speedKt: TRUE_SPEED_KT, sigmaNm: null },
  horizonMs: warningEndMs
};
const pastEnd = stormFrameGeometry(warningEntry, warningEndMs + 20 * 60000);
assert.deepEqual(pastEnd.times, [warningEndMs], 'a frame beyond a warning\'s endMs must collapse times to the single endMs point');
assert.equal(pastEnd.track.length, 1, 'the track must collapse to a single point once the frame passes the warning\'s end');
const expectedFinal = destinationPoint(TRUE_LAT, TRUE_LON, TRUE_BEARING, TRUE_SPEED_KT * ((warningEndMs - warningAnchorMs) / 3600000));
assert.ok(
  Math.abs(pastEnd.track[0][0] - expectedFinal[0]) < 1e-9 && Math.abs(pastEnd.track[0][1] - expectedFinal[1]) < 1e-9,
  'the collapsed point must be the position projected up to the warning\'s end, not extrapolated past it'
);
assert.ok(
  Math.abs(pastEnd.pos[0] - expectedFinal[0]) < 1e-9 && Math.abs(pastEnd.pos[1] - expectedFinal[1]) < 1e-9,
  'pos must freeze at the warning\'s end position once the frame passes it'
);

// (d) Forward-tick lead times are measured from the DISPLAYED frame, not the original anchor —
// scrubbing forward 45 minutes still yields the same [0,15,30,45,60] min lead spread, and
// whisker width (driven by that lead) still grows with lead time.
const laterFrame = nowMs + 45 * 60000;
const laterGeom = stormFrameGeometry(cellEntry, laterFrame);
const leadMinutesFromFrame = laterGeom.times.map((t) => (t - laterFrame) / 60000);
assert.deepEqual(leadMinutesFromFrame, [0, 15, 30, 45, 60], 'forward-tick lead times must be measured from the displayed frame, not the original anchor');
const wideningNear = stormTrackDiameterNm(cleanFit.sigmaNm, leadMinutesFromFrame[1]);
const wideningFar = stormTrackDiameterNm(cleanFit.sigmaNm, leadMinutesFromFrame[4]);
assert.ok(wideningFar >= wideningNear, 'whisker width computed from lead-from-frame minutes must still grow with lead time');

/* ---- (8) radar-cell playback recomputes motion from the frame-known history prefix ---- */

function reportedHistoryPoint(ms, distanceNm, speedKt, bearingDeg = TRUE_BEARING) {
  const point = destinationPoint(TRUE_LAT, TRUE_LON, TRUE_BEARING, distanceNm);
  return { ms, lat: point[0], lon: point[1], bearingDeg, speedKt };
}

const prefixStartMs = Date.parse('2026-07-15T10:00:00Z');
const changingSpeedHistory = [
  reportedHistoryPoint(prefixStartMs, 0, 10),
  reportedHistoryPoint(prefixStartMs + 10 * 60000, 10 / 6, 10),
  reportedHistoryPoint(prefixStartMs + 20 * 60000, 20 / 6, 10),
  reportedHistoryPoint(prefixStartMs + 30 * 60000, 20 / 6 + 3, 18),
  reportedHistoryPoint(prefixStartMs + 40 * 60000, 20 / 6 + 6, 18)
];
const frameRelativeEntry = {
  historyPoints: changingSpeedHistory,
  anchorMs: changingSpeedHistory.at(-1).ms,
  motion: { bearingDeg: 180, speedKt: 30, sigmaNm: null },
  horizonMs: STORM_NO_HORIZON_CAP,
  frameRelativeMotion: true
};

const oldestSupportedFrameState = stormCellFrameState(frameRelativeEntry, prefixStartMs);
assert.ok(oldestSupportedFrameState, 'the oldest fetched radar frame must retain a reported-motion state');
assert.equal(oldestSupportedFrameState.knownPoints.length, 1);

const fullLoopCurrentMs = prefixStartMs + 50 * 60000;
const fullLoopCellPoint = destinationPoint(TRUE_LAT, TRUE_LON, TRUE_BEARING, 10 * 50 / 60);
const fullLoopCell = {
  id: 'LOOP', radar: 'KOKX', lat: fullLoopCellPoint[0], lon: fullLoopCellPoint[1],
  validMs: fullLoopCurrentMs, bearingDeg: TRUE_BEARING, speedKt: 10
};
const fullLoopSnapshots = STORM_HISTORY_LAG_MIN.map(lagMin => {
  const validMs = fullLoopCurrentMs - lagMin * 60000;
  const point = destinationPoint(TRUE_LAT, TRUE_LON, TRUE_BEARING, 10 * (50 - lagMin) / 60);
  return {
    bucketMs: validMs,
    features: [historyFeature(point[1], point[0], {
      storm_id: 'LOOP', valid: new Date(validMs).toISOString(), drct: 270, sknt: 10
    })]
  };
});
const fullLoopHistory = buildStormCellHistory(fullLoopCell, fullLoopSnapshots);
assert.equal(
  fullLoopHistory.length,
  STORM_HISTORY_LAG_MIN.length + 1,
  'building a complete playback history must retain all historical frames plus the current scan'
);
assert.equal(
  fullLoopHistory[0].ms,
  fullLoopCurrentMs - Math.max(...STORM_HISTORY_LAG_MIN) * 60000,
  'the oldest displayed radar frame must survive the production history builder'
);
const olderAnimatedFrameMs = fullLoopCurrentMs - 120 * 60000;
const animatedBuckets = stormHistoryBucketList(fullLoopCurrentMs, [olderAnimatedFrameMs]);
assert.ok(
  animatedBuckets.includes(fiveMinBucketMs(olderAnimatedFrameMs)),
  'an Animated RainViewer frame older than 50 minutes must add its own history bucket'
);
const fullLoopOldestState = stormCellFrameState({
  historyPoints: fullLoopHistory,
  anchorMs: fullLoopCurrentMs,
  motion: { bearingDeg: TRUE_BEARING, speedKt: 10, sigmaNm: null },
  horizonMs: STORM_NO_HORIZON_CAP,
  frameRelativeMotion: true
}, fullLoopHistory[0].ms);
assert.ok(fullLoopOldestState, 'the production-built history must render a track at the oldest radar frame');
const fullLoopLatestState = stormCellFrameState({
  historyPoints: fullLoopHistory,
  anchorMs: fullLoopCurrentMs,
  motion: { bearingDeg: TRUE_BEARING, speedKt: 10, sigmaNm: null },
  horizonMs: STORM_NO_HORIZON_CAP,
  frameRelativeMotion: true
}, fullLoopCurrentMs);
assert.equal(
  fullLoopLatestState.motion.pointCount,
  10,
  'the newest frame may retain 11 visible history points but must cap its SCIT fit at 10'
);

const earlyFrameState = stormCellFrameState(frameRelativeEntry, changingSpeedHistory[2].ms);
const lateFrameState = stormCellFrameState(frameRelativeEntry, changingSpeedHistory[4].ms);
assert.equal(earlyFrameState.knownPoints.length, 3, 'an older frame fit must contain only observations known by that frame');
assert.equal(lateFrameState.knownPoints.length, 5, 'a later frame fit may use the newly-known observations');
assert.equal(earlyFrameState.motion.source, 'fitted');
assert.equal(lateFrameState.motion.source, 'fitted');
assert.ok(
  lateFrameState.motion.speedKt > earlyFrameState.motion.speedKt + 2,
  'different frame prefixes must be able to produce materially different fitted motion'
);
assert.ok(
  Math.abs(earlyFrameState.motion.speedKt - 10) < 0.5,
  'the early frame must recover its own 10 kt prefix instead of leaking the faster latest fit'
);

/* ---- (9) a short prefix falls back to that frame's last known radar report ---- */

const reportChangeHistory = [
  reportedHistoryPoint(prefixStartMs, 0, 9, 90),
  reportedHistoryPoint(prefixStartMs + 10 * 60000, 1.5, 11, 90),
  reportedHistoryPoint(prefixStartMs + 20 * 60000, 3.5, 28, 180)
];
const reportChangeEntry = {
  historyPoints: reportChangeHistory,
  anchorMs: reportChangeHistory.at(-1).ms,
  motion: { bearingDeg: 180, speedKt: 28, sigmaNm: null },
  horizonMs: STORM_NO_HORIZON_CAP,
  frameRelativeMotion: true
};
const fallbackAtSecondReport = stormCellFrameState(reportChangeEntry, reportChangeHistory[1].ms);
assert.equal(fallbackAtSecondReport.motion.source, 'reported');
assert.equal(fallbackAtSecondReport.motion.bearingDeg, 90, 'fallback must not use a later scan\'s reported bearing');
assert.equal(fallbackAtSecondReport.motion.speedKt, 11, 'fallback must not use a later scan\'s reported speed');

/* ---- (10) the complete observed trail stays visible throughout playback ---- */

const earlyFrameGeometry = stormFrameGeometry(frameRelativeEntry, changingSpeedHistory[1].ms);
const lateFrameGeometry = stormFrameGeometry(frameRelativeEntry, changingSpeedHistory[4].ms);
assert.deepEqual(
  earlyFrameGeometry.historyTrail.map(point => point.ms),
  changingSpeedHistory.map(point => point.ms),
  'an early frame must still return the complete observed centroid trail for the history layer'
);
assert.deepEqual(
  lateFrameGeometry.historyTrail.map(point => point.ms),
  changingSpeedHistory.map(point => point.ms),
  'the same complete observed trail must remain visible at the latest frame'
);
assert.equal(earlyFrameGeometry.motion.source, 'reported', 'two frame-known points must use the early reported fallback');
assert.notEqual(
  earlyFrameGeometry.motion.speedKt,
  lateFrameGeometry.motion.speedKt,
  'forecast geometry must carry the motion resolved specifically for each displayed frame'
);

/* ---- (11) the playback updater mutates every live layer from the frame result ---- */

assert.ok(
  html.includes('updateStormFrameGeometry(f.timeMs);'),
  'showRadarFrame must update storm geometry with the displayed frame timestamp'
);

function mockPathLayer() {
  return {
    latLngs: null,
    popupContent: '',
    setLatLngs(value) { this.latLngs = structuredClone(value); },
    setPopupContent(value) { this.popupContent = value; }
  };
}

function mockPointLayer() {
  const tooltip = { content: '', setContent(value) { this.content = value; } };
  return {
    latLng: null,
    style: null,
    _stormOpacity: 1,
    _stormFillOpacity: 1,
    popupContent: '',
    setLatLng(value) { this.latLng = structuredClone(value); },
    setStyle(value) { this.style = structuredClone(value); },
    setPopupContent(value) { this.popupContent = value; },
    getTooltip() { return tooltip; },
    tooltip
  };
}

const liveTrack = mockPathLayer();
const liveHistory = mockPathLayer();
const liveWhiskers = Array.from({ length: 4 }, mockPathLayer);
const liveDots = Array.from({ length: 4 }, mockPointLayer);
const liveEndpoint = mockPointLayer();
const livePosition = mockPointLayer();
const liveEntry = {
  ...frameRelativeEntry,
  cell: {
    id: 'X1', radar: 'KOKX', lat: TRUE_LAT, lon: TRUE_LON,
    validMs: changingSpeedHistory.at(-1).ms, fromDeg: 270, bearingDeg: 90,
    speedKt: 18, maxDbz: 55, topKft: 35
  },
  trackLine: liveTrack,
  historyLine: liveHistory,
  whiskerLines: liveWhiskers,
  pointDots: liveDots,
  endpointDot: liveEndpoint,
  positionMarker: livePosition
};

globalThis.radarState = { map: {}, stormFramePositions: [liveEntry] };
globalThis.fmtTime = (timeMs) => new Date(timeMs).toISOString();
globalThis.escapeHtml = (value) => String(value);
globalThis.degToCompass = (value) => String(value) + '°';

updateStormFrameGeometry(changingSpeedHistory[1].ms);
const earlyLiveTrack = structuredClone(liveTrack.latLngs);
const earlyLiveHistory = structuredClone(liveHistory.latLngs);
const earlyEndpointLabel = liveEndpoint.tooltip.content;
const earlyPopup = liveTrack.popupContent;

updateStormFrameGeometry(changingSpeedHistory[4].ms);
assert.notDeepEqual(
  liveTrack.latLngs,
  earlyLiveTrack,
  'scrubbing to another radar frame must replace the rendered forecast-track geometry'
);
assert.deepEqual(
  liveHistory.latLngs,
  earlyLiveHistory,
  'the complete observed-history layer must stay visible and unchanged while forecast frames move'
);
assert.equal(
  liveHistory.latLngs.length,
  changingSpeedHistory.length,
  'the live history layer must contain every observed centroid'
);
assert.notEqual(
  liveEndpoint.tooltip.content,
  earlyEndpointLabel,
  'the permanent endpoint label must update for the selected frame'
);
assert.notEqual(
  liveTrack.popupContent,
  earlyPopup,
  'the animated track popup must refresh its scan and fitted/reported motion for the selected frame'
);
assert.match(earlyPopup, /Displayed radar frame: 2026-07-15T10:10:00.000Z/);
assert.match(liveTrack.popupContent, /Displayed radar frame: 2026-07-15T10:40:00.000Z/);
assert.ok(liveWhiskers.every(layer => Array.isArray(layer.latLngs) && layer.latLngs.length === 2));
assert.ok(Array.isArray(livePosition.latLng), 'the animated position marker must move with the frame');

console.log('SCIT motion fit, uncertainty whisker, and frame-adaptive track geometry assertions passed');
