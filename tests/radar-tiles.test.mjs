import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.ok(
  html.includes('.radar-map.leaflet-container { background:'),
  'radar background rule must match the same element Leaflet decorates'
);
assert.ok(
  !html.includes('.radar-map .leaflet-container { background:'),
  'the ineffective descendant selector must not return'
);
assert.ok(
  html.includes("className: 'radar-base-tiles'"),
  'the CARTO layer must expose a dedicated class for seam-safe overlap'
);
assert.ok(
  html.includes('.radar-map .radar-base-tiles .leaflet-tile {'),
  'tile overlap must be scoped to the opaque CARTO base layer'
);
assert.ok(
  !html.includes('.radar-map .leaflet-tile {'),
  'transparent radar tiles must not receive an overlap that grows under overzoom'
);
assert.ok(html.includes('width: 257px !important;'));
assert.ok(html.includes('height: 257px !important;'));

console.log('radar tile seam assertions passed');
