import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(html, /function initChartZoom\(\)/);
assert.match(html, /CHART_ZOOM_MAX = 4/);
assert.match(html, /e\.touches\.length !== 2/);
assert.match(html, /data-chart-zoom="reset"/);
assert.match(html, /aria-label="Zoom chart in"/);
assert.match(html, /touch-action: pan-x pan-y/);
assert.match(html, /overscroll-behavior-inline: contain/);
assert.match(html, /wrap\.scrollLeft = Math\.max\(0, anchorRatio \* wrap\.scrollWidth - localX\)/);
assert.match(html, /new MutationObserver\(function \(\) \{ applyChartZoomStyle\(wrap\); \}\)/);
assert.match(html, /initChartZoom\(\);/);

// A zoomed chart's svg is `scale * 100%` wide with height:auto, so the wrap it lives in grows
// by the same factor wherever the wrap takes its height from its content (every width below the
// fit shell's 700px). Re-measuring that inflated height would bake it into the next render's
// viewBox and leave the chart stretched after zooming back out — so a re-render while zoomed
// must reuse the height the chart already has instead of measuring the wrap.
assert.match(
  html,
  /function measuredChartHeight\(wrap, fallbackH, minH\) \{[\s\S]*?if \(chartZoomScale\(wrap\) > 1\) \{[\s\S]*?vb\.height \? Math\.max\(minH, Math\.round\(vb\.height\)\) : fallbackH;/,
  'measuredChartHeight should keep the existing viewBox height while the chart is zoomed'
);

// Scrubbing a zoomed chart used to be refused outright at pointerdown, so a zoomed chart could
// not be read at all on touch. Touch now scrubs at every zoom level; what changes when zoomed is
// only that the horizontal drag is no longer hijacked, since that gesture is also the pan.
assert.doesNotMatch(
  html,
  /pointerType === 'touch' && zoomWrap/,
  'touch scrubbing should not be refused just because the chart is zoomed'
);
assert.match(html, /if \(!isChartZoomedIn\(svgEl\)\) e\.preventDefault\(\);/);
assert.match(html, /function isChartZoomedIn\(el\) \{[\s\S]*?chartZoomScale\(wrap\) > 1;/);
// The browser cancels the pointer stream the moment it takes the pan over, but the finger is
// still down: the touch drag has to end on touchend/touchcancel instead.
assert.match(html, /evName === 'pointercancel' && e\.pointerType === 'touch' && touchDragging/);
assert.match(html, /\['touchend', 'touchcancel'\]\.forEach/);
// Two fingers on a chart is the pinch gesture, not a scrub.
assert.match(html, /if \(e\.touches\.length > 1\) \{ touchDragging = false; dragging = false; hide\(\); return; \}/);

console.log('Chart zoom assertions passed');
