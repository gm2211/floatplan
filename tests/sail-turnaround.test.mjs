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
assert.equal(sailProjectedBearing(0, 4, 1, 1), 0, 'north stays screen-up');
assert.equal(sailProjectedBearing(4, 0, 1, 1), 90, 'east stays screen-right');
assert.equal(sailProjectedBearing(0, -4, 1, 1), 180, 'south stays screen-down');
assert.ok(Math.abs(sailProjectedBearing(Math.sin(12 * Math.PI / 180), Math.cos(12 * Math.PI / 180), 4, 1) - 40.35) < 0.1,
  'a 12-degree heading must be projected through the strip\'s horizontal stretch');
assert.equal(sailProjectedCompassBearing(SAIL_COURSE_BEARING_N, 4, 1), 0,
  'the N11 Hudson course is screen-up');
assert.ok(Math.abs(sailProjectedCompassBearing(SAIL_COURSE_BEARING_N + 12, 4, 1) - 40.35) < 0.1,
  'a working reach is projected relative to the Hudson axis');
assert.ok(Math.abs(sailProjectedCompassBearing(SAIL_COURSE_BEARING_S, 4, 1) - 180) < 1e-9,
  'the reciprocal S191 Hudson course is screen-down');
assert.ok(sailProjectedCompassBearing(SAIL_COURSE_BEARING_N - 12, 4, 1) > 300,
  'the west working reach stays on the west side of the strip');
const projectedSector = sailProjectedSectorPath(0, 0, 270, 47, 10, 4, 1);
assert.match(projectedSector, /^M0\.0,0\.0 L/);
assert.ok(projectedSector.split(' L').length >= 13, 'the projected cone samples its curved boundary');
const hour = 3600000;
const minute = 60000;
const departureMs = 0;
const arrivalTargetMs = 165 * minute;

function series(value) {
  return [{ startMs: departureMs, endMs: 4 * hour, value }];
}

assert.equal(SAIL_COURSE_BEARING_S, (SAIL_COURSE_BEARING_N + 180) % 360,
  'northbound and southbound river bearings must be reciprocal');

assert.equal(nearestSeriesValue([{ startMs: 24 * hour, endMs: 25 * hour, value: 0 }], departureMs), null,
  'the simulator must not reuse a wind interval from a different day');
assert.equal(nearestSeriesValue([{ startMs: 60 * minute, endMs: 2 * hour, value: 290 }], departureMs), 290,
  'a short gap at the forecast boundary remains usable');

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

// A west wind is a reach on the Hudson axis. A real day sail works a bounded corridor rather
// than following an autopilot-straight line, but those course changes are not false T/J events.
const directReach = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: 0 }],
  series(270), series(13), 5, { initialHeading: 'S' }, false, 6
);
assert.ok(directReach.arrivalMs <= directReach.arriveByMs);
assert.ok(directReach);
assert.equal(directReach.path.some(p => p.maneuver), false);
assert.ok(directReach.path.some(p => p.workingReach));
assert.ok(Math.max(...directReach.path.map(p => p.crossNm)) - Math.min(...directReach.path.map(p => p.crossNm)) >= 0.08);
assert.ok(Math.max(...directReach.path.map(p => p.crossNm)) - Math.min(...directReach.path.map(p => p.crossNm)) <= 0.32,
  'working reaches must stay inside the bounded river corridor');
assert.ok(directReach.furthestDistNm > 1.2);
assert.ok(directReach.furthestDistNm <= Math.abs((SAIL_SOUTH_LIMIT_LAT - PIER25.lat) * NM_PER_DEG_LAT) + 0.02,
  `direct reach crossed the Robbins limit at ${directReach.furthestDistNm.toFixed(2)} nm`);
const quarterFrameMs = directReach.departureMs + (directReach.arrivalMs - directReach.departureMs) * 0.25;
assert.ok(Math.abs((sailValueAt(directReach.path, quarterFrameMs, 'lat') - PIER25.lat) * NM_PER_DEG_LAT) > 0.1,
  'the boat must visibly leave Pier 25 during playback');
assert.equal(directReach.path.some(p => p.ms < directReach.arrivalMs && p.mode === 'sail' && Math.abs(p.sog) < 0.05), false,
  'a valid voyage cannot contain stationary sailing samples before arrival');
