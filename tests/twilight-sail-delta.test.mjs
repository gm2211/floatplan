import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = html.indexOf('function formatTwilightToSailEnd');
const helperEnd = html.indexOf('function updateTwilightCountdowns');
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'twilight sail-delta helpers must be present');
(0, eval)(html.slice(helperStart, helperEnd));

const minute = 60000;
const sunset = Date.UTC(2026, 6, 16, 0, 25);

assert.deepEqual(formatTwilightToSailEnd(sunset, sunset - 25 * minute), {
  text: '25m after sail end',
  before: false
});
assert.deepEqual(formatTwilightToSailEnd(sunset, sunset + 15 * minute), {
  text: '15m before sail end',
  before: true
});
assert.deepEqual(formatTwilightToSailEnd(sunset, sunset), { text: 'at sail end', before: false });
assert.equal(formatTwilightToSailEnd(sunset, sunset + 26 * 60 * minute).text, '1d 2h before sail end');
assert.equal(formatTwilightToSailEnd(NaN, sunset), null);

assert.doesNotMatch(html, /Sail vs sunset|twilightSailStartDelta|twilightSailBackDelta/);
assert.match(html, /id="twilightSunsetSailEndDelta"/);
assert.match(html, /var sailEndDelta = formatTwilightToSailEnd\(t\.sunsetMs, returnMs\)/);
assert.match(html, /classList\.toggle\('before', !!sailEndDelta && sailEndDelta\.before\)/);
assert.match(html, /twilightSunsetRelative/,
  'the existing live sunset countdown must remain alongside the plan comparison');

console.log('Twilight sail-window delta assertions passed');
