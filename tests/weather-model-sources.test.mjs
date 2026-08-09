import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// --- Regression: the Open-Meteo request and cache namespace changes are actually present ---
assert.match(html, /temperature_2m/, 'WINDMODELS_URL must request temperature_2m');
assert.match(html, /precipitation_probability/, 'WINDMODELS_URL must request precipitation_probability');
assert.match(html, /weather_code/, 'WINDMODELS_URL must request weather_code');
assert.match(html, /temperature_unit=fahrenheit/, 'WINDMODELS_URL must request fahrenheit temperatures');
assert.match(html, /windmodels-v3/, 'cache namespace must be bumped to v3 for the new response shape');

// --- Slice: wmoCodeToTag/wmoCodeToText + weather-source override + spread helpers -----------
const start = html.indexOf('function classifyConditionTag');
const end = html.indexOf('/* ============================== Weather temperature curve (SVG)', start);
assert.ok(start >= 0 && end > start, 'weather source/spread helpers block not found');

const state = { windModelSeries: {} };
const WIND_FALLBACK_MODEL_ORDER = ['gfs_seamless', 'ecmwf_ifs025', 'icon_seamless'];
const context = vm.createContext({ state, WIND_FALLBACK_MODEL_ORDER, Object, Math, isFinite });
vm.runInContext(html.slice(start, end), context);

/* ============================== wmoCodeToTag / wmoCodeToText ============================== */

assert.equal(context.wmoCodeToTag(0, true), 'sun');
assert.equal(context.wmoCodeToTag(0, false), 'moon', 'code 0 at night must map to moon, not sun');
assert.equal(context.wmoCodeToTag(1, true), 'partly-day');
assert.equal(context.wmoCodeToTag(2, false), 'partly-night');
assert.equal(context.wmoCodeToTag(3, true), 'cloud');
assert.equal(context.wmoCodeToTag(45, true), 'fog');
assert.equal(context.wmoCodeToTag(48, true), 'fog');
assert.equal(context.wmoCodeToTag(55, true), 'drizzle');
assert.equal(context.wmoCodeToTag(63, true), 'rain');
assert.equal(context.wmoCodeToTag(82, true), 'rain');
assert.equal(context.wmoCodeToTag(73, true), 'snow');
assert.equal(context.wmoCodeToTag(86, true), 'snow');
assert.equal(context.wmoCodeToTag(96, true), 'thunderstorm');
assert.equal(context.wmoCodeToTag(999, true), null, 'unknown code must return null so the caller falls back to the NWS tag');
assert.equal(context.wmoCodeToTag(null, true), null);

assert.equal(context.wmoCodeToText(0), 'Clear');
assert.equal(context.wmoCodeToText(2), 'Partly cloudy');
assert.equal(context.wmoCodeToText(3), 'Cloudy');
assert.equal(context.wmoCodeToText(45), 'Fog');
assert.equal(context.wmoCodeToText(55), 'Light rain');
assert.equal(context.wmoCodeToText(63), 'Rain');
assert.equal(context.wmoCodeToText(73), 'Snow');
assert.equal(context.wmoCodeToText(99), 'Thunderstorms');
assert.equal(context.wmoCodeToText(999), null);

/* ============================== applyWeatherSource ============================== */

const hour = 3600000;
function nwsRow(ms, overrides) {
  return Object.assign({
    ms: ms, endMs: ms + hour, isDaytime: true, tempF: 70, pop: 10, humidity: 50,
    shortForecast: 'Sunny', tag: 'sun', isThunder: false
  }, overrides || {});
}

// 'nws' source: field values pass through unchanged, but baseTempF/basePop are stamped from
// the row's own tempF/pop so weatherSpreadForRow always has an NWS baseline to compare against.
const nwsRows = [nwsRow(0), nwsRow(hour)];
const nwsPassthrough = context.applyWeatherSource(nwsRows, 'nws');
assert.equal(nwsPassthrough[0].tempF, 70);
assert.equal(nwsPassthrough[0].pop, 10);
assert.equal(nwsPassthrough[0].baseTempF, 70, 'nws passthrough must stamp baseTempF from the row tempF');
assert.equal(nwsPassthrough[0].basePop, 10, 'nws passthrough must stamp basePop from the row pop');

