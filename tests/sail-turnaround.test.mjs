import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Sail simulator physics';
const endMarker = '/* ============================== Pre-motor advice';
const physics = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));

globalThis.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
globalThis.round1 = v => Math.round(v * 10) / 10;
globalThis.PIER25 = { lat: 40.7203 };
globalThis.DEFAULT_BOAT_SPEED_KT = 5;
globalThis.DEFAULT_MOTOR_SPEED_KT = 6;
globalThis.valueAtMs = (series, atMs) => {
  const row = series.find(p => atMs >= p.startMs && atMs < p.endMs);
  return row ? row.value : null;
};
globalThis.currentVelocityAt = points => points[0].v;

// Evaluate the production pure-physics block, rather than maintaining a test copy of the
// turnaround math. The block intentionally has no DOM reads.
(0, eval)(physics);

const hour = 3600000;
const minute = 60000;
const departureMs = 0;
const arrivalTargetMs = 165 * minute;

function series(value) {
  return [{ startMs: departureMs, endMs: 4 * hour, value }];
}

// Regression: the old solver accepted arrivalTargetMs itself as a converged turn because
// its -0.050 nm miss fit a loose tolerance derived from the 5 kt hull-speed ceiling. That
// made the inbound leg zero minutes and mislabeled the final 15-minute buffer as the return.
const endpointFixture = findTurnAroundMs(
  departureMs, arrivalTargetMs, PIER25.lat, -1,
  [{ ms: departureMs, v: 0.15 }], series(135), series(2), 5, SAIL_STEP_MS, false, 6
);
assert.notEqual(endpointFixture.turnMs, arrivalTargetMs);
assert.ok(endpointFixture.turnMs <= arrivalTargetMs - SAIL_MIN_RETURN_LEG_MS);
assert.ok(!endpointFixture.converged || Math.abs(endpointFixture.errNm) <= SAIL_HOME_TOLERANCE_NM);

// A normal symmetric reaching case must still produce a genuine round trip with advancing
// samples on both sides of the turn and a final position at Pier 25 within explicit tolerance.
const validTurn = findTurnAroundMs(
  departureMs, arrivalTargetMs, PIER25.lat, -1,
  [{ ms: departureMs, v: 0 }], series(90), series(13), 5, SAIL_STEP_MS, false, 6
);
const validTrip = simulateRoundTrip(
  departureMs, arrivalTargetMs, validTurn.turnMs, PIER25.lat, -1,
  [{ ms: departureMs, v: 0 }], series(90), series(13), 5, SAIL_STEP_MS, false, 6
);
assert.equal(validTurn.converged, true);
assert.ok(validTrip.outPath.length > 1);
assert.ok(validTrip.inPath.length > 1);
assert.ok(arrivalTargetMs - validTurn.turnMs >= SAIL_MIN_RETURN_LEG_MS);
assert.ok(Math.abs((validTrip.finalLat - PIER25.lat) * NM_PER_DEG_LAT) <= SAIL_HOME_TOLERANCE_NM);

console.log('sail turnaround assertions passed');
