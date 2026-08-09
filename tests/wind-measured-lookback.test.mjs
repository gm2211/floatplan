import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ---- locate the production source blocks this test exercises ----------------------------

const lookbackConstStart = html.indexOf('var WIND_MEASURED_LOOKBACK_MS');
assert.ok(lookbackConstStart >= 0, 'WIND_MEASURED_LOOKBACK_MS constant not found');
const lookbackConstEnd = html.indexOf(';', lookbackConstStart) + 1;
const lookbackConstSrc = html.slice(lookbackConstStart, lookbackConstEnd);

const startFnStart = html.indexOf('function windChartStartMs');
const startFnEnd = html.indexOf('function renderWindCard', startFnStart);
assert.ok(startFnStart >= 0 && startFnEnd > startFnStart, 'windChartStartMs not found');
const startFnSrc = html.slice(startFnStart, startFnEnd);

const splitStart = html.indexOf('function splitWindPointSegments');
const splitEnd = html.indexOf('function windLegendLineSvg', splitStart);
assert.ok(splitStart >= 0 && splitEnd > splitStart, 'wind/observed segment splitters not found');
const splitSrc = html.slice(splitStart, splitEnd);

const pathStart = html.indexOf('function linearPathD');
const pathEnd = html.indexOf('/* ============================== Weather card data model', pathStart);
assert.ok(pathStart >= 0 && pathEnd > pathStart, 'linearPathD/smoothPathD not found');
const pathSrc = html.slice(pathStart, pathEnd);

const helpersStart = html.indexOf('var DEFAULT_WIND_TRACE_VISIBILITY');
const helpersEnd = html.indexOf('function renderWindChart', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'wind trace visibility helper block not found');
const helpersSrc = html.slice(helpersStart, helpersEnd);

// ---- shared stand-ins for the handful of external helpers these blocks call --------------

function buildLookbackContext() {
  const ctx = vm.createContext({});
  vm.runInContext(lookbackConstSrc, ctx);
  vm.runInContext(startFnSrc, ctx);
  return ctx;
}

// ---- (a) windChartStartMs: widen toward NOW, capped at the lookback, never widen pointlessly

{
  const HOUR = 3600000;
  const ctx = buildLookbackContext();
  const domStart = 1000 * HOUR; // arbitrary anchor, well away from 0 so subtraction can't go negative by accident

  assert.equal(ctx.windChartStartMs(domStart, domStart), domStart - 6 * HOUR,
    'NOW at domStart must pull the start back the full 6h lookback so measured history gets real width');

  assert.equal(ctx.windChartStartMs(domStart, domStart + 2 * HOUR), domStart - 4 * HOUR,
    'NOW 2h after domStart must pull the start back by lookback minus that 2h head start');

  assert.equal(ctx.windChartStartMs(domStart, domStart + 8 * HOUR), domStart,
    'NOW 8h after domStart already has 8h of width inside the window, so no extension is needed');

  assert.equal(ctx.windChartStartMs(domStart, domStart - 10 * HOUR), domStart,
    'NOW 10h before domStart means departure is far in the future; widening now would be pointless');

  const oneHourBefore = ctx.windChartStartMs(domStart, domStart - HOUR);
  assert.equal(oneHourBefore, domStart - 6 * HOUR,
    'NOW 1h before domStart must still cap at the full 6h lookback');

  // Sweep a wide range of nowMs values and assert the result is never earlier than the cap.
  for (let deltaHours = -20; deltaHours <= 20; deltaHours += 0.5) {
    const nowMs = domStart + deltaHours * HOUR;
    const result = ctx.windChartStartMs(domStart, nowMs);
    assert.ok(result >= domStart - 6 * HOUR,
      'windChartStartMs(domStart=' + domStart + ', nowMs=' + nowMs + ') = ' + result +
      ' must never be earlier than domStart - 6h');
    assert.ok(result <= domStart, 'windChartStartMs must never push the start later than domStart');
  }

  assert.equal(ctx.windChartStartMs(domStart, null), domStart, 'null nowMs must fall back to domStart untouched');
  assert.equal(ctx.windChartStartMs(domStart, undefined), domStart, 'undefined nowMs must fall back to domStart untouched');
  assert.equal(ctx.windChartStartMs(domStart, NaN), domStart, 'NaN nowMs must fall back to domStart untouched');
  assert.equal(ctx.windChartStartMs(domStart, Infinity), domStart, 'non-finite nowMs must fall back to domStart untouched');
}

console.log('windChartStartMs assertions passed');

// ---- (b) the widened start keeps measured points the un-widened start would have dropped -

{
  const HOUR = 3600000;
  const domStart = 10 * HOUR;
  const domEnd = domStart + 20 * HOUR;
  const nowMs = domStart + HOUR; // departs soon: NOW sits just after domStart

  const widenedStart = (() => {
    const ctx = buildLookbackContext();
    return ctx.windChartStartMs(domStart, nowMs);
  })();
  assert.equal(widenedStart, domStart - 5 * HOUR, 'sanity check on the widened start used below');

  // A Robbins Reef sample that falls before the un-widened domStart but inside the widened
  // window: the un-widened chart would drop it (buildObservedWindChartSeries filters on
  // point.ms >= domStart), the widened chart must keep it.
  const droppedByOldStart = domStart - 2 * HOUR;
  assert.ok(droppedByOldStart < domStart && droppedByOldStart >= widenedStart,
    'test point must sit strictly between the widened and un-widened starts');

  const robbinsHistory = [
    { ms: droppedByOldStart, sustainedKt: 11 },
    { ms: domStart + HOUR, sustainedKt: 13 }
  ];

  function buildSeriesContext() {
    const ctx = vm.createContext({
      state: { windTraceVisibility: { forecast: true, robbinsReef: true, willyWall: true } },
      escapeHtml: s => String(s),
      round1: n => (Math.round(n * 10) / 10).toFixed(1),
      OBS_WIND_STATION_LABELS: { robbinsReef: 'Robbins Reef', weatherflow: 'Willy Wall' },
      observedWindHistoryForStation: station => (station === 'robbinsReef' ? robbinsHistory : [])
    });
    vm.runInContext(splitSrc, ctx);
    vm.runInContext(pathSrc, ctx);
    vm.runInContext(helpersSrc, ctx);
    return ctx;
  }

  const ctxOld = buildSeriesContext();
  const seriesOld = ctxOld.buildObservedWindChartSeries(domStart, domEnd, nowMs);
  const robbinsOld = seriesOld.find(s => s.station === 'robbinsReef');
  assert.equal(robbinsOld.points.length, 1, 'the un-widened domStart must drop the earlier sample');

  const ctxWidened = buildSeriesContext();
  const seriesWidened = ctxWidened.buildObservedWindChartSeries(widenedStart, domEnd, nowMs);
  const robbinsWidened = seriesWidened.find(s => s.station === 'robbinsReef');
  assert.equal(robbinsWidened.points.length, 2, 'the widened start must keep both samples, including the one the old start dropped');
  assert.ok(robbinsWidened.points.some(p => p.ms === droppedByOldStart),
    'the specific sample dropped by the un-widened start must be present when using the widened start');
}

console.log('Widened chart start keeps previously-dropped observed points passed');