assert.equal(directReach.path.at(-1).lat, PIER25.lat, 'the explicit final approach must finish at Pier 25');
assert.equal(directReach.path.at(-1).crossNm, 0, 'the explicit final approach must finish on the mooring axis');
const directInbound = directReach.path.filter(p => p.ms >= directReach.turnMs && p.mode === 'sail');
assert.ok(directInbound.some(p => p.workingReach), 'the return leg must preserve working-reach geometry');
const closestInboundNm = Math.min(...directInbound.map(p => Math.hypot((p.lat - PIER25.lat) * NM_PER_DEG_LAT, p.crossNm)));
assert.ok(closestInboundNm <= SAIL_HOME_TOLERANCE_NM + 1e-6,
  `the inbound working reach must enter the Pier 25 capture circle before docking (${closestInboundNm.toFixed(3)} nm)`);

// Screenshot regression: WNW wind on the N 11° Hudson course is an honest reach. It should
// work alternating efficient headings without claiming those same-side changes are tacks.
const screenshotReach = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: -0.96 }],
  series(292.5), series(14), 5, { initialHeading: 'N' }, false, 6
);
const screenshotSail = screenshotReach.path.filter(p => p.mode === 'sail' && p.ms <= screenshotReach.turnMs);
assert.ok(screenshotSail.length > 1);
assert.equal(screenshotSail.some(p => p.maneuver), false);
assert.ok(Math.max(...screenshotSail.map(p => p.crossNm)) - Math.min(...screenshotSail.map(p => p.crossNm)) >= 0.08);
assert.ok(screenshotSail.every(p => p.courseType === 'reach'));
assert.ok(screenshotSail.every(p => p.strategyReason === 'working-reach'));
assert.ok(new Set(screenshotSail.map(p => Math.round(p.headingDeg))).size >= 2);
assert.ok(screenshotSail.every(p => p.vmg >= Math.max(...screenshotSail.map(q => q.vmg)) * 0.80),
  'working-reach legs must not hide a severely inefficient heading');

function bearingGap(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}
const zeroCurrentStep = directReach.path.find(p => p.mode === 'sail' && Math.abs(p.lateralKt) > 0.01);
const zeroCurrentWaterBearing = sailProjectedCompassBearing(zeroCurrentStep.headingDeg, 4, 1);
const zeroCurrentGroundBearing = sailProjectedBearing(zeroCurrentStep.lateralKt, zeroCurrentStep.sog, 4, 1);
assert.ok(bearingGap(zeroCurrentWaterBearing, zeroCurrentGroundBearing) < 1e-6,
  'without current the projected hull and ground track must align');
const adverseCurrentStep = screenshotSail.find(p => Math.abs(p.lateralKt) > 0.01);
const adverseWaterBearing = sailProjectedCompassBearing(adverseCurrentStep.headingDeg, 4, 1);
const adverseGroundBearing = sailProjectedBearing(adverseCurrentStep.lateralKt, adverseCurrentStep.sog, 4, 1);
assert.ok(bearingGap(adverseWaterBearing, adverseGroundBearing) > 1,
  'adverse current must preserve a visible physical set between hull heading and ground track');
const exactTurnStep = sailStepAt(screenshotReach.path, screenshotReach.turnMs);
const exactTurnAlong = Math.cos(signedBearingDelta(SAIL_COURSE_BEARING_N, exactTurnStep.headingDeg) * Math.PI / 180);
assert.ok(exactTurnAlong * screenshotReach.headingSign > 0,
  'the exact turn timestamp still carries the final outbound record and must not be schedule-flipped');

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
  series(SAIL_COURSE_BEARING_S), series(13), 5, { initialHeading: 'S' }, false, 6
);
const maneuverEvents = maneuverTrip.path.filter(p => p.maneuver);
const crossValues = maneuverTrip.path.map(p => p.crossNm);
assert.ok(maneuverEvents.length >= 2, 'headwind trip should contain multiple computed maneuvers');
assert.ok(maneuverEvents.some(p => p.maneuver === 'tack'), 'upwind leg should tack');
assert.ok(maneuverEvents.some(p => p.maneuver === 'jibe'), 'downwind return should jibe');
assert.ok(Math.max(...crossValues) - Math.min(...crossValues) >= 0.18, 'maneuvers must produce visible lateral geometry');
assert.ok(new Set(maneuverTrip.path.filter(p => p.mode === 'sail').map(p => Math.round(p.headingDeg))).size >= 2,
  'maneuver legs must use distinct sailed headings');

