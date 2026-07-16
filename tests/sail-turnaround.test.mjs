import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Sail simulator physics';
const endMarker = '/* ============================== Pre-motor advice';
const physics = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));
const visualHelpers = html.slice(
  html.indexOf('function sailBearingVector'),
  html.indexOf('function renderSailSimSvg')
);

globalThis.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
globalThis.round1 = v => Math.round(v * 10) / 10;
globalThis.PIER25 = { lat: 40.7203, lon: -74.0135 };
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
(0, eval)(visualHelpers);

// Execute the visual coordinate helpers so a future sign/sweep regression cannot make the
// overlay look plausible while reversing the wind or no-sail geometry.
const northVector = sailBearingVector(0);
const eastVector = sailBearingVector(90);
assert.ok(Math.abs(northVector.x) < 1e-12 && Math.abs(northVector.y + 1) < 1e-12);
assert.ok(Math.abs(eastVector.x - 1) < 1e-12 && Math.abs(eastVector.y) < 1e-12);
assert.equal(sailNoSailSectorPath(0, 0, 0, 47, 10),
  'M0.0,0.0 L-7.3,-6.8 A10,10 0 0 1 7.3,-6.8 Z');
globalThis.window = { matchMedia: () => ({ matches: false }) };
const movingPhase = sailWindFlowPhase(1234567, 12);
assert.equal(sailWindFlowPhase(1234567, 12), movingPhase, 'flow phase must be deterministic when scrubbing');
assert.notEqual(sailWindFlowPhase(2234567, 12), movingPhase, 'flow phase must advance with simulator time');
globalThis.window = { matchMedia: () => ({ matches: true }) };
assert.equal(sailWindFlowPhase(2234567, 12), 0, 'reduced motion must freeze the flow phase');

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
assert.ok(Math.hypot((validTrip.finalLat - PIER25.lat) * NM_PER_DEG_LAT, validTrip.finalCrossNm) <= SAIL_HOME_TOLERANCE_NM,
  'turn solver convergence must include lateral mooring error');

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

// Screenshot regression: WNW wind on the N 11° Hudson course is about 78.5° off the bow.
// That is an honest direct reach, so the wake should stay straight and the simulator should
// explicitly preserve the angle/reason that proves why decorative tacks would be wrong.
const screenshotReach = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: -0.96 }],
  series(292.5), series(14), 5, { initialHeading: 'N' }, false, 6
);
const screenshotSail = screenshotReach.path.filter(p => p.mode === 'sail' && p.ms <= screenshotReach.turnMs);
assert.ok(screenshotSail.length > 1);
assert.equal(screenshotSail.some(p => p.maneuver), false);
assert.ok(Math.max(...screenshotSail.map(p => Math.abs(p.crossNm))) < 0.03);
assert.ok(screenshotSail.every(p => p.courseType === 'reach'));
assert.ok(screenshotSail.every(p => p.strategyReason === 'direct-faster'));
assert.ok(screenshotSail.every(p => Math.abs(p.windAngleDeg - 78.5) < 0.01));
assert.ok(screenshotSail.every(p => Math.abs(p.headingDeg - SAIL_COURSE_BEARING_N) < 0.01));

// Exact headwind must choose two positive-progress close-hauled vectors whose lateral
// components cancel over time. Both sides of the river-axis zigzag must be visible.
const exactHeadwind = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: 0 }],
  series(SAIL_COURSE_BEARING_N), series(14), 5, { initialHeading: 'N' }, false, 6
);
const headwindSail = exactHeadwind.path.filter(p => p.mode === 'sail');
const headwindCross = headwindSail.map(p => p.crossNm);
assert.ok(exactHeadwind.path.filter(p => p.maneuver === 'tack').length >= 2,
  'exact headwind should generate multiple computed tacks');
assert.ok(headwindSail.every(p => p.vmg > 0), 'every selected sailing leg must make positive route progress');
assert.ok(headwindCross.some(v => v < -0.02) && headwindCross.some(v => v > 0.02),
  'computed tacks must draw a zigzag on both sides of the route axis');
assert.ok(Math.max(...headwindCross) - Math.min(...headwindCross) >= 0.18,
  'computed tack geometry must be visibly scaled');

// At 49° off the route the old threshold invented a pair with one heading 96° off course,
// then silently clamped that leg to zero VMG. The vector solver keeps the valid direct leg.
const thresholdEdge = chooseSailStrategy(60, SAIL_COURSE_BEARING_N);
assert.equal(thresholdEdge.type, 'reach');
assert.equal(thresholdEdge.reason, 'direct-faster');
assert.ok(thresholdEdge.score > 0);

// Fractional wind bearings around a safely paired beating case must never flicker to
// infeasible because a generated 47° heading rounded to 46.999999999° internally.
for (let windFrom = 16.5; windFrom <= 17.5; windFrom += 0.01) {
  const strategy = chooseSailStrategy(windFrom, 0);
  assert.notEqual(strategy.type, 'infeasible', `strategy flickered at ${windFrom.toFixed(1)}°`);
  assert.ok(strategy.score > 0, `strategy lost forward progress at ${windFrom.toFixed(1)}°`);
}

// Dead downwind is the opposite case: paired broad reaches make more along-route progress
// than the slow polar at 180°, so a real jibe strategy should win.
const deadDownwind = chooseSailStrategy(SAIL_COURSE_BEARING_N + 180, SAIL_COURSE_BEARING_N);
assert.equal(deadDownwind.type, 'jibe');
assert.ok(deadDownwind.negative.along > 0 && deadDownwind.positive.along > 0);
assert.ok(deadDownwind.negative.cross < 0 && deadDownwind.positive.cross > 0);

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
assert.match(html, /True wind angle/);
assert.match(html, /Direct reach · tacking is slower/);

// The strip must expose the sailing geometry rather than hiding it behind a generic arrow:
// a heading-oriented top-down hull, the polar's exact no-sail cone centered on true wind
// FROM, and deterministic downwind brush strokes tied to simulator time.
assert.match(html, /class="sailsim-boat-hull"[^>]*d="M0,-10\.5 C4\.2,-7\.1/);
assert.match(html, /class="sailsim-boat"[^>]*rotate\(' \+ boatDeg\.toFixed\(1\)/);
assert.match(html, /sailNoSailSectorPath\(boatX, boatY, windDir, SAIL_CLOSE_HAULED_DEG, 32\)/);
assert.match(html, /windFromDeg - halfAngleDeg/);
assert.match(html, /windFromDeg \+ halfAngleDeg/);
assert.match(html, /windFlowTowardDeg = windAvailable \? normalizeBearing\(windDir \+ 180\)/);
assert.match(html, /flowPhase = sailWindFlowPhase\(atMs, windSpd\)/);
assert.match(html, /WIND FROM ['"] \+ degToCompass\(windDir\)/);
assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(html, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
assert.doesNotMatch(html, /points="0,-8 -5,6 5,6"/);
assert.doesNotMatch(html, /var wcx = W - 28/);

console.log('sail turnaround assertions passed');
