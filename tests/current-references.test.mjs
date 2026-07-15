import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function buildMeasuredCurrentUrl');
const end = html.indexOf('function fetchObservedScalar', start);
assert.ok(start >= 0 && end > start, 'measured-current fetcher block not found');

globalThis.STATION_KVK_CURRENT = 'n06010';
globalThis.STATION_NEWARK_CURRENT = 'n07010';
globalThis.STATION_NARROWS_CURRENT = 'n03020';
globalThis.KVK_FLOOD_AXIS_DEG = 255;
globalThis.NARROWS_FLOOD_AXIS_DEG = 324;
globalThis.MEASURED_CURRENT_HISTORY_HOURS = 24;
globalThis.MEASURED_CURRENT_GAP_MS = 15 * 60000;
globalThis.pad2 = (value) => String(value).padStart(2, '0');
globalThis.parseNoaaGmt = (value) => Date.parse(value.replace(' ', 'T') + 'Z');
globalThis.fetchCoopsJson = async () => ({ data: [] });
(0, eval)(html.slice(start, end));

assert.match(buildMeasuredCurrentUrl('n07010'), /product=currents/);
assert.match(buildMeasuredCurrentUrl('n07010'), /station=n07010/);
assert.match(buildMeasuredCurrentUrl('n03020'), /station=n03020/);
assert.match(buildMeasuredCurrentUrl('n06010'), /date=latest/, 'latest-reading consumers must keep their existing request');

const historyNow = Date.parse('2026-07-15T12:34:56Z');
const historyUrl = new URL(buildMeasuredCurrentHistoryUrl('n06010', historyNow, 24));
assert.equal(historyUrl.searchParams.get('product'), 'currents');
assert.equal(historyUrl.searchParams.get('station'), 'n06010');
assert.equal(historyUrl.searchParams.get('begin_date'), '20260714 12:34', 'history starts at an exact UTC minute');
assert.equal(historyUrl.searchParams.get('range'), '24');
assert.equal(historyUrl.searchParams.has('bin'), false, 'NOAA must choose the station predefined real-time bin across redeployments');
assert.equal(historyUrl.searchParams.has('date'), false, 'history must not use date=recent/latest shortcuts');
const narrowsHistoryUrl = new URL(buildNarrowsCurrentHistoryUrl(historyNow));
assert.equal(narrowsHistoryUrl.searchParams.get('station'), 'n03020');
assert.equal(narrowsHistoryUrl.searchParams.has('bin'), false, 'Narrows history must follow the active predefined bin');

globalThis.fetchCoopsJson = async () => { throw new Error('NOAA offline'); };
await assert.rejects(
  fetchMeasuredCurrentHistory('n06010', 'Kill Van Kull', historyNow, 24),
  /NOAA offline/,
  'history failures must reject so loadSource preserves cached observations'
);
globalThis.fetchCoopsJson = async () => ({ data: [] });

const parsed = parseMeasuredCurrentRow({ t: '2026-07-15 05:54', s: '1.04', d: '421', b: '2' });
assert.equal(parsed.ms, Date.parse('2026-07-15T05:54:00Z'));
assert.equal(parsed.speedKt, 1.04);
assert.equal(parsed.dirDeg, 61, 'directions should normalize to 0-359 degrees');
assert.equal(parsed.bin, '2');
assert.equal(parseMeasuredCurrentRow(null), null);
assert.equal(parseMeasuredCurrentRow({ s: '***', d: '***' }), null, 'NOAA QC placeholders are unavailable, not zero');

const series = parseMeasuredCurrentSeries([
  { t: '2026-07-15 06:12', s: '0.7', d: '75', b: '4' },
  { t: 'bad', s: '0.4', d: '255', b: '4' },
  { t: '2026-07-15 06:00', s: '1.2', d: '255', b: '4' },
  { t: '2026-07-15 06:06', s: '***', d: '255', b: '4' },
  { t: '2026-07-15 06:18', s: '0.6', d: '***', b: '4' }
]);
assert.deepEqual(series.map(point => point.ms), [
  Date.parse('2026-07-15T06:00:00Z'),
  Date.parse('2026-07-15T06:12:00Z')
], 'all valid rows are retained and sorted while QC/invalid rows are dropped');

