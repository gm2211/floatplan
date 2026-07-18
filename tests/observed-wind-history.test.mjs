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
assert.match(html, /var obsHistoryPts =/);
assert.doesNotMatch(html, /obsHistoryPts = \(state\.obsWindStation[^\n]+=== 'robbinsReef'/,
  'Robbins measured history remains visible when Willy Wall supplies the headline reading');
assert.match(html, /smoothPathD\(segment, x, y\).*var\(--violet\)/s,
  'the chart must draw a violet measured-wind path');
assert.match(html, /splitObservedWindSegments\(obsHistoryPts\)/,
  'short-cadence observations must not bridge long sensor outages');
assert.match(html, /Robbins measured/);
assert.match(html, /var obsX = x\(obsW\.ms\)/,
  'the latest marker belongs at its observation timestamp, not artificially on the now line');
assert.match(html, /OBS_WIND_STATION_LABELS\[selectedObsStation\]/,
  'the endpoint label names the selected observation station');

console.log('Observed wind history assertions passed');
