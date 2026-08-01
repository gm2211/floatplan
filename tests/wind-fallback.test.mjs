import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var WIND_MODEL_ORDER =');
const end = html.indexOf('// Keep provider gaps honest', start);
assert.ok(start >= 0 && end > start, 'critical wind fallback helpers not found');

const hour = 3600000;
const valueAtMs = (series, atMs) => {
  const span = (series || []).find(row => atMs >= row.startMs && atMs < row.endMs);
  return span ? span.value : null;
};
const state = { gridSeries: { windSpeedKt: [], windGustKt: [], windDirection: [] }, windModelSeries: {} };
const criticalSourceHealth = { wind: 'unavailable', windModels: 'available' };
const context = vm.createContext({ state, criticalSourceHealth, isFinite, Map, Array, Math, valueAtMs });
vm.runInContext(html.slice(start, end), context);

const modelRows = (sustained, gust, direction = 180, count = 3) =>
  Array.from({ length: count }, (_, i) => ({ ms: i * hour, sustained, gust, dir: direction }));

state.windModelSeries = {
  gfs_seamless: modelRows(16, 22),
  ecmwf_ifs025: modelRows(19, 24),
  icon_seamless: modelRows(14, 28, 180, 2) // incomplete: must not qualify
};

const fallback = context.resolveCriticalWindForecast(0, 3 * hour);
assert.equal(fallback.availability, true);
assert.equal(fallback.source, 'fallback');
assert.deepEqual(Array.from(fallback.verdictModels, model => model.modelKey), ['gfs_seamless', 'ecmwf_ifs025']);
assert.equal(fallback.simulationModel.modelKey, 'ecmwf_ifs025',
  'simulator should use the fully covering model with the highest sustained maximum');
const fallbackMetrics = context.windMetricsForResolution(fallback, 0, 3 * hour);
assert.equal(fallbackMetrics.maxSustainedKt, 19);
assert.equal(fallbackMetrics.maxGustKt, 24,
  'a larger gust from a partial-window model must not influence the verdict');
assert.match(context.windResolutionReason(fallback), /GFS, ECMWF/);
assert.doesNotMatch(context.windResolutionReason(fallback), /ICON/);

// Fresh, complete NWS sustained wind remains authoritative, while fallback models may fill a
// genuinely missing NWS gust series so gust protection does not disappear.
state.gridSeries = {
  windSpeedKt: [{ startMs: 0, endMs: 3 * hour, value: 10 }],
  windGustKt: [],
  windDirection: [{ startMs: 0, endMs: 3 * hour, value: 190 }]
};
criticalSourceHealth.wind = 'available';
const nwsPreferred = context.resolveCriticalWindForecast(0, 3 * hour);
assert.equal(nwsPreferred.source, 'nws');
assert.deepEqual(Array.from(nwsPreferred.verdictModels, model => model.modelKey), ['nws']);
assert.equal(nwsPreferred.usesFallbackGust, true);
const nwsMetrics = context.windMetricsForResolution(nwsPreferred, 0, 3 * hour);
assert.equal(nwsMetrics.maxSustainedKt, 10);
assert.equal(nwsMetrics.maxGustKt, 24);
assert.match(context.windResolutionReason(nwsPreferred), /missing gust coverage is supplemented/);

// Neither stale cache nor partial coverage can independently clear the critical wind gate.
criticalSourceHealth.wind = 'unavailable';
criticalSourceHealth.windModels = 'unavailable';
assert.equal(context.resolveCriticalWindForecast(0, 3 * hour).availability, false);
criticalSourceHealth.windModels = 'loading';
assert.equal(context.resolveCriticalWindForecast(0, 3 * hour).availability, 'pending');

assert.match(html, /loadGridpoint, loadWindModels/,
  'fallback models must refresh automatically with the critical sources');
assert.match(html, /wind: windResolution\.availability/,
  'critical availability must consume the resolved NWS-or-model fallback state');

console.log('Wind fallback assertions passed');
