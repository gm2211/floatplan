import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function parseWillyWallObservation');
const end = html.indexOf('// Kill Van Kull LB 14', start);
assert.ok(start >= 0 && end > start, 'production Willy Wall parser/fetcher block not found');

globalThis.KT_PER_MPH = 0.868976;
globalThis.WILLY_WALL_OBS_URL = 'https://api.weather.com/willy-wall';
globalThis.WILLY_WALL_TEXT_FALLBACK_URL = 'https://r.jina.ai/willy-wall';
(0, eval)(html.slice(start, end));

const fixture = {
  observations: [{
    obsTimeUtc: '2026-07-15T05:40:00Z',
    epoch: 1784094000,
    winddir: 266,
    imperial: { windSpeed: 7, windGust: 12 }
  }]
};

const parsed = parseWillyWallObservation(fixture);
assert.equal(parsed.ms, Date.parse('2026-07-15T05:40:00Z'));
assert.ok(Math.abs(parsed.sustainedKt - 7 * KT_PER_MPH) < 1e-9);
assert.ok(Math.abs(parsed.gustKt - 12 * KT_PER_MPH) < 1e-9);
assert.equal(parsed.dirDeg, 266);
assert.equal(parsed.dirCardinal, null);

const calm = parseWillyWallObservation({
  observations: [{ epoch: 1784094000, winddir: 360, imperial: { windSpeed: 0, windGust: null } }]
});
assert.equal(calm.sustainedKt, 0, 'a valid calm observation must not be treated as missing');
assert.equal(calm.gustKt, null);
assert.equal(calm.dirDeg, 0);
assert.equal(calm.ms, 1784094000000);

assert.equal(parseWillyWallObservation({ observations: [] }), null);
assert.equal(parseWillyWallObservation({ observations: [{ imperial: { windSpeed: null } }] }), null);
assert.equal(parseWillyWallObservation({ observations: [{ imperial: { windSpeed: -1 } }] }), null);

const now = Date.parse('2026-07-15T05:45:00Z');
const originalNow = Date.now;
Date.now = () => now;
const currentReaderText = `
## Station Summary

Online(updated 5 minutes ago)

83.0°F

![Image 1: img](https://www.wunderground.com/static/images/pws/Wind-Dial.svg)

W

![Image 2: img](https://www.wunderground.com/static/images/pws/Wind-Marker.svg)

13.0°
/
14.0°mph

## PWS CURRENT CONDITIONS
`;
const fallbackParsed = parseWillyWallText(currentReaderText);
Date.now = originalNow;
assert.equal(fallbackParsed.ms, now - 5 * 60000);
assert.ok(Math.abs(fallbackParsed.sustainedKt - 13 * KT_PER_MPH) < 1e-9);
assert.ok(Math.abs(fallbackParsed.gustKt - 14 * KT_PER_MPH) < 1e-9);
assert.equal(fallbackParsed.dirCardinal, 'W');
assert.equal(parseWillyWallText('## Station Summary\nOffline'), null);

let requested = [];
globalThis.fetchWithRetry = async (url) => {
  requested.push(url);
  return { ok: true, json: async () => fixture };
};
const live = await fetchObservedWindWillyWall();
assert.deepEqual(requested, [WILLY_WALL_OBS_URL], 'direct WU browser feed must be primary');
assert.equal(live.dirDeg, 266);

requested = [];
globalThis.fetchWithRetry = async (url) => {
  requested.push(url);
  if (url === WILLY_WALL_OBS_URL) throw new Error('primary unavailable');
  return { ok: true, text: async () => currentReaderText };
};
const fallback = await fetchObservedWindWillyWall();
assert.deepEqual(requested, [WILLY_WALL_OBS_URL, WILLY_WALL_TEXT_FALLBACK_URL]);
assert.equal(fallback.dirCardinal, 'W');

assert.ok(html.includes('stationId=KNJNEWJE43'), 'production endpoint must target Willy Wall');
assert.ok(html.includes('Live feed unavailable &middot; check source'), 'failure copy must not claim the station itself is offline');
assert.ok(html.includes('Willy Wall Wunderground</a>'), 'the original station page must remain linked');

console.log('Willy Wall live observation and fallback assertions passed');
