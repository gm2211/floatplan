import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function parseWillyWallObservation');
const end = html.indexOf('// Kill Van Kull LB 14', start);
assert.ok(start >= 0 && end > start, 'production Willy Wall parser/fetcher block not found');

globalThis.KT_PER_MPH = 0.868976;
globalThis.WILLY_WALL_HISTORY_URL = 'https://api.weather.com/willy-wall-history';
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

const historyFixture = {
  observations: [
    {
      obsTimeUtc: '2026-07-15T05:45:00Z', winddirAvg: 270,
      imperial: { windspeedAvg: 8, windgustHigh: 13 }
    },
    {
      obsTimeUtc: '2026-07-15T05:40:00Z', winddirAvg: 260,
      imperial: { windspeedAvg: 7, windgustHigh: 12 }
    },
    {
      obsTimeUtc: '2026-07-15T05:40:00Z', winddirAvg: 260,
      imperial: { windspeedAvg: 99, windgustHigh: 99 }
    },
    { obsTimeUtc: 'bad', imperial: { windspeedAvg: null } }
  ]
};
const historyParsed = parseWillyWallObservationSeries(historyFixture);
assert.equal(historyParsed.length, 2, 'history parser rejects invalid and duplicate timestamps');
assert.deepEqual(historyParsed.map(point => point.ms), [
  Date.parse('2026-07-15T05:40:00Z'), Date.parse('2026-07-15T05:45:00Z')
]);
assert.ok(Math.abs(historyParsed[0].sustainedKt - 7 * KT_PER_MPH) < 1e-9);
assert.ok(Math.abs(historyParsed[1].gustKt - 13 * KT_PER_MPH) < 1e-9);
assert.equal(historyParsed[1].dirDeg, 270);

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

const classifierStart = html.indexOf('function classifyObservedWindComparison');
const classifierEnd = html.indexOf('function observedWindComparisonBadge', classifierStart);
assert.ok(classifierStart >= 0 && classifierEnd > classifierStart, 'wind comparison classifier not found');
(0, eval)(html.slice(classifierStart, classifierEnd));

assert.equal(classifyObservedWindComparison({ sustainedKt: 14, gustKt: 18 }, 11, 16), 'above', 'any comparable value at least 3 kt high is above');
assert.equal(classifyObservedWindComparison({ sustainedKt: 10, gustKt: 20 }, 11, 17), 'above', 'gust alone can classify above');
assert.equal(classifyObservedWindComparison({ sustainedKt: 8, gustKt: 12 }, 11, 15), 'below', 'all comparable values at least 3 kt low are below');
assert.equal(classifyObservedWindComparison({ sustainedKt: 8, gustKt: 14 }, 11, 15), 'within', 'one value inside the deadband prevents below');
assert.equal(classifyObservedWindComparison({ sustainedKt: 13.9, gustKt: null }, 11, null), 'within', 'a 2.9 kt difference stays within');
assert.equal(classifyObservedWindComparison({ sustainedKt: 8.1, gustKt: null }, 11, null), 'within', 'a -2.9 kt difference stays within');
assert.equal(classifyObservedWindComparison({ sustainedKt: 12, gustKt: null }, 11, 18), 'within', 'a single comparable sustained value can be within');
assert.equal(classifyObservedWindComparison({ sustainedKt: 12, gustKt: null }, null, 18), 'unavailable', 'no like-for-like pair is unavailable');
assert.equal(classifyObservedWindComparison(null, 11, 18), 'unavailable');

let requested = [];
globalThis.fetchWithRetry = async (url) => {
  requested.push(url);
  return { ok: true, json: async () => fixture };
};
const live = await fetchObservedWindWillyWall();
assert.deepEqual(requested, [WILLY_WALL_HISTORY_URL], 'WU same-station history must be primary');
assert.equal(live.latest.dirDeg, 266);
assert.equal(live.history.length, 1);

requested = [];
globalThis.fetchWithRetry = async (url) => {
  requested.push(url);
  if (url === WILLY_WALL_HISTORY_URL || url === WILLY_WALL_OBS_URL) throw new Error('primary unavailable');
  return { ok: true, text: async () => currentReaderText };
};
const fallback = await fetchObservedWindWillyWall();
assert.deepEqual(requested, [WILLY_WALL_HISTORY_URL, WILLY_WALL_OBS_URL, WILLY_WALL_TEXT_FALLBACK_URL]);
assert.equal(fallback.latest.dirCardinal, 'W');
assert.equal(fallback.history.length, 1);

