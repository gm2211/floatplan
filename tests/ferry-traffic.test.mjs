import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startMarker = '/* ============================== Sail simulator physics';
const endMarker = '/* ============================== Pre-motor advice';
const physics = html.slice(html.indexOf(startMarker), html.indexOf(endMarker));

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
(0, eval)(physics);

const minute = 60000;
const hour = 60 * minute;
const wednesdayStart = ferryNYWallTimeToUtcMs(2026, 7, 15, 15, 0);
const wednesdayEnd = ferryNYWallTimeToUtcMs(2026, 7, 15, 20, 0);

// The checked-in snapshot must expand only departures that the official pages publish.
const weekdayTrips = expandScheduledFerryTrips(wednesdayStart, wednesdayEnd, FERRY_SCHEDULES);
assert.ok(weekdayTrips.some(t => t.scheduleId === 'nyw-hoboken-njt-brookfield' &&
  t.fromName === 'Hoboken/NJT' && ferryNYParts(t.startMs).hh === 17 && ferryNYParts(t.startMs).mi === 0));
assert.ok(weekdayTrips.some(t => t.scheduleId === 'nyw-hoboken-14-brookfield' &&
  t.fromName === 'Hoboken 14th St' && ferryNYParts(t.startMs).hh === 17 && ferryNYParts(t.startMs).mi === 5));
const saturdayStart = ferryNYWallTimeToUtcMs(2026, 7, 18, 15, 0);
const saturdayTrips = expandScheduledFerryTrips(saturdayStart, saturdayStart + 5 * hour, FERRY_SCHEDULES);
assert.ok(saturdayTrips.some(t => t.scheduleId === 'nyw-hoboken-njt-brookfield'));
assert.equal(saturdayTrips.some(t => t.scheduleId === 'nyw-hoboken-14-brookfield'), false,
  'the official Hoboken 14th/Brookfield page publishes weekday service only');
assert.equal(ferryNYWallTimeToUtcMs(2026, 3, 8, 6, 0), Date.UTC(2026, 2, 8, 10, 0),
  'post-spring-forward departures must use EDT even when the host timezone does not');
assert.equal(ferryNYWallTimeToUtcMs(2026, 11, 1, 6, 0), Date.UTC(2026, 10, 1, 11, 0),
  'post-fall-back departures must use EST even when the host timezone does not');

// Terminal coordinates project into the simulator's physical along/cross frame, and a
// ferry position interpolates continuously between those endpoints.
const terminal = sailCoordinatesFromLatLon(FERRY_TERMINALS.hobokenNjt.lat, FERRY_TERMINALS.hobokenNjt.lon);
assert.ok(Number.isFinite(terminal.alongNm) && Number.isFinite(terminal.crossNm));
const interpolatedTrip = ferryTripFromDeparture(FERRY_SCHEDULES[0], FERRY_TERMINALS.hobokenNjt,
  FERRY_TERMINALS.brookfield, wednesdayStart, 'from');
const midpoint = scheduledFerryPositionAt(interpolatedTrip, wednesdayStart + 5 * minute);
assert.ok(Math.abs(midpoint.alongNm - (interpolatedTrip.from.alongNm + interpolatedTrip.to.alongNm) / 2) < 1e-9);
assert.ok(Math.abs(midpoint.crossNm - (interpolatedTrip.from.crossNm + interpolatedTrip.to.crossNm) / 2) < 1e-9);

// Endpoint-only checks would see two vessels one nautical mile apart at both samples. The
// continuous CPA must catch that the crossing body passes through the boat between them.
const cpa = continuousRelativeMotionCpa(
  { alongNm: 0, crossNm: 0, alongKt: 0, crossKt: 0 },
  { alongNm: 0, crossNm: -1, alongKt: 0, crossKt: 60 },
  2 * minute
);
assert.ok(cpa.distanceNm < 1e-9);
assert.ok(Math.abs(cpa.tcpaMs - minute) < 1e-6);