assert.ok(Math.abs(projectCurrentAlongAxis(2, 255, KVK_FLOOD_AXIS_DEG) - 2) < 1e-12, '255° is positive KVK flood-axis flow');
assert.ok(Math.abs(projectCurrentAlongAxis(2, 75, KVK_FLOOD_AXIS_DEG) + 2) < 1e-12, 'reciprocal 75° flow is negative ebb-axis flow');
assert.ok(Math.abs(projectCurrentAlongAxis(2, 345, KVK_FLOOD_AXIS_DEG)) < 1e-12, 'cross-channel flow has zero along-axis component');
assert.ok(Math.abs(projectCurrentAlongAxis(2, 324, NARROWS_FLOOD_AXIS_DEG) - 2) < 1e-12, '324° is positive Narrows flood-axis flow');
assert.ok(Math.abs(projectCurrentAlongAxis(2, 144, NARROWS_FLOOD_AXIS_DEG) + 2) < 1e-12, '144° is negative Narrows ebb-axis flow');
assert.equal(projectNarrowsCurrentSeries([{ ms: historyNow, speedKt: 1.5, dirDeg: 324 }])[0].v, 1.5);

const t0 = Date.parse('2026-07-15T06:00:00Z');
const segmented = buildMeasuredCurrentSegments([
  { ms: t0, v: 1 },
  { ms: t0 + 6 * 60000, v: 0.8 },
  { ms: t0 + 30 * 60000, v: -0.2 },
  { ms: t0 + 40 * 60000, v: -0.5 }
], t0 + 35 * 60000, MEASURED_CURRENT_GAP_MS);
assert.deepEqual(segmented.map(group => group.length), [2, 1], 'gaps over 15 minutes split the path and future samples are clipped');
assert.equal(measuredCurrentValueAt(segmented.flat(), t0 + 18 * 60000, MEASURED_CURRENT_GAP_MS), null, 'scrubbing never interpolates across a measurement gap');
assert.equal(measuredCurrentValueAt(segmented[0], t0 + 3 * 60000, MEASURED_CURRENT_GAP_MS), 0.9);

assert.ok(html.includes('data-current-station="hudson">Hudson prediction'));
assert.ok(html.includes('data-current-station="kvk">Kill Van Kull'));
assert.ok(html.includes('data-current-station="newark">Newark Bay'));
assert.ok(html.includes('data-current-station="narrows">The Narrows'));
assert.ok(html.includes("lsSetJSON('obsCurrentStation', station)"), 'current reference choice must persist');
assert.ok(html.includes('Planning and the sail simulator always use the Hudson River Entrance prediction.'));
assert.ok(html.includes("var STATION_CURRENT = 'NYH1927'"), 'planning must remain on the Hudson prediction station');

const sourceDetails = html.match(/<details class="source-links">/g) || [];
assert.equal(sourceDetails.length, 12, 'every widget source footer should use the same collapsed disclosure');
assert.equal((html.match(/<div class="source-links">/g) || []).length, 0);

