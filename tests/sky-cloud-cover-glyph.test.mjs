import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* ============================== Markup ============================== */
// The chip used to read "Sky", which sat next to a "Precip" chip showing a percentage — so the
// sky percentage was easy to misread as a second precipitation number. The label now names the
// quantity outright.

const chipRowStart = html.indexOf('<div class="chip-row weather-chip-row" id="weatherChipRow">');
assert.ok(chipRowStart >= 0, 'weatherChipRow not found');
const chipRowEnd = html.indexOf('</div>', chipRowStart);
assert.ok(chipRowEnd > chipRowStart, 'weatherChipRow closing tag not found');
const chipRowHtml = html.slice(chipRowStart, chipRowEnd);

assert.ok(chipRowHtml.includes('<button type="button" class="chip" data-chip="sky">Cloud cover</button>'),
  'the sky chip must be labelled "Cloud cover"');
assert.ok(!/data-chip="sky">Sky</.test(chipRowHtml),
  'the bare "Sky" chip label must be gone');

/* ============================== Glyph geometry ============================== */
// Node has no DOM, but skyGlyphSvg is pure string building — eval the production source slice
// and assert on the markup it returns, same pattern as the other string-slicing tests.

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return html.slice(start, end);
}

const clampSrc = 'function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }';
assert.ok(html.includes(clampSrc), 'clamp source line not found');
(0, eval)(clampSrc);
(0, eval)(sliceBetween('function skyGlyphSvg(pct) {', '\nfunction weatherMetricCellHtml'));

// The outline ring is always present, whatever the cover.
[null, 0, 15, 25, 50, 99, 100].forEach((pct) => {
  assert.ok(skyGlyphSvg(pct).includes('<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor"'),
    `ring missing at pct=${pct}`);
});

// No translucent wash anywhere — that is the whole point of the change. A 15% hour and a 25%
// hour both rendered as an apparently empty ring under fill-opacity.
[null, 0, 15, 25, 50, 99, 100].forEach((pct) => {
  assert.ok(!skyGlyphSvg(pct).includes('fill-opacity'),
    `fill-opacity must not be used (pct=${pct})`);
});

// Clear sky and missing data draw the ring alone.
assert.ok(!skyGlyphSvg(null).includes('<path'), 'null cover must not draw a wedge');
assert.ok(!skyGlyphSvg(null).includes('fill="currentColor"'), 'null cover must draw no fill');
assert.ok(!skyGlyphSvg(0).includes('<path'), '0% cover must not draw a wedge');

// Overcast degenerates as an arc (start point == end point), so it must draw as a full disc.
assert.ok(skyGlyphSvg(100).includes('<circle cx="8" cy="8" r="6.4" fill="currentColor"/>'),
  '100% cover must draw a solid disc, not an arc');
assert.ok(!skyGlyphSvg(100).includes('<path'), '100% cover must not draw a wedge path');

// Partial cover: a wedge swept clockwise from 12 o'clock, at full opacity.
function wedgePath(pct) {
  const m = /<path d="([^"]+)" fill="currentColor"\/>/.exec(skyGlyphSvg(pct));
  assert.ok(m, `expected a wedge path at pct=${pct}`);
  return m[1];
}

// Every wedge starts at the centre and runs out to the top of the circle before arcing.
[15, 25, 50, 75, 99].forEach((pct) => {
  assert.ok(wedgePath(pct).startsWith('M8 8 L8 1.60 A6.4 6.4 0 '),
    `wedge at pct=${pct} must start at the centre and sweep from 12 o'clock`);
  assert.ok(wedgePath(pct).endsWith(' Z'), `wedge at pct=${pct} must be closed`);
});

// Sweep direction is clockwise (sweep-flag 1) and the large-arc flag flips past the halfway mark.
assert.ok(wedgePath(25).includes(' 0 0 1 '), '25% must use the small-arc, clockwise flags');
assert.ok(wedgePath(75).includes(' 0 1 1 '), '75% must use the large-arc, clockwise flags');

// End points land where the geometry says: 25% at 3 o'clock, 50% at 6 o'clock, 75% at 9 o'clock.
assert.ok(wedgePath(25).endsWith('1 14.40 8.00 Z'), `25% must end at 3 o'clock, got ${wedgePath(25)}`);
assert.ok(wedgePath(50).endsWith('1 8.00 14.40 Z'), `50% must end at 6 o'clock, got ${wedgePath(50)}`);
assert.ok(wedgePath(75).endsWith('1 1.60 8.00 Z'), `75% must end at 9 o'clock, got ${wedgePath(75)}`);

// Out-of-range values are clamped rather than drawing a wild arc.
assert.equal(skyGlyphSvg(-20), skyGlyphSvg(0), 'negative cover must clamp to 0%');
assert.equal(skyGlyphSvg(140), skyGlyphSvg(100), 'cover above 100 must clamp to 100%');

// The fill is drawn before the ring so the outline stays crisp on top of it.
const half = skyGlyphSvg(50);
assert.ok(half.indexOf('<path') < half.indexOf('fill="none"'),
  'the wedge must be drawn under the ring');

console.log('sky-cloud-cover-glyph: ok');