// Missing model series: field values pass through unchanged, base fields still stamped.
state.windModelSeries = {};
const missingSeries = context.applyWeatherSource(nwsRows, 'gfs_seamless');
assert.equal(missingSeries[0].tempF, 70);
assert.equal(missingSeries[0].baseTempF, 70, 'missing-series path must stamp baseTempF from the row tempF');
assert.equal(missingSeries[0].basePop, 10, 'missing-series path must stamp basePop from the row pop');

// Model covers hour 0 only; hour 1 (3600000) has no sample and must keep its NWS values.
state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 81, pop: 40, humidity: 60, weatherCode: 61 }]
};
const overridden = context.applyWeatherSource([nwsRow(0), nwsRow(hour)], 'gfs_seamless');
assert.equal(overridden[0].tempF, 81, 'tempF must be overridden from the model sample');
assert.equal(overridden[0].pop, 40, 'pop must be overridden from the model sample');
assert.equal(overridden[0].humidity, 60, 'humidity must be overridden from the model sample');
assert.equal(overridden[0].tag, 'rain', 'tag must come from the WMO code mapping');
assert.equal(overridden[0].shortForecast, 'Rain');
assert.equal(overridden[1].tempF, 70, 'hour with no model sample must keep the NWS tempF');
assert.equal(overridden[1].pop, 10, 'hour with no model sample must keep the NWS pop');
assert.equal(overridden[1].tag, 'sun', 'hour with no model sample must keep the NWS tag');

// isThunder recomputed from the WMO code, not left as the NWS value — except when the model
// sample's weatherCode is null, in which case the NWS isThunder flag must be preserved rather
// than silently wiped to false.
state.windModelSeries = {
  gfs_seamless: [
    { ms: 0, tempF: 75, pop: 5, humidity: 50, weatherCode: 95 },      // thunderstorm code
    { ms: hour, tempF: 75, pop: 5, humidity: 50, weatherCode: 3 },    // plain cloudy, not thunder
    { ms: 2 * hour, tempF: 75, pop: 5, humidity: 50, weatherCode: null } // sample present, no code
  ]
};
const thunderRows = context.applyWeatherSource(
  [nwsRow(0, { isThunder: false }), nwsRow(hour, { isThunder: true }), nwsRow(2 * hour, { isThunder: true })],
  'gfs_seamless');
assert.equal(thunderRows[0].isThunder, true, 'WMO 95 must flip isThunder true even if NWS said false');
assert.equal(thunderRows[1].isThunder, false, 'a non-thunder WMO code must clear isThunder even if NWS said true');
assert.equal(thunderRows[2].isThunder, true, 'a null weatherCode must keep the NWS isThunder flag, not wipe it to false');

/* ============================== weatherSpreadForRow / weatherSpreadLabel ============================== */

state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 71, pop: 12 }],
  ecmwf_ifs025: [{ ms: 0, tempF: 70, pop: 8 }],
  icon_seamless: [{ ms: 0, tempF: null, pop: null }] // present sample but no usable values
};
const agree = context.weatherSpreadForRow(nwsRow(0, { tempF: 70, pop: 10 }));
assert.equal(agree.tempSpreadF, 1, 'temps within 1 degree must not read as a wide spread');
assert.equal(agree.popSpreadPct, 4);
assert.equal(context.weatherSpreadLabel(agree), null, 'no flag when sources agree');

state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 86, pop: 10 }],
  ecmwf_ifs025: [{ ms: 0, tempF: 81, pop: 12 }],
  icon_seamless: [{ ms: 0, tempF: null, pop: null }]
};
const tempSplit = context.weatherSpreadForRow(nwsRow(0, { tempF: 82, pop: 11 }));
assert.equal(tempSplit.tempSpreadF, 5, 'range >= 4F must be flagged');
assert.match(context.weatherSpreadLabel(tempSplit), /°/, 'temperature spread label must include a degree sign');

