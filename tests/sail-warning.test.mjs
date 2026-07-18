import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function formatSailMissNm');
const end = html.indexOf('function showSailSimUnavailable', start);
assert.ok(start >= 0 && end > start, 'sail miss warning helpers not found');

globalThis.round1 = value => Math.round(value * 10) / 10;
globalThis.fmtTime = ms => ms === 1 ? '3:45 AM' : '4:00 AM';
(0, eval)(html.slice(start, end));

assert.equal(formatSailMissNm(0.126), '0.13', 'near-threshold misses need hundredth-mile precision');
assert.equal(formatSailMissNm(0.12), '0.12');
assert.equal(formatSailMissNm(3.34), '3.3');

const warning = sailSimMissWarning({ turnErrNm: 0.126, arriveByMs: 1, returnMs: 2 });
assert.equal(warning,
  'No computed route is moored by 3:45 AM (15-minute reserve). At 4:00 AM, this track ends 0.13 nm from Pier 25. Allow more time or shift departure.');
assert.doesNotMatch(warning, /unsafe/i, 'a planning approximation must not claim a safety verdict');
assert.doesNotMatch(warning, /closest/i, 'endpoint distance must not be mislabeled as closest approach');
assert.doesNotMatch(html, /Unsafe plan: the closest computed attempt/);

console.log('Sail warning assertions passed');
