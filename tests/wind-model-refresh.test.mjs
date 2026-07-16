import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const initStart = html.indexOf('function init()');
const switcherStart = html.indexOf('// Wind model switcher (item 2)', initStart);
const switcherEnd = html.indexOf('radarState.mode =', switcherStart);

assert.ok(initStart >= 0 && switcherStart > initStart && switcherEnd > switcherStart,
  'wind model initialization block must remain discoverable');

const switcher = html.slice(switcherStart, switcherEnd);
assert.ok(switcher.includes("state.windModel = 'nws';"),
  'every page load must reset the visible and rendered model to NWS');
assert.ok(switcher.includes("localStorage.removeItem(cacheKey('windModel'))"),
  'startup must remove the legacy persisted model choice');
assert.ok(!switcher.includes("lsGetJSON('windModel'"),
  'startup must not restore a comparison chip before its lazy data is available');
assert.ok(!switcher.includes("lsSetJSON('windModel'"),
  'wind model selection must remain session-only');

console.log('Wind model refresh-state assertions passed');
