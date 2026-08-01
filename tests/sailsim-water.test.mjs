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

// (c) The repeating stroke template is deterministic and includes one offscreen row at each
// end. Wall-clock motion lives in phasePx, not in per-stroke positions, so a full rebuild and
// the idle animation loop share the same origin without double-moving the texture.
const a = sailWaterStrokes(1.4, 14, 232, 5000000, false);
const bAgain = sailWaterStrokes(1.4, 14, 232, 5000000, false);
assert.deepEqual(a, bAgain, 'identical (curKt, nowMs) inputs must render identical stroke positions');
assert.equal(a.dashes.length, 14, 'five visible rows plus two seam rows stay sparse');
assert.equal(new Set(a.dashes.map(d => d.col)).size, 2, 'the water field is laid out in exactly two columns');

// Consecutive wall-clock instants advance only the group phase. The texture itself stays
// periodic, allowing the modulo seam to reset without a visible pop.
const later = sailWaterStrokes(1.4, 14, 232, 5000000 + 2000, false);
assert.deepEqual(a.dashes, later.dashes, 'wall-clock time must not relayout individual marks');
assert.notEqual(a.phasePx, later.phasePx, 'the field must still drift over wall-clock time');

// Flood (curKt >= 0) drifts up-river, i.e. screen-up, so it must carry a negative signed
// rate; ebb is the reciprocal, screen-down, positive rate.
assert.ok(a.pxPerSec < 0, 'flood must carry a negative (screen-up) drift rate');
const ebbField = sailWaterStrokes(-1.4, 14, 232, 5000000, false);
assert.ok(ebbField.pxPerSec > 0, 'ebb must carry a positive (screen-down) drift rate');

// Motion is intentionally calm. A representative 0.6 kt flood takes about four minutes
// to advance one row, while the weakest directional flow remains barely visible and extremes
// are capped. Values below 0.1 kt are slack and tested separately below.
const weakField = sailWaterStrokes(0.1, 14, 232, 5000000, false);
assert.ok(Math.abs(weakField.pxPerSec) >= 0.12, 'weak directional current remains visibly alive');
const harborField = sailWaterStrokes(0.6, 14, 232, 5000000, false);
assert.ok(harborField.cycleLen / Math.abs(harborField.pxPerSec) > 240,
  '0.6 kt harbor current must take about four minutes to advance one row');
const strongField = sailWaterStrokes(20, 14, 232, 5000000, false);
assert.ok(Math.abs(strongField.pxPerSec) <= 0.5, 'a very strong current must clamp to the calm maximum drift speed');

// Changing current speed during simulator playback must integrate from the prior phase,
// not multiply the new speed by the absolute wall clock and teleport the texture.
sailWaterAnim.phasePx = 0;
sailWaterAnim.lastMs = null;
sailWaterAnim.pxPerSec = 0;
assert.equal(sailWaterContinuousPhase(0.6, 1000000, 232), 0);
const changedSpeedPhase = sailWaterContinuousPhase(0.9, 1002000, 232);
assert.ok(Math.abs(changedSpeedPhase + 0.384) < 1e-9,
  'two elapsed seconds use the prior 0.6 kt rate continuously');
assert.ok(Math.abs(changedSpeedPhase) < 1,
  'a routine current-speed update cannot jump by a large fraction of a row');

