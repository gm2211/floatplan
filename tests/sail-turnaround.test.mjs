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

// A west wind is a direct reach on the Hudson axis. The simulator must not invent tacks or
// jibes merely to make the picture interesting, and its conservative three-hour range
// should remain around the Statue/Red Hook area rather than routinely reaching Robbins.
const directReach = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: 0 }],
  series(270), series(13), 5, { initialHeading: 'S' }, false, 6
);
assert.ok(directReach);
assert.equal(directReach.path.some(p => p.maneuver), false);
assert.ok(Math.max(...directReach.path.map(p => Math.abs(p.crossNm))) < 0.03);
assert.ok(directReach.furthestDistNm > 1.2);
assert.ok(directReach.furthestDistNm < 3.0, `direct-reach range was ${directReach.furthestDistNm.toFixed(2)} nm`);

// A southbound course into a southerly cannot be sailed on the river axis. It must produce
// real alternating headings and lateral displacement, not a straight line with decorative
// T/J labels laid on top.
const maneuverTrip = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: 0 }],
  series(183), series(13), 5, { initialHeading: 'S' }, false, 6
);
const maneuverEvents = maneuverTrip.path.filter(p => p.maneuver);
const crossValues = maneuverTrip.path.map(p => p.crossNm);
assert.ok(maneuverEvents.length >= 2, 'headwind trip should contain multiple computed maneuvers');
assert.ok(maneuverEvents.some(p => p.maneuver === 'tack'), 'upwind leg should tack');
assert.ok(maneuverEvents.some(p => p.maneuver === 'jibe'), 'downwind return should jibe');
assert.ok(Math.max(...crossValues) - Math.min(...crossValues) >= 0.18, 'maneuvers must produce visible lateral geometry');
assert.ok(new Set(maneuverTrip.path.filter(p => p.mode === 'sail').map(p => Math.round(p.headingDeg))).size >= 2,
  'maneuver legs must use distinct sailed headings');

// Even an intentionally overpowered long-window fixture may never dwell at the club limit.
// It reaches Robbins, reverses immediately, crosses Pier 25 once, and moors early.
const boundaryTrip = computeSailSim(
  departureMs, 8 * hour, [{ ms: departureMs, v: 0 }],
  series(270), series(20), 12, { initialHeading: 'S' }, false, 6
);
assert.ok(boundaryTrip.boundaryArrivalMs != null, 'fixture must exercise the Robbins limit');
assert.equal(boundaryTrip.turnMs, boundaryTrip.boundaryArrivalMs);
assert.equal(boundaryTrip.path.some(p => p.mode === 'hold'), false);
assert.ok(boundaryTrip.arrivalMs < boundaryTrip.arriveByMs, 'immediate limit turn should allow an early mooring');
assert.ok(boundaryTrip.path.filter(p => Math.abs(p.lat - SAIL_SOUTH_LIMIT_LAT) < 1e-7).length <= 1,
  'the path must not park repeated samples on the south limit');
assert.ok(Math.min(...boundaryTrip.path.map(p => p.lat)) >= SAIL_SOUTH_LIMIT_LAT - 1e-9);

// A failed solver starts its diagnostic return at Pier 25. That starting sample is not an
// arrival: preserve the moving diagnostic path and its real miss instead of truncating at
// time zero and reporting the impossible combination "no feasible trip, miss 0.0 nm".
const failedTrip = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: -5 }],
  series(270), series(13), 5, { initialHeading: 'S' }, false, 6
);
assert.equal(failedTrip.converged, false);
assert.ok(failedTrip.path.length > 2);
assert.ok(Math.abs(failedTrip.turnErrNm) > 0.1);
assert.notEqual(failedTrip.arrivalMs, departureMs);

// The entrance-current prediction is phase guidance, not a literal Pier 25 velocity.
assert.ok(harborCurrentFactor(PIER25.lat) < harborCurrentFactor(40.67));
assert.equal(harborCurrentAt([{ ms: 0, v: 2 }], 0, PIER25.lat), 2 * harborCurrentFactor(PIER25.lat));

// Keep the dense desktop simulator in the wider center rail, with readouts beside the route.
// A future column rebalance or flex-wrap regression must not silently make it tall again.
assert.match(html, /wide:\s*\{[\s\S]*?colB:\s*\[[^\]]*'sailSimCard'/);
assert.match(html, /\.sailsim-top\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
assert.doesNotMatch(physics, /mode:\s*['"]hold['"]/);

console.log('sail turnaround assertions passed');
