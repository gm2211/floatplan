import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function parseObservedWindRow');
const end = html.indexOf('function parseWillyWallObservation', start);
assert.ok(start >= 0 && end > start, 'observed wind history block not found');

globalThis.STATION_WIND_ROBBINS_REEF = '8530973';
globalThis.parseNoaaGmt = value => Date.parse(value.replace(' ', 'T') + 'Z');
let requestedArgs;
globalThis.buildCoopsObsUrl = (...args) => {
  requestedArgs = args;
  return 'observed-wind-url';
};
globalThis.fetchCoopsJson = async () => ({
  data: [
    { t: '2026-07-18 04:06', s: '5.2', g: '7.0', d: '200', dr: 'SSW' },
    { t: '2026-07-18 04:00', s: '4.8', g: '6.1', d: '190', dr: 'S' },
    { t: 'bad', s: '***', g: '***', d: '***' }
  ]
});
(0, eval)(html.slice(start, end));

const result = await fetchObservedWind();
assert.deepEqual(requestedArgs, ['8530973', 'wind', '', 'recent'],
  'Robbins Reef should request recent observations rather than date=latest');
assert.equal(result.history.length, 2);
assert.deepEqual(result.history.map(point => point.sustainedKt), [4.8, 5.2],
  'valid observations are sorted into a measured trace');
assert.equal(result.latest.sustainedKt, 5.2);
assert.equal(result.latest.dirCardinal, 'SSW');

assert.match(html, /windHistory: windBundle && windBundle\.history/,
  'observed history must survive in the cached observed source group');
assert.match(html, /function observedWindHistoryForStation/,
  'measured history must be selected from the same station as the headline reading');
assert.match(html, /observedWindHistoryForStation\(selectedObsStation\)/,
  'the chart must not silently substitute Robbins history for Willy Wall');
assert.match(html, /linearPathD\(segment, x, y\).*var\(--violet\)/s,
  'measured samples must use non-overshooting linear interpolation');
assert.match(html, /splitObservedWindSegments\(obsHistoryPts\)/,
  'short-cadence observations must not bridge long sensor outages');
assert.match(html, /OBS_WIND_STATION_LABELS\[selectedObsStation\].*measured/s,
  'the measured trace legend must name its actual station');
assert.doesNotMatch(html, /Robbins Reef is the continuous measured reference/,
  'the chart must not claim a different station is the selected station history');
assert.match(html, /var obsX = x\(obsW\.ms\)/,
  'the latest marker belongs at its observation timestamp, not artificially on the now line');
assert.match(html, /OBS_WIND_STATION_LABELS\[selectedObsStation\]/,
  'the endpoint label names the selected observation station');
assert.match(html, /obsWindWeatherflowHistory: \[\]/,
  'Willy Wall history must have its own state slot');
assert.match(html, /state\.obsWindWeatherflowHistory = data && data\.history/,
  'Willy Wall history must survive loading');
assert.match(html, /function selectObsWindStation[\s\S]*?renderObsWindRow[\s\S]*?rerenderWindCard\(\)/,
  'changing observation stations must immediately redraw the chart history');

const linearStart = html.indexOf('function linearPathD');
const linearEnd = html.indexOf('/* ============================== Smooth curve path', linearStart);
assert.ok(linearStart >= 0 && linearEnd > linearStart, 'linear measured path helper not found');
(0, eval)(html.slice(linearStart, linearEnd));
assert.equal(linearPathD([
  { ms: 0, v: 5 }, { ms: 5, v: 10 }, { ms: 10, v: 5 }
], value => value, value => value), 'M0.0,5.0 L5.0,10.0 L10.0,5.0');

console.log('Observed wind history assertions passed');