state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 70, pop: 70 }],
  ecmwf_ifs025: [{ ms: 0, tempF: 71, pop: 10 }],
  icon_seamless: [{ ms: 0, tempF: null, pop: null }]
};
const popSplit = context.weatherSpreadForRow(nwsRow(0, { tempF: 70, pop: 40 }));
assert.equal(popSplit.popSpreadPct, 60, 'rain-probability range >= 30 must be flagged');
assert.equal(context.weatherSpreadLabel(popSplit), 'rain split');

// A source with a null value must be excluded from the min/max entirely, not treated as 0 —
// icon_seamless above has a sample object but null tempF/pop and must never pull a spread down.
state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 70, pop: 10 }],
  ecmwf_ifs025: [{ ms: 0, tempF: null, pop: null }],
  icon_seamless: [{ ms: 0, tempF: null, pop: null }]
};
const nullIgnored = context.weatherSpreadForRow(nwsRow(0, { tempF: 71, pop: 11 }));
assert.equal(nullIgnored.tempSpreadF, 1, 'null-valued sources must be excluded, not counted as 0');
assert.equal(nullIgnored.sourceCount, 2, 'only sources with an actual value count toward sourceCount');

// sourceCount must not be inflated: with NWS plus exactly three models all having data for the
// hour, sourceCount === 4 no matter which source is currently selected in the UI.
state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 74, pop: 20, humidity: 55, weatherCode: 3 }],
  ecmwf_ifs025: [{ ms: 0, tempF: 73, pop: 18, humidity: 55, weatherCode: 3 }],
  icon_seamless: [{ ms: 0, tempF: 72, pop: 22, humidity: 55, weatherCode: 3 }]
};
const fourSourceNwsRow = context.applyWeatherSource([nwsRow(0, { tempF: 70, pop: 10 })], 'nws')[0];
const fourSourceGfsRow = context.applyWeatherSource([nwsRow(0, { tempF: 70, pop: 10 })], 'gfs_seamless')[0];
assert.equal(context.weatherSpreadForRow(fourSourceNwsRow).sourceCount, 4, 'NWS + 3 models with data must count as 4 sources under the nws chip');
assert.equal(context.weatherSpreadForRow(fourSourceGfsRow).sourceCount, 4, 'NWS + 3 models with data must still count as 4 sources under a non-nws chip');

// Regression for the model-agreement contamination defect: the spread reported for a given hour
// must be identical whichever source chip is selected, because weatherSpreadForRow always reads
// the NWS baseline from baseTempF/basePop rather than the (possibly overridden) tempF/pop.
state.windModelSeries = {
  gfs_seamless: [{ ms: 0, tempF: 84, pop: 45, humidity: 55, weatherCode: 61 }],
  ecmwf_ifs025: [{ ms: 0, tempF: 80, pop: 40, humidity: 55, weatherCode: 61 }],
  icon_seamless: [{ ms: 0, tempF: 78, pop: 35, humidity: 55, weatherCode: 61 }]
};
const baseRowForAgreement = nwsRow(0, { tempF: 70, pop: 10 });
const spreadUnderNws = context.weatherSpreadForRow(context.applyWeatherSource([baseRowForAgreement], 'nws')[0]);
const spreadUnderGfs = context.weatherSpreadForRow(context.applyWeatherSource([baseRowForAgreement], 'gfs_seamless')[0]);
assert.equal(spreadUnderGfs.tempSpreadF, spreadUnderNws.tempSpreadF, 'tempSpreadF must be identical regardless of the selected source chip');
assert.equal(spreadUnderGfs.popSpreadPct, spreadUnderNws.popSpreadPct, 'popSpreadPct must be identical regardless of the selected source chip');
assert.equal(spreadUnderGfs.sourceCount, spreadUnderNws.sourceCount, 'sourceCount must be identical regardless of the selected source chip');
assert.equal(spreadUnderNws.tempSpreadF, 84 - 70, 'NWS baseline (70) must always anchor the spread, not the overridden GFS tempF');

console.log('Weather multi-source assertions passed');
