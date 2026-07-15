import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function buildMeasuredCurrentUrl');
const end = html.indexOf('function fetchObservedScalar', start);
assert.ok(start >= 0 && end > start, 'measured-current fetcher block not found');

globalThis.STATION_KVK_CURRENT = 'n06010';
globalThis.STATION_NEWARK_CURRENT = 'n07010';
globalThis.STATION_NARROWS_CURRENT = 'n03020';
globalThis.parseNoaaGmt = (value) => Date.parse(value.replace(' ', 'T') + 'Z');
globalThis.fetchCoopsJson = async () => ({ data: [] });
(0, eval)(html.slice(start, end));

assert.match(buildMeasuredCurrentUrl('n07010'), /product=currents/);
assert.match(buildMeasuredCurrentUrl('n07010'), /station=n07010/);
assert.match(buildMeasuredCurrentUrl('n03020'), /station=n03020/);

const parsed = parseMeasuredCurrentRow({ t: '2026-07-15 05:54', s: '1.04', d: '421', b: '2' });
assert.equal(parsed.ms, Date.parse('2026-07-15T05:54:00Z'));
assert.equal(parsed.speedKt, 1.04);
assert.equal(parsed.dirDeg, 61, 'directions should normalize to 0-359 degrees');
assert.equal(parsed.bin, '2');
assert.equal(parseMeasuredCurrentRow(null), null);
assert.equal(parseMeasuredCurrentRow({ s: '***', d: '***' }), null, 'NOAA QC placeholders are unavailable, not zero');

assert.ok(html.includes('data-current-station="hudson">Hudson prediction'));
assert.ok(html.includes('data-current-station="kvk">Kill Van Kull'));
assert.ok(html.includes('data-current-station="newark">Newark Bay'));
assert.ok(html.includes('data-current-station="narrows">The Narrows'));
assert.ok(html.includes("lsSetJSON('obsCurrentStation', station)"), 'current reference choice must persist');
assert.ok(html.includes('Planning and the sail simulator always use the Hudson River Entrance prediction.'));
assert.ok(html.includes("var STATION_CURRENT = 'NYH1927'"), 'planning must remain on the Hudson prediction station');

const sourceDetails = html.match(/<details class="source-links">/g) || [];
assert.equal(sourceDetails.length, 12, 'every widget source footer should use the same collapsed disclosure');
assert.equal((html.match(/<div class="source-links">/g) || []).length, 0);

console.log('Current reference picker and source disclosure assertions passed');