// Forecast shifts must change the sailed strategy in time, produce explicit paid maneuvers,
// and keep real lateral geometry instead of silently bending a straight line.
const shiftingDirection = [
  { startMs: 0, endMs: 60 * minute, value: 281 },
  { startMs: 60 * minute, endMs: 120 * minute, value: SAIL_COURSE_BEARING_N },
  { startMs: 120 * minute, endMs: 4 * hour, value: SAIL_COURSE_BEARING_N + 180 }
];
const shiftingTrip = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: 0 }],
  shiftingDirection, series(14), 5, { initialHeading: 'N' }, false, 6
);
assert.ok(new Set(shiftingTrip.path.filter(p => p.mode === 'sail').map(p => p.courseType)).size >= 2,
  'changing wind must change the optimal point of sail');
assert.ok(shiftingTrip.path.some(p => p.maneuver), 'a strategy transition must be recorded as a maneuver');
const shiftingManeuver = shiftingTrip.path.find(p => p.maneuver);
const comparableSteadyLeg = shiftingTrip.path.find(p => !p.maneuver && p.courseType === shiftingManeuver.courseType &&
  p.windKt === shiftingManeuver.windKt && p.throughWaterKt > 0);
assert.ok(comparableSteadyLeg && shiftingManeuver.throughWaterKt < comparableSteadyLeg.throughWaterKt * 0.6,
  'a strategy transition must pay the maneuver speed loss');
assert.ok(Math.max(...shiftingTrip.path.map(p => p.crossNm)) - Math.min(...shiftingTrip.path.map(p => p.crossNm)) >= 0.12,
  'changing wind must produce visible lateral maneuver geometry');

const calmSample = sailingSample(0, PIER25.lat, 1, 0, series(90), series(0), 5, false);
assert.equal(calmSample.throughWaterKt, 0, 'calm wind cannot propel the sailboat');
const missingWindSample = sailingSample(0, PIER25.lat, 1, 0, [], [], 5, false);
assert.equal(missingWindSample.courseType, 'infeasible');
assert.equal(missingWindSample.throughWaterKt, 0, 'missing wind must not invent a healthy reach');
assert.equal(missingWindSample.windAngleDeg, null, 'missing wind must not be coerced into a north-wind angle');
assert.equal(sailingSample(0, PIER25.lat, 1, 0, series(90), [], 5, false).courseType, 'infeasible',
  'direction without speed is not a usable sailing forecast');
assert.equal(sailingSample(0, PIER25.lat, 1, 0, [], series(12), 5, false).courseType, 'infeasible',
  'speed without direction is not a usable sailing forecast');

assert.equal(sailManeuverBetween(330, 47, 0), 'tack');
assert.equal(sailManeuverBetween(145, 215, 0), 'jibe');
assert.equal(sailManeuverBetween(11, 47, 0), null, 'same-side heading change is not a tack');

assert.deepEqual(sailCrossTrackBounds([{ crossNm: -0.25 }, { crossNm: 0.28 }]), { min: -0.34, max: 0.34 });
assert.deepEqual(sailCrossTrackBounds([{ crossNm: -2 }, { crossNm: 2 }]), { min: -1.05, max: 1.05 });

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

// A failed solver remains unsafe, but it should show the closest physically integrated
// attempt instead of replacing the entire window with a stationary boat at Pier 25.
const failedTrip = computeSailSim(
  departureMs, 180 * minute, [{ ms: departureMs, v: -12 }],
  series(270), series(13), 5, { initialHeading: 'S' }, false, 6
);
assert.equal(failedTrip.converged, false);
assert.ok(failedTrip.path.length > 2);
assert.ok(Number.isFinite(failedTrip.turnErrNm));
assert.ok(failedTrip.path.some(p => Math.abs(p.lat - PIER25.lat) * NM_PER_DEG_LAT > 0.01 || Math.abs(p.crossNm) > 0.01),
  'unsafe diagnostic voyage must visibly move');
assert.equal(failedTrip.path.some(p => p.mode === 'no-trip'), false);
assert.ok(failedTrip.turnMs > departureMs, 'best-effort voyage must include a real outbound leg');
assert.notEqual(failedTrip.path.at(-1).mode, 'overdue',
  'unsafe diagnostic must keep integrating through return time instead of parking offshore');

