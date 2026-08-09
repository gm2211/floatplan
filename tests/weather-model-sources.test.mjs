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

// 'nws' source: rows returned unchanged (same reference even).
const nwsRows = [nwsRow(0), nwsRow(hour)];
assert.equal(context.applyWeatherSource(nwsRows, 'nws'), nwsRows);

// Missing model series: rows returned unchanged.
state.windModelSeries = {};
assert.equal(context.applyWeatherSource(nwsRows, 'gfs_seamless'), nwsRows);

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

// isThunder recomputed from the WMO code, not left as the NWS value.
state.windModelSeries = {
  gfs_seamless: [
    { ms: 0, tempF: 75, pop: 5, humidity: 50, weatherCode: 95 },   // thunderstorm code
    { ms: hour, tempF: 75, pop: 5, humidity: 50, weatherCode: 3 }  // plain cloudy, not thunder
  ]
};
const thunderRows = context.applyWeatherSource(
  [nwsRow(0, { isThunder: false }), nwsRow(hour, { isThunder: true })], 'gfs_seamless');
assert.equal(thunderRows[0].isThunder, true, 'WMO 95 must flip isThunder true even if NWS said false');
assert.equal(thunderRows[1].isThunder, false, 'a non-thunder WMO code must clear isThunder even if NWS said true');

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

console.log('Weather multi-source assertions passed');