const earlyOnlyTrip = {
  id: 'early-envelope', routeName: 'Timing-envelope fixture',
  startMs: 3 * minute, endMs: 5 * minute, uncertaintyMs: 2 * minute,
  from: { alongNm: 0, crossNm: -1 }, to: { alongNm: 0, crossNm: 1 }
};
const earlyConflict = scheduledFerryConflictAt(0,
  { alongNm: 0, crossNm: 0, alongKt: 0, crossKt: 0 }, [earlyOnlyTrip], 2 * minute);
assert.ok(earlyConflict, 'the early edge of the published ±2 min timing envelope must affect CPA');
assert.ok(earlyConflict.timingShiftMs >= -2 * minute && earlyConflict.timingShiftMs <= 2 * minute);

const interiorTimingTrip = {
  id: 'interior-envelope', routeName: 'Interior timing fixture',
  startMs: 0, endMs: 2 * minute, uncertaintyMs: 2 * minute,
  from: { alongNm: 0, crossNm: -1 }, to: { alongNm: 0, crossNm: 1 }
};
const interiorWorst = scheduledFerryWorstCpaAt(0,
  { alongNm: -0.75, crossNm: 0, alongKt: 30, crossKt: 0 }, [interiorTimingTrip], 4 * minute);
assert.ok(Math.abs(interiorWorst.timingShiftMs - 30 * 1000) <= FERRY_TIMING_SWEEP_STEP_MS,
  `interior timing shift should be worst, got ${interiorWorst.timingShiftMs}ms`);

function series(value, start = 0, end = 4 * hour) {
  return [{ startMs: start, endMs: end, value }];
}
function syntheticCrossing(id, startMs, alongNm, fromCrossNm, toCrossNm) {
  return {
    id, scheduleId: 'test', operator: 'test', routeName: 'Test ferry crossing',
    sourceUrl: 'https://example.test', snapshotDate: FERRY_SCHEDULE_SNAPSHOT_DATE,
    uncertaintyMs: FERRY_SCHEDULE_UNCERTAINTY_MS,
    startMs, endMs: startMs + 4 * minute,
    from: { alongNm, crossNm: fromCrossNm }, to: { alongNm, crossNm: toCrossNm },
    fromName: 'west', toName: 'east'
  };
}

const departureMs = 0;
const returnMs = 180 * minute;
const directNoTraffic = computeSailSim(departureMs, returnMs, [{ ms: 0, v: 0 }],
  series(270), series(13), 5, { initialHeading: 'N' }, false, 6, []);
assert.equal(directNoTraffic.path.some(p => p.trafficAction), false);
assert.equal(directNoTraffic.path.some(p => p.maneuver), false);
assert.ok(Math.max(...directNoTraffic.path.map(p => Math.abs(p.crossNm))) < 0.03);

// Dense weekday service must remain a finite deterministic solve rather than deadlocking on
// overlapping trips. This also exercises real New York wall times through the full solver.
const officialTrafficSim = computeSailSim(wednesdayStart, wednesdayStart + 3 * hour,
  [{ ms: wednesdayStart, v: 0 }], series(270, wednesdayStart, wednesdayStart + 4 * hour),
  series(13, wednesdayStart, wednesdayStart + 4 * hour), 5, { initialHeading: 'N' }, false, 6, weekdayTrips);
assert.ok(officialTrafficSim && officialTrafficSim.path.length > 2);
assert.ok(officialTrafficSim.path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.crossNm)));
assert.equal(officialTrafficSim.converged, true,
  `dense official schedule should still solve a true 2D return; miss ${officialTrafficSim.turnErrNm} nm`);
assert.ok(officialTrafficSim.arrivalMs <= officialTrafficSim.arriveByMs,
  'the final approach must finish before the 15-minute reserve begins');
assert.equal(officialTrafficSim.trafficUnresolved, false,
  'dense official timetable should not silently accept an unresolved modeled clearance');
