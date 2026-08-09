import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return html.slice(start, end);
}

(0, eval)([
  slice('function round1(n)', '\n'),
  slice('function fmtTime(ms, opts)', 'function fmtDateTime'),
  slice('function windowTempRangeF', 'function composeWeatherHeadline'),
  slice('function findRowForMs', 'function rowOverlapsWindow'),
  slice('function rowOverlapsWindow', '/* ======'),
  slice('function formatTwilightToSailEnd', 'function updateTwilightCountdowns'),
  slice('function verdictWeatherContext', 'function verdictPresentation')
].join('\n'));

const hour = 3600000;
// 2026-07-15, 1:00 PM America/New_York.
const departureMs = Date.UTC(2026, 6, 15, 17, 0);
const returnMs = departureMs + 3 * hour;
const sunsetMs = Date.UTC(2026, 6, 16, 0, 25);

function row(offsetHours, extra) {
  return Object.assign({
    ms: departureMs + offsetHours * hour,
    endMs: departureMs + (offsetHours + 1) * hour,
    tempF: 74, shortForecast: 'Mostly Cloudy', isThunder: false, pop: 5
  }, extra || {});
}

/* ============================== weather chip ============================== */

assert.equal(
  verdictWeatherContext([row(0), row(1, { tempF: 79 }), row(2, { tempF: 76 })], departureMs, returnMs),
  'Weather: 74–79°F, Mostly Cloudy',
  'a dry window states temperature and the conditions at departure, and stays silent about showers'
);

assert.equal(
  verdictWeatherContext([row(0), row(1, { pop: 40 })], departureMs, returnMs),
  'Weather: 74°F, Mostly Cloudy, Showers possible 2:00 PM (40%)',
  'a real precipitation chance earns the shower phrase'
);

assert.match(
  verdictWeatherContext([row(0), row(1, { pop: 45, isThunder: true })], departureMs, returnMs),
  /Thunderstorms possible/
);

// The chip describes the hour the boat casts off, not the window's worst hour — the worst
// hour already reaches the sailor through the verdict's own reason chips.
assert.equal(
  verdictWeatherContext([row(0, { shortForecast: 'Sunny' }), row(1, { shortForecast: 'Rain Showers' })], departureMs, returnMs),
  'Weather: 74°F, Sunny'
);

assert.equal(verdictWeatherContext([], departureMs, returnMs), null);
assert.equal(verdictWeatherContext(null, departureMs, returnMs), null);

/* ============================== current chip ============================== */

assert.equal(
  verdictCurrentContext({ stateDep: 'ebb', vDep: -1.24, nextSlack: { ms: departureMs + 2 * hour } }),
  'Current: ebb 1.2 kt at departure, slack 3:00 PM'
);
assert.equal(
  verdictCurrentContext({ stateDep: 'flood', vDep: 0.8, nextSlack: null }),
  'Current: flood 0.8 kt at departure'
);
assert.equal(
  verdictCurrentContext({ stateDep: 'slack', vDep: 0.02, nextSlack: null }),
  'Current: slack at departure'
);
assert.equal(verdictCurrentContext({ stateDep: 'unknown', vDep: null }), null,
  'an uncovered current curve omits the chip rather than claiming a phase');
assert.equal(verdictCurrentContext(null), null);

/* ============================== sunset chip ============================== */

assert.equal(verdictSunsetContext(sunsetMs, returnMs), 'Sunset 8:25 PM, 4h 25m after sail end');
assert.equal(verdictSunsetContext(sunsetMs, sunsetMs + 30 * 60000), 'Sunset 8:25 PM, 30m before sail end');
assert.equal(verdictSunsetContext(null, returnMs), null);
assert.equal(verdictSunsetContext(sunsetMs, null), 'Sunset 8:25 PM',
  'a missing return time still leaves the sunset time itself worth showing');

/* ============================== composition ============================== */

assert.deepEqual(composeVerdictContext({
  weatherRows: [row(0)], departureMs: departureMs, returnMs: returnMs,
  direction: { stateDep: 'ebb', vDep: -1.24, nextSlack: null }, sunsetMs: sunsetMs
}), [
  'Weather: 74°F, Mostly Cloudy',
  'Current: ebb 1.2 kt at departure',
  'Sunset 8:25 PM, 4h 25m after sail end'
]);

assert.deepEqual(composeVerdictContext({
  weatherRows: [], departureMs: departureMs, returnMs: returnMs,
  direction: { stateDep: 'unknown', vDep: null }, sunsetMs: null
}), [], 'every chip is independently droppable — no "n/a" placeholders');

assert.deepEqual(composeVerdictContext(null), []);

/* ============================== wiring ============================== */

assert.match(html, /function renderVerdict\(verdict, windowStart, windowEnd, context\)/);
assert.match(html, /li\.className = 'reason-context'/,
  'context entries must be distinguishable from verdict reasons in the DOM');
assert.match(html, /\.reason-list li\.reason-context \{ color: var\(--ink-dim\); \}/);
assert.match(html, /renderVerdict\(verdict, departureMs, returnMs, composeVerdictContext\(\{/,
  'the central recompute must feed the context into the banner');
assert.ok(
  html.indexOf('var direction = computeDirectionRec(state.curvePoints') <
    html.indexOf('renderVerdict(verdict, departureMs, returnMs, composeVerdictContext({'),
  'the direction recommendation must be computed before the verdict renders so both describe the same departure current'
);
assert.match(html, /return \{ text: label, thunder: thunder, wet: wetHours\.length > 0 \};/);

console.log('Verdict context chip assertions passed');
