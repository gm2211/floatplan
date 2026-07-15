import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  html,
  /id="radarOpacitySlider" min="30" max="90" step="1" value="62" aria-label="Radar opacity"/,
  'radar opacity control must be compact, accessible, and start at 62%'
);
assert.ok(html.includes('<output id="radarOpacityValue" for="radarOpacitySlider">62%</output>'));
const showRadarFrameBlock = html.match(/function showRadarFrame\(idx\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(showRadarFrameBlock.includes("opacity: radarState.opacity"), 'new live and animated radar frames must inherit the selected opacity');
assert.ok(!showRadarFrameBlock.includes('opacity: 0.72'), 'the old hardcoded radar opacity must not return');
assert.ok(html.includes('radarState.currentLayer.setOpacity(opacity)'), 'the active layer must update without a frame reload');
assert.ok(html.includes("lsSetJSON('radarOpacity', opacity)"), 'the selected opacity must persist locally');
assert.ok(html.includes("lsGetJSON('radarOpacity', DEFAULT_RADAR_OPACITY)"), 'the saved opacity must restore on startup');

const defaultMatch = html.match(/var DEFAULT_RADAR_OPACITY = ([0-9.]+);/);
const normalizeMatch = html.match(/function normalizeRadarOpacity\(value\) \{[\s\S]*?\n\}/);
assert.ok(defaultMatch && normalizeMatch, 'radar opacity normalization code must remain available');

const context = { isFinite, Number, Math };
vm.createContext(context);
vm.runInContext(
  `var DEFAULT_RADAR_OPACITY = ${defaultMatch[1]};\n` +
  'function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }\n' +
  normalizeMatch[0],
  context
);
assert.equal(context.normalizeRadarOpacity(undefined), 0.62);
assert.equal(context.normalizeRadarOpacity(null), 0.62);
assert.equal(context.normalizeRadarOpacity(true), 0.62);
assert.equal(context.normalizeRadarOpacity('broken'), 0.62);
assert.equal(context.normalizeRadarOpacity(0.1), 0.30);
assert.equal(context.normalizeRadarOpacity(0.95), 0.90);
assert.equal(context.normalizeRadarOpacity(0.67), 0.67);

console.log('radar opacity assertions passed');
