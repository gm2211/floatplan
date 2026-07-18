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
  'measured history must remain available independently for both stations');
assert.match(html, /station: 'robbinsReef'[\s\S]*station: 'weatherflow'/,
  'specific-model charts must declare independent Robbins Reef and Willy Wall series');
assert.match(html, /observedWindHistoryForStation\(series\.station\)/,
  'each chart series must load its own station history');
assert.match(html, /linearPathD\(segment, x, y\).*series\.color/s,
  'measured samples must use non-overshooting linear interpolation');
assert.match(html, /splitObservedWindSegments\(series\.points\)/,
  'each station trace must independently split around sensor outages');
assert.match(html, /escapeHtml\(series\.label\)[\s\S]*?measured<\/span>/,
  'each measured trace legend must name its station');
assert.doesNotMatch(html, /Robbins Reef is the continuous measured reference/,
  'the chart must not claim a different station is the selected station history');
assert.match(html, /var obsX = x\(endpoint\.ms\)/,
  'each latest marker belongs at its observation timestamp, not artificially on the now line');
assert.match(html, /escapeHtml\(series\.label\) \+ ' ' \+ round1\(endpoint\.v\)/,
  'each endpoint label names its observation station');
assert.match(html, /interpolateObservedWindAtMs\(series\.points, ms\)/,
  'the scrub tooltip must sample both independent measured series');
assert.match(html, /escapeHtml\(series\.label\) \+ ' measured ' \+ round1\(measured\)/,
  'the scrub tooltip must name each measured station value');
assert.match(html, /obsWindWeatherflowHistory: \[\]/,
  'Willy Wall history must have its own state slot');
assert.match(html, /state\.obsWindWeatherflowHistory = data && data\.history/,
  'Willy Wall history must survive loading');
assert.match(html, /function selectObsWindStation[\s\S]*?renderObsWindRow[\s\S]*?rerenderWindCard\(\)/,
  'changing observation stations must immediately redraw the chart history');
assert.match(html, /function loadWillyWall[\s\S]*?rerenderWindCard\(\)/,
  'loading Willy Wall must redraw the comparison chart even when Robbins Reef is selected');

const linearStart = html.indexOf('function linearPathD');
const linearEnd = html.indexOf('/* ============================== Smooth curve path', linearStart);
assert.ok(linearStart >= 0 && linearEnd > linearStart, 'linear measured path helper not found');
(0, eval)(html.slice(linearStart, linearEnd));
assert.equal(linearPathD([
  { ms: 0, v: 5 }, { ms: 5, v: 10 }, { ms: 10, v: 5 }
], value => value, value => value), 'M0.0,5.0 L5.0,10.0 L10.0,5.0');

const observedSplitStart = html.indexOf('function splitObservedWindSegments');
const observedSplitEnd = html.indexOf('function windLegendLineSvg', observedSplitStart);
assert.ok(observedSplitStart >= 0 && observedSplitEnd > observedSplitStart,
  'bounded observed interpolation helpers not found');
globalThis.interpRowsValue = (rows, ms, field) => {
  let prev = null, next = null;
  for (const row of rows) {
    if (row[field] == null) continue;
    if (row.ms <= ms) prev = row;
    if (row.ms >= ms) { next = row; break; }
  }
  if (!prev) return next ? next[field] : null;
  if (!next || next.ms === prev.ms) return prev[field];
  const ratio = (ms - prev.ms) / (next.ms - prev.ms);
  return prev[field] + ratio * (next[field] - prev[field]);
};
(0, eval)(html.slice(observedSplitStart, observedSplitEnd));
const measuredPoints = [{ ms: 0, v: 4 }, { ms: 5 * 60000, v: 8 }, { ms: 30 * 60000, v: 12 }];
assert.equal(interpolateObservedWindAtMs(measuredPoints, -1), null, 'must not extrapolate before station history');
assert.equal(interpolateObservedWindAtMs(measuredPoints, 2.5 * 60000), 6, 'interpolates within one station segment');
assert.equal(interpolateObservedWindAtMs(measuredPoints, 15 * 60000), null, 'must not bridge a station outage');
assert.equal(interpolateObservedWindAtMs(measuredPoints, 31 * 60000), null, 'must not extrapolate after station history');

console.log('Observed wind history assertions passed');
