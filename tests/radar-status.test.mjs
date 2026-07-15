import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.ok(
  html.includes("el.classList.toggle('hidden', !message)"),
  'empty radar status must collapse instead of leaving a blank row'
);
assert.ok(!html.includes('radar frames loaded · clear areas are transparent.'));
assert.ok(!html.includes('Live NEXRAD scan loaded · clear areas are transparent.'));
assert.ok(html.includes('Loading live NEXRAD scan…'), 'loading feedback must remain visible');
assert.ok(html.includes('Radar imagery is unavailable.'), 'radar failure feedback must remain visible');

console.log('radar status visibility assertions passed');
