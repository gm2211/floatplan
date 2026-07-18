import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = html.indexOf('function datetimeLocalMeridiem');
const helperEnd = html.indexOf('// Default departure:', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'departure meridiem helpers must be present');

globalThis.pad2 = value => String(value).padStart(2, '0');
(0, eval)(html.slice(helperStart, helperEnd));

assert.equal(datetimeLocalMeridiem('2026-07-18T00:30'), 'am');
assert.equal(datetimeLocalMeridiem('2026-07-18T12:30'), 'pm');
assert.equal(datetimeLocalMeridiem('not-a-date'), null);

assert.equal(withDatetimeLocalMeridiem('2026-07-18T00:30', 'pm'), '2026-07-18T12:30');
assert.equal(withDatetimeLocalMeridiem('2026-07-18T12:30', 'am'), '2026-07-18T00:30');
assert.equal(withDatetimeLocalMeridiem('2026-07-18T01:05', 'pm'), '2026-07-18T13:05');
assert.equal(withDatetimeLocalMeridiem('2026-07-18T23:59', 'am'), '2026-07-18T11:59');
assert.equal(withDatetimeLocalMeridiem('2026-07-18T13:05:42.500', 'pm'), '2026-07-18T13:05:42.500');
assert.equal(withDatetimeLocalMeridiem('bad', 'pm'), null);

assert.match(html, /class="meridiem-toggle" role="group" aria-label="Departure AM or PM"/);
assert.match(html, /type="button" data-meridiem="am"[^>]+aria-pressed="false"/);
assert.match(html, /type="button" data-meridiem="pm"[^>]+aria-pressed="false"/);
assert.match(html, /input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/,
  'touch selection must use the existing departure change pipeline');
assert.match(html, /addEventListener\('input', syncDepartureMeridiemControl\)/,
  'typing and native pickers must keep the touch control synchronized');

console.log('Departure meridiem touch-control assertions passed');