const timelineCard = html.slice(html.indexOf('<section class="card" id="timelineCard">'), html.indexOf('<section class="card" id="sailSimCard">'));
const timelineSourcesStart = timelineCard.indexOf('<details class="source-links">');
assert.ok(timelineSourcesStart >= 0, 'timeline Sources disclosure not found');
assert.ok(timelineCard.indexOf('id="timelineError"') < timelineSourcesStart, 'current errors must remain visible outside Sources');
assert.ok(timelineCard.indexOf('id="waterError"') < timelineSourcesStart, 'water-level errors must remain visible outside Sources');
assert.ok(timelineCard.indexOf('id="timelineCurrentCompare"') > timelineSourcesStart, 'measured phase comparison must stay inside collapsed Sources');
assert.ok(timelineCard.indexOf('Predicted current: Hudson River Entrance') > timelineSourcesStart, 'station provenance must stay inside collapsed Sources');
assert.ok(timelineCard.includes('class="source-links-notes"'), 'timeline provenance notes need a full-width source row');
assert.ok(!timelineCard.includes('<details class="source-links" open>'), 'timeline Sources must remain collapsed by default');
['srcTimelinePorts', 'srcTimelineCurrents', 'srcTimelineKvk', 'srcTimelineNarrows', 'srcTimelineLevelPredicted', 'srcTimelineLevelObserved'].forEach(id => {
  assert.ok(timelineCard.includes(`id="${id}"`), `${id} source link must remain available`);
});
assert.ok(html.includes("stationObservationSummary('The Narrows', latestNarrowsAll)"), 'Narrows outage must render an honest unavailable summary');
assert.ok(html.includes("narrowsLegendStatus.textContent = narrowsAll.length ?"));
assert.ok(html.includes("'· unavailable'"), 'an unavailable observed station must remain visible in the compact legend');
assert.ok(html.includes('Both are remote harbor references, not Pier 25 measurements'));
assert.ok(html.includes('The Narrows (remote) '), 'scrub readout must label The Narrows as remote');
assert.ok(html.includes('kvkInDomain.concat(narrowsInDomain).forEach'), 'both observed series extrema must participate in current-axis scaling');
assert.ok(html.includes('loadKvkCurrentHistory()'), 'measured history must load with the dashboard');
assert.ok(html.includes('loadNarrowsCurrentHistory()'), 'Narrows measured history must load with the dashboard');
assert.ok(!html.includes('speedKt * Math.cos(kvk.dirDeg * Math.PI / 180)'), 'the old north-component projection must be removed');
assert.ok(html.includes("kvkCurrentColor = 'var(--measured-current)'"), 'Kill Van Kull needs a distinct color from observed water level');
assert.ok(html.includes("narrowsCurrentColor = 'var(--narrows-current)'"), 'The Narrows needs a distinct series color');
assert.ok(html.includes('stroke-dasharray="5,3"'), 'The Narrows line needs a non-color dashed distinction');
assert.ok(html.includes('.source-links-notes { flex: 1 1 100%;'), 'source notes must occupy a full row above the links');

assert.ok(html.includes("kvk: { name: 'Kill Van Kull LB 14', lat: 40.64358, lon: -74.13889 }"));
assert.ok(html.includes("narrows: { name: 'The Narrows', lat: 40.60639953613281, lon: -74.03800201416016 }"));
assert.ok(html.includes('height: 132px'), 'sensor locator must stay compact and fixed-height');
assert.ok(html.includes("L.map(el, {"), 'sensor locator initializes a Leaflet map once');
assert.ok(html.includes('scrollWheelZoom: false'), 'sensor locator must not hijack page scrolling');
assert.ok(html.includes('dragging: false'), 'compact locator must stay a stable geographic reference');
assert.ok(html.includes('touchZoom: false'), 'compact locator must not capture pinch gestures');
assert.ok(html.includes('currentSensorMapState.map.invalidateSize(false)'));
assert.ok(html.includes('refreshCurrentSensorMapLayout();'), 'layout changes must resize and refit the sensor locator');
assert.ok(html.includes('addCurrentSensorBaseLayer();'), 'theme changes must replace the sensor map base layer');
assert.ok(html.includes('https://tidesandcurrents.noaa.gov/ports/index.html?port=ny'));
assert.ok(html.includes('https://tidesandcurrents.noaa.gov/cdata/DataPlot?id=n03020&amp;view=data'));

console.log('Current reference history, projection, chart, and source disclosure assertions passed');