const officialArrival = officialTrafficSim.path.findLast(p => p.mode !== 'moored' && p.mode !== 'overdue');
assert.equal(officialArrival.lat, PIER25.lat);
assert.equal(officialArrival.crossNm, 0);
assert.equal(officialTrafficSim.path.at(-1).crossNm, 0,
  'official-schedule moored tail must stay at Pier 25');
if (officialTrafficSim.arrivalMs < officialTrafficSim.returnMs) {
  const reserveSampleMs = officialTrafficSim.arrivalMs +
    (officialTrafficSim.returnMs - officialTrafficSim.arrivalMs) / 2;
  assert.equal(sailStepAt(officialTrafficSim.path, reserveSampleMs).mode, 'moored');
  assert.equal(sailValueAt(officialTrafficSim.path, reserveSampleMs, 'sog'), 0,
    'a moored boat must report zero SOG throughout the reserve period');
}

// With overlapping official crossings, the stored encounter must identify the ferry that
// actually limits the selected alteration, not merely the baseline course's first conflict.
for (let i = 1; i < officialTrafficSim.path.length; i++) {
  const a = officialTrafficSim.path[i - 1], b = officialTrafficSim.path[i];
  if (!b.trafficAction) continue;
  const dtHours = (b.ms - a.ms) / 3600000;
  if (!(dtHours > 0)) continue;
  const limitingRisk = scheduledFerryWorstCpaAt(a.ms, {
    alongNm: (a.lat - PIER25.lat) * NM_PER_DEG_LAT,
    crossNm: a.crossNm,
    alongKt: ((b.lat - a.lat) * NM_PER_DEG_LAT) / dtHours,
    crossKt: (b.crossNm - a.crossNm) / dtHours
  }, weekdayTrips, FERRY_CPA_LOOKAHEAD_MS);
  assert.equal(b.ferryEncounterId, limitingRisk && limitingRisk.trip.id,
    'yield metadata must follow the selected maneuver’s globally limiting ferry');
  assert.equal(b.trafficTimingShiftMs, limitingRisk && limitingRisk.timingShiftMs);
}

// Put a ferry across the boat's predicted half-hour position. The simulator must create a
// real pass-astern yield (alteration or slowdown), not a fake tack/jibe marker.
const crossing = syntheticCrossing('crossing-1', 27 * minute, 0.72, -0.8, 0.8);
const withTraffic = computeSailSim(departureMs, returnMs, [{ ms: 0, v: 0 }],
  series(270), series(13), 5, { initialHeading: 'N' }, false, 6, [crossing]);
const yields = withTraffic.path.filter(p => p.trafficAction === 'yield-astern');
assert.ok(yields.length >= 2, 'yield hysteresis should persist beyond one sample');
assert.equal(yields.some(p => p.maneuver), false, 'traffic avoidance is not a sailing tack/jibe');
assert.ok(yields.some(p => Math.abs(p.lateralKt) > 0.05 || p.vmg < directNoTraffic.path.find(q => q.ms === p.ms).vmg * 0.8),
  'the operational yield must change course or slow the boat');

// Traffic is inside the same integrator used by the root solver, so it changes the solved
// turn and/or range rather than being painted over a traffic-blind result afterward.
assert.ok(Math.abs(withTraffic.turnMs - directNoTraffic.turnMs) >= 1000 ||
  Math.abs(withTraffic.furthestDistNm - directNoTraffic.furthestDistNm) > 0.01,
  'scheduled traffic must affect the solved round trip');

// Fixed-frame cross velocity must survive the course reversal. An eastbound ferry's stern
// is to the west, so a southbound boat that can alter should still show west-negative
// lateral motion rather than mirroring the CPA/yield geometry on the inbound bearing.
const southboundCrossing = syntheticCrossing('crossing-south', 27 * minute, -0.72, -0.8, 0.8);
const southboundTraffic = computeSailSim(departureMs, returnMs, [{ ms: 0, v: 0 }],
  series(270), series(13), 5, { initialHeading: 'S' }, false, 6, [southboundCrossing]);