const slackSvg = sailWaterGroupSvg(0, 56, 190, 14, 232, 1000000, false);
assert.match(slackSvg, /class="sailsim-water"/);
assert.match(slackSvg, /stroke="var\(--ink-dim\)"/);
assert.doesNotMatch(slackSvg, /data-water-anim/, 'slack water renders a static texture without an idle loop');
[-0.099, 0.099].forEach(v => {
  const nearSlack = sailWaterGroupSvg(v, 56, 190, 14, 232, 1000000, false);
  assert.match(nearSlack, /stroke="var\(--ink-dim\)"/);
  assert.doesNotMatch(nearSlack, /data-water-anim/);
});
assert.match(sailWaterGroupSvg(0.1, 56, 190, 14, 232, 1000000, false), /stroke="var\(--flood\)"/);
assert.match(sailWaterGroupSvg(-0.1, 56, 190, 14, 232, 1000000, false), /stroke="var\(--ebb\)"/);

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
assert.match(floodSvg, /data-origin-phase="/);
assert.match(floodSvg, /data-px-per-sec="/);
assert.match(floodSvg, /data-cycle-len="/);

// (f) Each stroke is a short vertical wavy squiggle, not a horizontal dash: a <path> built from
// two quadratic arcs (one bowing right, one bowing left) descending from the stroke's anchor
// point, tall enough to read as a ripple (vertical extent clearly greater than lateral sway),
// and never a bare <line>.
assert.doesNotMatch(floodSvg, /<line/, 'water strokes must no longer be horizontal <line> dashes');
const pathMatches = [...floodSvg.matchAll(/<path d="([^"]+)"\/>/g)];
assert.equal(pathMatches.length, a.dashes.length, 'one <path> squiggle per stroke');
const samplePath = pathMatches[0][1];
assert.match(samplePath, /^M-?[\d.]+,-?[\d.]+ q-?[\d.]+,[\d.]+ 0,[\d.]+ q-?[\d.]+,[\d.]+ 0,[\d.]+$/,
  'squiggle path must be two quadratic arcs (q) with zero horizontal endpoint delta, alternating control-point sign');
const qSegs = [...samplePath.matchAll(/q(-?[\d.]+),(-?[\d.]+) 0,([\d.]+)/g)];
assert.equal(qSegs.length, 2, 'squiggle must have exactly two quadratic arch segments');
assert.ok(Math.sign(Number(qSegs[0][1])) !== Math.sign(Number(qSegs[1][1])), 'the two arches must bow in opposite lateral directions');
const totalVertical = qSegs.reduce((sum, m) => sum + Number(m[3]), 0);
const lateralAmp = Math.abs(Number(qSegs[0][1]));
assert.ok(totalVertical > lateralAmp, 'the squiggle must read as vertical, i.e. its vertical extent exceeds its lateral amplitude');
assert.ok(totalVertical >= 8 && totalVertical <= 12, 'squiggle should be roughly 10px tall');
assert.ok(lateralAmp >= 1 && lateralAmp <= 2, 'squiggle lateral amplitude should stay restrained');

// sailWaterSquigglePath is a pure, deterministic builder: same (cx, topY) always yields the
// same path string, and it never calls Math.random() to do it.
assert.equal(sailWaterSquigglePath(100, 20), sailWaterSquigglePath(100, 20));
assert.doesNotMatch(html.slice(start, end), /Math\.random\(/);

// Stroke height must stay under the per-row cycle length so a squiggle drifting within its own
// band never overlaps a neighboring stroke in the same column.
const cycleLen = a.cycleLen;
assert.ok(totalVertical < cycleLen, 'squiggle height must be less than the row cycle length to avoid overlap');

// The idle rAF loop itself: one global instance, guarded to the water group's own attributes,
// never touching anything else.
assert.match(html, /var sailWaterAnim = \{ rafId: null, phasePx: 0, lastMs: null, pxPerSec: 0 \}/);
assert.match(html, /sailWaterContinuousPhase\(curKt, waterRenderMs, innerH\)/,
  'production rendering must use continuous integrated phase rather than absolute-clock phase');
assert.match(html, /function sailWaterAnimGroupEl\(\)/);
assert.match(html, /function ensureSailWaterAnimLoop\(\)/);
assert.match(html, /wrap\.querySelector\('\.sailsim-water\[data-water-anim\]'\)/);
assert.match(html, /if \(sailWaterAnim\.rafId != null\) return;/, 'the idle loop must guard to a single global instance');
assert.match(html, /originPhase \+ elapsedSec \* pxPerSec/,
  'the first idle frame must continue from the render phase instead of snapping to zero');
assert.doesNotMatch(html.slice(html.indexOf('function sailWaterAnimTick'), html.indexOf('function ensureSailWaterAnimLoop')), /properMod/,
  'signed flood motion must not be converted into a nearly full-cycle positive jump');
assert.match(html, /ensureSailWaterAnimLoop\(\);/);

console.log('Sail-sim water field assertions passed');
