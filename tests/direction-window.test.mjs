import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function computeDirectionRec');
const end = html.indexOf('/* ============================== Sail simulator physics', start);
assert.ok(start >= 0 && end > start, 'direction recommendation block not found');

globalThis.round1 = value => Math.round(value * 10) / 10;
globalThis.fmtTime = ms => String(ms);
globalThis.classifyCurrent = value => Math.abs(value) < 0.1 ? 'slack' : (value > 0 ? 'flood' : 'ebb');
globalThis.currentVelocityAt = (points, atMs) => points.find(point => point.ms === atMs)?.v ?? null;
globalThis.currentCurveBounds = points => points?.length ? {
  minMs: Math.min(...points.map(point => point.ms)),
  maxMs: Math.max(...points.map(point => point.ms))
} : null;
globalThis.currentVelocityWithinCoverage = (points, atMs) => {
  const bounds = globalThis.currentCurveBounds(points);
  return bounds && atMs >= bounds.minMs && atMs <= bounds.maxMs
    ? globalThis.currentVelocityAt(points, atMs)
    : null;
};
globalThis.currentCurveCoversWindow = (points, startMs, endMs) => {
  const bounds = globalThis.currentCurveBounds(points);
  return !!bounds && bounds.minMs <= startMs && bounds.maxMs >= endMs;
};
globalThis.slackTimingCoversWindow = (events, startMs, endMs) =>
  events.some(event => event.ms >= startMs && event.ms <= endMs + 12 * 3600000);
(0, eval)(html.slice(start, end));

const departureMs = 100;
const returnMs = 300;
const curve = [
  { ms: departureMs, v: -2 },
  { ms: 200, v: -1 },
  { ms: returnMs, v: -0.5 },
  // Deliberately opposite to departure: a wall-clock lookup must not reach this value.
  { ms: 400, v: 0.8 }
];
const events = [
  { ms: 50, type: 'slack', v: 0 },
  { ms: 75, type: 'flood', v: 1.4 },
  { ms: 150, type: 'slack', v: 0 },
  { ms: 250, type: 'ebb', v: -2.2 }
];
const rec = computeDirectionRec(curve, events, departureMs, returnMs);

assert.equal(rec.stateDep, 'ebb');
assert.equal(rec.vDep, -2);
assert.equal(rec.nextSlack.ms, 150, 'next slack must be selected relative to sail departure');
assert.equal(rec.nextMax.ms, 250, 'next max must be selected relative to sail departure');
assert.equal('stateNow' in rec, false, 'direction recommendation must not expose wall-clock current state');
assert.equal('vNow' in rec, false, 'direction recommendation must not expose wall-clock current speed');

const withoutTiming = computeDirectionRec(curve, [], departureMs, returnMs);
assert.equal(withoutTiming.unavailable, undefined, 'a complete curve remains route-capable without MAX_SLACK');
assert.equal(withoutTiming.initialHeading, 'N');
assert.equal(withoutTiming.slackTimingAvailable, false);

const staleTiming = computeDirectionRec(curve, [{ ms: departureMs - 86400000, type: 'slack', v: 0 }], departureMs, returnMs);
assert.equal(staleTiming.slackTimingAvailable, false, 'cached timing from another sail date is not usable');
assert.equal(staleTiming.initialHeading, 'N', 'stale optional timing does not blank a valid curve recommendation');

const partial = computeDirectionRec(curve.slice(0, 2), [], departureMs, returnMs);
assert.equal(partial.unavailable, true, 'an incomplete curve cannot drive a heading');
assert.equal(partial.partial, true, 'departure facts remain available from an in-range point');
assert.equal(partial.initialHeading, null);
assert.equal(partial.vDep, -2);

const outside = computeDirectionRec(curve.slice(1, 3), [], departureMs, returnMs);
assert.equal(outside.unavailable, true);
assert.equal(outside.partial, false, 'out-of-window cached points must not be extrapolated to departure');
assert.equal(outside.vDep, null);

assert.match(html, /At departure: ['"] \+ rec\.stateDep/);
assert.match(html, /var curState = rec\.stateDep/);
assert.doesNotMatch(html.slice(start, end), /nowMs|stateNow|vNow/);
assert.match(html, /function prefixedErrorMessage\(prefix, err\)/);
assert.doesNotMatch(html, /showCardError\('directionError'/);
assert.match(html, /Slack timing unavailable/);
assert.match(html, /currentVelocityWithinCoverage\(curvePoints, departureMs\)/);

console.log('Direction sail-window assertions passed');
