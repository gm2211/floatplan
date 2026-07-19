import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Pure, DOM-free helpers: layout + SVG string builder for the channel's animated water field.
const start = html.indexOf('var SAIL_WATER_ROWS');
const end = html.indexOf('function renderSailSimSvg', start);
assert.ok(start >= 0 && end > start, 'sail water helpers not found');

globalThis.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
(0, eval)(html.slice(start, end));

// (a) The water group is clipped to the shared channel clip path and colored by flood/ebb.
const floodSvg = sailWaterGroupSvg(1.4, 56, 190, 14, 232, 1000000, false);
assert.match(floodSvg, /class="sailsim-water"/);
assert.match(floodSvg, /clip-path="url\(#sailSimChannelClip\)"/);
assert.match(floodSvg, /stroke="var\(--flood\)"/);
const ebbSvg = sailWaterGroupSvg(-1.4, 56, 190, 14, 232, 1000000, false);
assert.match(ebbSvg, /class="sailsim-water"/);
assert.match(ebbSvg, /stroke="var\(--ebb\)"/);

// (b) Null/NaN current means there is nothing local to animate — no water group at all.
assert.equal(sailWaterGroupSvg(null, 56, 190, 14, 232, 1000000, false), '');
assert.equal(sailWaterStrokes(null, 14, 232, 1000000, false), null);
assert.equal(sailWaterStrokes(NaN, 14, 232, 1000000, false), null);

// (c) Stroke positions are a pure function of (curKt, nowMs) — deterministic, not Math.random
// — and a sparse 8-14 dash field laid out in exactly two columns, per spec.
const a = sailWaterStrokes(1.4, 14, 232, 5000000, false);
const bAgain = sailWaterStrokes(1.4, 14, 232, 5000000, false);
assert.deepEqual(a, bAgain, 'identical (curKt, nowMs) inputs must render identical dash positions');
assert.ok(a.dashes.length >= 8 && a.dashes.length <= 14, 'spec calls for a sparse 8-14 dash field');
assert.equal(new Set(a.dashes.map(d => d.col)).size, 2, 'the water field is laid out in exactly two columns');

// Consecutive wall-clock instants must actually keep drifting, so consecutive SVG rebuilds
// during playback show continuous motion rather than a frozen frame.
const later = sailWaterStrokes(1.4, 14, 232, 5000000 + 2000, false);
assert.notDeepEqual(a.dashes, later.dashes, 'the field must visibly drift over wall-clock time');

// Flood (curKt >= 0) drifts up-river, i.e. screen-up, so it must carry a negative signed
// rate; ebb is the reciprocal, screen-down, positive rate.
assert.ok(a.pxPerSec < 0, 'flood must carry a negative (screen-up) drift rate');
const ebbField = sailWaterStrokes(-1.4, 14, 232, 5000000, false);
assert.ok(ebbField.pxPerSec > 0, 'ebb must carry a positive (screen-down) drift rate');

// A weak but nonzero current must still clamp to a subtle, non-zero drift speed rather than
// vanishing to a dead stop.
const weakField = sailWaterStrokes(0.01, 14, 232, 5000000, false);
assert.ok(Math.abs(weakField.pxPerSec) >= 2, 'even a very weak current must clamp to the subtle minimum drift speed');
const strongField = sailWaterStrokes(20, 14, 232, 5000000, false);
assert.ok(Math.abs(strongField.pxPerSec) <= 9, 'a very strong current must clamp to the subtle maximum drift speed');

// (d) The WIND and CURRENT captions exist near their respective vectors.
assert.match(html, /class="sailsim-wind-caption"[^>]*>WIND</);
assert.match(html, /class="sailsim-current-caption"[^>]*>CURRENT</);

// (e) Reduced motion yields a static group: no rAF hook attribute, and the wall clock is
// ignored entirely (two different instants render identically).
const reducedSvg = sailWaterGroupSvg(1.4, 56, 190, 14, 232, 1000000, true);
assert.match(reducedSvg, /class="sailsim-water"/);
assert.doesNotMatch(reducedSvg, /data-water-anim/);
const reducedA = sailWaterStrokes(1.4, 14, 232, 1000000, true);
const reducedB = sailWaterStrokes(1.4, 14, 232, 9999999, true);
assert.deepEqual(reducedA, reducedB, 'reduced motion must ignore the wall clock entirely');

// Motion-enabled renders expose the drift rate/render timestamp the standalone idle rAF loop
// depends on; reduced motion must omit that hook rather than merely freezing its values.
assert.match(floodSvg, /data-water-anim="1"/);
assert.match(floodSvg, /data-render-ms="/);
assert.match(floodSvg, /data-px-per-sec="/);
assert.match(floodSvg, /data-cycle-len="/);

// The idle rAF loop itself: one global instance, guarded to the water group's own attributes,
// never touching anything else.
assert.match(html, /var sailWaterAnim = \{ rafId: null \}/);
assert.match(html, /function sailWaterAnimGroupEl\(\)/);
assert.match(html, /function ensureSailWaterAnimLoop\(\)/);
assert.match(html, /wrap\.querySelector\('\.sailsim-water\[data-water-anim\]'\)/);
assert.match(html, /if \(sailWaterAnim\.rafId != null\) return;/, 'the idle loop must guard to a single global instance');
assert.match(html, /ensureSailWaterAnimLoop\(\);/);

console.log('Sail-sim water field assertions passed');
