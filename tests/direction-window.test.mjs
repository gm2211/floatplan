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

assert.match(html, /At departure: ['"] \+ rec\.stateDep/);
assert.match(html, /var curState = rec\.stateDep/);
assert.doesNotMatch(html.slice(start, end), /nowMs|stateNow|vNow/);

console.log('Direction sail-window assertions passed');
