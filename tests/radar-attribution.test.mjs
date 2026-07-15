import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const compactRule = html.match(/\.radar-map \.leaflet-control-attribution\s*\{([^}]*)\}/)?.[1] || '';
assert.match(compactRule, /font-size:\s*8px/, 'radar attribution should use compact readable type');
assert.match(compactRule, /line-height:\s*1\.1/, 'radar attribution should keep a tight readable line height');
assert.match(compactRule, /padding:\s*0 2px/, 'radar attribution should minimize banner padding');
assert.match(compactRule, /max-width:\s*calc\(100% - 4px\)/, 'radar attribution must stay inside the map');
assert.match(compactRule, /white-space:\s*normal/, 'narrow attribution should wrap instead of overflowing');
assert.match(compactRule, /overflow-wrap:\s*anywhere/, 'long attribution text must not overflow horizontally');

assert.ok(
  html.includes("L.map('radarMap', { zoomControl: true, attributionControl: true"),
  'the radar attribution control must remain enabled'
);
const radarBaseLayer = html.match(/function addBaseTileLayer\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(
  radarBaseLayer,
  /href="https:\/\/www\.openstreetmap\.org\/copyright">OpenStreetMap contributors<\/a>/,
  'radar base-map credit must link to OpenStreetMap copyright information'
);
assert.match(
  radarBaseLayer,
  /href="https:\/\/carto\.com\/attributions">CARTO<\/a>/,
  'radar base-map credit must link to CARTO attribution information'
);
assert.ok(html.includes("'Radar loop: RainViewer'"), 'RainViewer radar credit must remain present');
assert.ok(
  html.includes("'NWS NEXRAD via Iowa Environmental Mesonet'"),
  'NWS NEXRAD/Iowa Environmental Mesonet credit must remain present'
);

assert.ok(
  html.includes('.timeline-sensor-map .leaflet-control-attribution { font-size: 7px; line-height: 1.2; }'),
  'sensor map compact attribution styling should remain unchanged'
);

console.log('radar attribution assertions passed');
