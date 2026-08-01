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

console.log('Chart zoom assertions passed');
