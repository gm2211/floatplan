import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const savedStart = html.indexOf('var SAVED_SAIL_WINDOW_GRACE_MS');
const savedEnd = html.indexOf('// NOAA CO-OPS', savedStart);
assert.ok(savedStart >= 0 && savedEnd > savedStart, 'saved-window guard not found');
(0, eval)(html.slice(savedStart, savedEnd));

const hour = 3600000;
const nowMs = 24 * hour;
assert.equal(savedSailWindowIsUsable(15 * hour, 3, nowMs), true,
  'a sail that ended exactly six hours ago remains available for review');
assert.equal(savedSailWindowIsUsable(14 * hour + 59 * 60000, 3, nowMs), false,
  'an older saved sail resets before its forecast disappears');
assert.equal(savedSailWindowIsUsable(NaN, 3, nowMs), false);

globalThis.nearestSeriesValue = (series, atMs) => {
  const exact = series.find(p => atMs >= p.startMs && atMs < p.endMs);
  return exact ? exact.value : null;
};
const coverageStart = html.indexOf('function sailWindowHasWindCoverage');
const coverageEnd = html.indexOf('function setupSailSimControls', coverageStart);
assert.ok(coverageStart >= 0 && coverageEnd > coverageStart, 'wind coverage guard not found');
(0, eval)(html.slice(coverageStart, coverageEnd));

const direction = [{ startMs: 0, endMs: 3 * hour, value: 270 }];
const speed = [{ startMs: 0, endMs: 3 * hour, value: 12 }];
assert.equal(sailWindowHasWindCoverage(direction, speed, 0, 3 * hour), true);
assert.equal(sailWindowHasWindCoverage(direction, [], 0, 3 * hour), false);
assert.equal(sailWindowHasWindCoverage(direction, [{ startMs: 0, endMs: 2 * hour, value: 12 }], 0, 3 * hour), false,
  'partial wind coverage must not render a current-only tail as sailing');

assert.match(html, /restoredExpiredWindow[\s\S]*savedSailWindowIsUsable/);
assert.match(html, /if \(restoredExpiredWindow\) persistDurationPlan\(\)/);
assert.match(html, /NWS wind forecast unavailable for this sail window/);

console.log('Expired sail-window assertions passed');