assert.ok(html.includes('stationId=KNJNEWJE43'), 'production endpoint must target Willy Wall');
assert.ok(html.includes('/observations/all/1day'), 'production endpoint must load Willy Wall history');
assert.ok(html.includes('Live feed unavailable &middot; check source'), 'failure copy must not claim the station itself is offline');
assert.ok(html.includes('data-station="robbinsReef">Robbins Reef</button>'), 'Robbins Reef must remain selectable');
assert.ok(html.includes('data-station="weatherflow"'), 'Willy Wall must remain selectable');
assert.ok(!html.includes('data-station="kjrb"'), 'East River station must not remain selectable');
assert.ok(!html.includes('/stations/KJRB'), 'East River observation endpoint must be removed');
assert.ok(!html.includes('function fetchObservedWindKjrb'), 'East River fetcher must be removed');
assert.ok(!html.includes('obsWindKjrbRaw'), 'East River state slot must be removed');
assert.ok(!html.includes('loadObservedKjrb'), 'East River loader must be removed');
assert.ok(!html.includes('Wall St Heliport'), 'East River station labels must be removed');
assert.ok(html.includes("state.obsWindStation !== 'robbinsReef' && state.obsWindStation !== 'weatherflow'"), 'legacy or invalid station selections must fall back');
assert.ok(html.includes("lsSetJSON('obsWindStation', state.obsWindStation)"), 'fallback station selection must be persisted');
assert.ok(html.includes("localStorage.removeItem(cacheKey('observedKjrb'))"), 'obsolete East River cache must be removed');
assert.ok(html.includes('if (observedWindIsFresh(w, nowMs))'), 'comparison must reject stale observations');
assert.ok(html.includes('valueAtMs(state.gridSeries.windSpeedKt, compareAtMs)'), 'comparison must use the NWS wind interval covering the observation time');
assert.ok(html.includes('valueAtMs(state.gridSeries.windGustKt, compareAtMs)'), 'comparison must use the NWS gust interval covering the observation time');
assert.ok(html.includes('observed-comparison-status is-warning') || html.includes("cls: 'is-warning'"), 'above status needs a warning class');
assert.ok(html.includes("above: { text: 'Above forecast', cls: 'is-warning' }"));
assert.ok(html.includes("within: { text: 'Within forecast', cls: 'is-positive' }"));
assert.ok(html.includes("below: { text: 'Below forecast', cls: 'is-positive' }"));
assert.ok(html.includes("unavailable: { text: 'Forecast unavailable', cls: 'is-neutral' }"));
assert.ok(html.includes('white-space: nowrap'), 'comparison cue and readings must not wrap');
assert.ok(html.includes('.observed-comparison-status::before'), 'comparison cue must use a restrained status dot');
assert.ok(html.includes('@container (max-width: 450px)'), 'wind row must stack before the known 436–503px failure band');
assert.ok(html.includes('overflow-x: auto'), 'compact current controls must remain usable at 320/375/435/475px widths');
assert.ok(html.includes("'<span class=\"observed-wind-meta\">' + comparisonBadge"), 'unavailable readings must retain the comparison/meta row');
assert.ok(!html.includes('<span class="observed-wind-station">Wind &middot; '), 'selected station must not be repeated below its selector');
assert.ok(html.includes('class="observed-footer"'), 'More and Sources must share a restrained footer');
assert.ok(html.includes('aria-expanded="false" aria-controls="observedMoreBody"'), 'More control must expose its collapsed state');
assert.ok(html.includes("chip.setAttribute('aria-pressed', selected ? 'true' : 'false')"), 'station selectors must expose their selected state');
assert.ok(html.includes('grid-template-areas: "label value" ". meta"'), 'current states must reserve identical label/value/meta geometry');
assert.ok(html.includes('class="observed-current-meta" aria-hidden="true">&nbsp;</span>'), 'current states without timestamps must preserve the metadata row');
assert.ok(html.includes('Robbins Reef NOAA</a>'), 'Robbins Reef source must remain linked');
assert.ok(html.includes('Willy Wall Wunderground</a>'), 'the original station page must remain linked');

console.log('Willy Wall live observation and fallback assertions passed');
