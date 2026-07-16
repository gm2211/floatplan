import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = html.indexOf('function formatSailEventDelta');
const helperEnd = html.indexOf('function updateTwilightCountdowns');
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'twilight sail-delta helpers must be present');
(0, eval)(html.slice(helperStart, helperEnd));

const minute = 60000;
const sunset = Date.UTC(2026, 6, 16, 0, 25);

assert.deepEqual(twilightSailDelta(sunset - 205 * minute, sunset - 25 * minute, sunset), {
  startText: 'Start 3h 25m before',
  backText: 'Back 25m before',
  backAfter: false,
  ariaLabel: 'Sail versus sunset. Start 3h 25m before. Back 25m before.'
});

assert.deepEqual(twilightSailDelta(sunset - 180 * minute, sunset + 15 * minute, sunset), {
  startText: 'Start 3h before',
  backText: 'Back 15m after',
  backAfter: true,
  ariaLabel: 'Sail versus sunset. Start 3h before. Back 15m after.'
});

assert.equal(twilightSailDelta(sunset - 60 * minute, sunset, sunset).backText, 'Back at sunset');
assert.equal(formatSailEventDelta('Start', sunset - 26 * 60 * minute, sunset, 'sunset'), 'Start 1d 2h before');
assert.equal(twilightSailDelta(NaN, sunset, sunset), null);
assert.equal(twilightSailDelta(sunset, sunset - minute, sunset), null);

assert.match(html, /id="twilightSunsetSailDelta"[^>]*aria-live="polite"/);
assert.match(html, /id="twilightSailStartDelta"/);
assert.match(html, /id="twilightSailBackDelta"/);
assert.match(html, /var sailDelta = twilightSailDelta\(departureMs, returnMs, t\.sunsetMs\)/);
assert.match(html, /classList\.toggle\('after', !!sailDelta && sailDelta\.backAfter\)/);
assert.match(html, /twilightSunsetRelative/,
  'the existing live sunset countdown must remain alongside the plan comparison');

console.log('Twilight sail-window delta assertions passed');