// Screenshot regression: the 0.12 nm capture threshold was paired with one-decimal display,
// so this real 0.131 nm miss was misleadingly rendered as 0.1 nm. Keep the deterministic
// near-threshold case to protect the distinction between solver state and display precision.
const nearThresholdMiss = computeSailSim(
  departureMs, 120 * minute, [{ ms: departureMs, v: -4 }],
  series(165), series(10), 5, { initialHeading: 'N' }, false, 6
);
assert.equal(nearThresholdMiss.converged, false);
assert.equal(nearThresholdMiss.turnReason, 'missed_mooring');
assert.ok(nearThresholdMiss.turnErrNm > SAIL_HOME_TOLERANCE_NM && nearThresholdMiss.turnErrNm < 0.15,
  `fixture should remain just outside the capture radius (${nearThresholdMiss.turnErrNm.toFixed(3)} nm)`);

// The entrance-current prediction is phase guidance, not a literal Pier 25 velocity.
assert.ok(harborCurrentFactor(PIER25.lat) < harborCurrentFactor(40.67));
assert.equal(harborCurrentAt([{ ms: 0, v: 2 }], 0, PIER25.lat), 2 * harborCurrentFactor(PIER25.lat));

// Keep the dense desktop simulator in the wider center rail, with readouts beside the route.
// A future column rebalance or flex-wrap regression must not silently make it tall again.
assert.match(html, /wide:\s*\{[\s\S]*?colB:\s*\[[^\]]*'sailSimCard'/);
assert.match(html, /\.sailsim-top\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
assert.doesNotMatch(physics, /mode:\s*['"]hold['"]/);
assert.match(html, /True wind angle/);
assert.match(html, /Working reach · ['"] \+ Math\.round\(SAIL_REACH_WEAVE_DEG\)/);
assert.match(html, /grid-template-rows:\s*repeat\(5,\s*52px\)\s*72px/);
assert.match(html, /\.sailsim-readout-row\s*\{[^}]*height:\s*52px/);

// The strip must expose the sailing geometry rather than hiding it behind a generic arrow:
// a heading-oriented top-down hull, the polar's exact no-sail cone centered on true wind
// FROM. Current is a separate filled, semantic-colored vector field.
assert.match(html, /class="sailsim-boat-hull"[^>]*d="M0,-10\.5 C4\.2,-7\.1/);
assert.match(html, /var boatDeg = sailProjectedCompassBearing\(rawBoatDeg, xPixelsPerNm, yPixelsPerNm\)/);
assert.doesNotMatch(html, /waterNorthKt|waterAlongKt = headingNow/);
assert.match(html, /data-water-bearing=/);
assert.match(html, /data-ground-bearing=/);
assert.match(html, /sailProjectedSectorPath\(boatX, boatY, windDir, SAIL_CLOSE_HAULED_DEG, 32, xPixelsPerNm, yPixelsPerNm\)/);
assert.match(html, /sailProjectedCompassBearing\(windFlowTowardDeg, xPixelsPerNm, yPixelsPerNm\)/);
assert.match(html, /windFlowTowardDeg = windAvailable \? normalizeBearing\(windDir \+ 180\)/);
assert.match(html, /NWS ['"] \+ fmtTime\(atMs\) \+ ['"] &middot; WIND FROM ['"] \+ degToCompass\(windDir\)/);
assert.match(html, /var windDir = step && isFinite\(step\.windDir\)/);
assert.match(html, /class="sailsim-wind-vector"/);
assert.match(html, /class="sailsim-current-vector"/);
assert.match(html, /class="sailsim-planned-track"/);
assert.match(html, /class="sailsim-wake" data-mode=/);
assert.match(html, /class="sailsim-maneuver" data-state="planned" data-type=/);
assert.match(html, /class="sailsim-maneuver" data-state="completed" data-type=/);
assert.match(html, /CURRENT &middot;/);
assert.doesNotMatch(html, /sailsim-wind-streak/);
assert.doesNotMatch(html, /sailsim-ferry/);
assert.doesNotMatch(html, /Scheduled ferry/);
assert.doesNotMatch(physics, /FERRY_/);
assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(html, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
assert.match(html, /function sailPlaybackEndMs\(sim\)/);
assert.match(html, /next = state\.sailSim\.departureMs \+ \(\(next - state\.sailSim\.departureMs\) % spanMs\)/,
  'active playback must loop the moving voyage instead of parking on the moored tail');
assert.match(html, /currentAtDepartureKt: harborCurrentAt\(state\.curvePoints, departureMs, PIER25\.lat\)/,
  'direction advice and simulator must share the same local-current scale');
assert.doesNotMatch(html, /points="0,-8 -5,6 5,6"/);
assert.doesNotMatch(html, /var wcx = W - 28/);

console.log('sail turnaround assertions passed');