const southboundYields = southboundTraffic.path.filter(p => p.trafficAction === 'yield-astern');
assert.ok(southboundYields.length >= 2, 'southbound CPA should detect the same physical crossing');
assert.ok(southboundYields.every(p => p.lateralKt <= 1e-9),
  'a southbound response must never mirror the requested west-negative pass-astern side');

// Every actually integrated yield segment must preserve the conservative 0.20 nm modeled
// clearance over the complete ±2-minute timing interval, not just at minute endpoints.
for (let i = 1; i < withTraffic.path.length; i++) {
  const a = withTraffic.path[i - 1], b = withTraffic.path[i];
  if (!b.trafficAction || b.ferryEncounterId !== crossing.id) continue;
  const dtHours = (b.ms - a.ms) / 3600000;
  const risk = scheduledFerryWorstCpaAt(a.ms, {
    alongNm: (a.lat - PIER25.lat) * NM_PER_DEG_LAT,
    crossNm: a.crossNm,
    alongKt: ((b.lat - a.lat) * NM_PER_DEG_LAT) / dtHours,
    crossKt: (b.crossNm - a.crossNm) / dtHours
  }, [crossing], b.ms - a.ms);
  assert.ok(!risk || risk.conservativeDistanceNm >= FERRY_CPA_LIMIT_NM,
    `integrated yield segment violated modeled CPA: ${risk && risk.conservativeDistanceNm}`);
}
assert.equal(withTraffic.trafficUnresolved, yields.some(p => p.trafficValidated === false));

// Crossing the Pier 25 latitude well off the centerline is not an arrival and must never be
// captured. A genuine entry into the harbor-scale mooring circle resolves at Pier 25.
const offCenter = pathUntilHome([
  { ms: 0, lat: PIER25.lat + 0.01, crossNm: 0.25 },
  { ms: minute, lat: PIER25.lat, crossNm: 0.24 },
  { ms: 2 * minute, lat: PIER25.lat - 0.01, crossNm: 0.23 }
], PIER25.lat, 0, SAIL_HOME_TOLERANCE_NM);
assert.equal(offCenter.hit, null);
const acceptedArrival = withTraffic.path.findLast(p => p.mode !== 'moored' && p.mode !== 'overdue');
if (withTraffic.converged) {
  const alongErr = (acceptedArrival.lat - PIER25.lat) * NM_PER_DEG_LAT;
  assert.equal(alongErr, 0, 'accepted harbor-scale arrival must render at the Pier 25 mooring');
  assert.equal(acceptedArrival.crossNm, 0, 'accepted harbor-scale arrival must end on the mooring centerline');
  assert.equal(acceptedArrival.mode, 'docking');
  const approachStart = withTraffic.path[withTraffic.path.indexOf(acceptedArrival) - 1];
  const approachDistance = Math.hypot((approachStart.lat - PIER25.lat) * NM_PER_DEG_LAT, approachStart.crossNm);
  assert.ok(approachDistance > 0 && approachDistance <= SAIL_HOME_TOLERANCE_NM + 1e-9,
    'the timed final approach must start from the integrated mooring-circle capture');
  assert.ok(acceptedArrival.ms > approachStart.ms, 'the final approach must consume real time');
  assert.ok(withTraffic.arrivalMs <= withTraffic.arriveByMs,
    'the final approach must not consume the return reserve');
  const tail = withTraffic.path.at(-1);
  assert.equal(tail.crossNm, 0, 'moored tail must remain at Pier 25');
}

assert.match(html, /Scheduled ferry estimate/);
assert.match(html, /not live AIS/);
assert.match(html, /HobokenNJTT-WFCRoute\.aspx/);
assert.match(html, /Hoboken14th-WFCRoute\.aspx/);

if (!process.env.FLOATPLAN_FERRY_TZ_CHILD) {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: 'UTC', FLOATPLAN_FERRY_TZ_CHILD: '1' }, stdio: 'pipe'
  });
}

console.log('ferry traffic assertions passed');
