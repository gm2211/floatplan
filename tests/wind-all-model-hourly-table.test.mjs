import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var WIND_MODEL_ORDER =');
const end = html.indexOf('/* ============================== Wind card orchestrator', start);
assert.ok(start >= 0 && end > start, 'wind model + hourly table block not found');

// The placeholder copy this feature replaces must be fully gone.
assert.doesNotMatch(html, /Pick a specific model above/,
  'the "pick a model" hourly-table/summary placeholder must be removed once All renders real data');

const hour = 3600000;

// Minimal fakes for the handful of helpers renderWindHourlyTable calls that live outside the
// sliced region — same approach wind-fallback.test.mjs uses for valueAtMs.
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function degToCompass(deg) {
  if (deg == null || !isFinite(deg)) return '--';
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS16[idx];
}
function vectorMeanDirection(dirValues) {
  if (!dirValues.length) return null;
  let sx = 0, sy = 0;
  dirValues.forEach((d) => { const r = d * Math.PI / 180; sx += Math.sin(r); sy += Math.cos(r); });
  let ang = Math.atan2(sx, sy) * 180 / Math.PI;
  if (ang < 0) ang += 360;
  return ang;
}
function round1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
function fmtTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function windCellClass(sustained, gust, limits) {
  if ((sustained != null && sustained > limits.noGoSustained) || (gust != null && gust > limits.noGoGust)) return 'cell-red';
  if (sustained != null && sustained >= limits.reefLow) return 'cell-yellow';
  return 'cell-green';
}
function parseWindSpeedDisplay(str) {
  if (!str) return null;
  const nums = (String(str).match(/\d+(\.\d+)?/g) || []).map(Number);
  return nums.length ? Math.max(...nums) : null;
}
function valueAtMs(series, atMs) {
  for (const span of series) { if (atMs >= span.startMs && atMs < span.endMs) return span.value; }
  return null;
}

// Fake DOM: just enough element shape ($ / showEl / hideEl / classList) for the render
// function to write into and for assertions to read back out of.
function makeEl() {
  return {
    innerHTML: '', textContent: '',
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } }
  };
}
const elements = {
  windSummary: makeEl(), windTableHeadRow: makeEl(), windTableBody: makeEl(), windApproxNote: makeEl()
};
function $(id) { return elements[id]; }
function showEl(el) { el.classList.remove('hidden'); }
function hideEl(el) { el.classList.add('hidden'); }

const state = { windModel: 'all', gridSeries: null, windModelSeries: {} };
const limits = { reefLow: 15, reefHigh: 18, noGoSustained: 20, noGoGust: 25 };

const context = vm.createContext({
  state, degToCompass, vectorMeanDirection, round1, fmtTime, escapeHtml, windCellClass,
  parseWindSpeedDisplay, valueAtMs, KT_PER_MPH: 0.868976, $, showEl, hideEl,
  Object, Array, Math, Date, Intl, isFinite
});
vm.runInContext(html.slice(start, end), context);

// Six hours, 0..5. NWS and GFS have full coverage; ECMWF is missing hour 3; ICON has no data
// at all — this exercises both a partial-coverage model and a fully-absent one.
state.gridSeries = {
  windSpeedKt: Array.from({ length: 6 }, (_, i) => ({ startMs: i * hour, endMs: (i + 1) * hour, value: 10 + i })),
  windGustKt: Array.from({ length: 6 }, (_, i) => ({ startMs: i * hour, endMs: (i + 1) * hour, value: 15 + i })),
  windDirection: Array.from({ length: 6 }, (_, i) => ({ startMs: i * hour, endMs: (i + 1) * hour, value: 180 }))
};
state.windModelSeries = {
  gfs_seamless: Array.from({ length: 6 }, (_, i) => ({ ms: i * hour, sustained: 20 + i, gust: 25 + i, dir: 190 })),
  ecmwf_ifs025: [0, 1, 2, 4, 5].map((i) => ({ ms: i * hour, sustained: 30 + i, gust: 35 + i, dir: 200 })),
  icon_seamless: []
};

const departureMs = 2 * hour, returnMs = 4 * hour; // winStart=0, winEnd=6*hour

// --- All models: renders a column per model -------------------------------------------
state.windModel = 'all';
context.renderWindHourlyTable([], departureMs, returnMs, limits, null, null);

const headHtml = elements.windTableHeadRow.innerHTML;
assert.match(headHtml, /<th>Time<\/th>/, 'All view keeps a leading Time column');
['NWS', 'GFS', 'ECMWF', 'ICON'].forEach((label) => {
  assert.ok(headHtml.includes('>' + label + '<') || new RegExp(label + '</th>').test(headHtml),
    `All header must name ${label}`);
});
const headerOrder = ['NWS', 'GFS', 'ECMWF', 'ICON'].map((l) => headHtml.indexOf(l));
assert.ok(headerOrder.every((idx, i) => i === 0 || idx > headerOrder[i - 1]),
  'model columns must appear in NWS, GFS, ECMWF, ICON order');

const bodyHtml = elements.windTableBody.innerHTML;
const rowCount = (bodyHtml.match(/<tr>/g) || []).length;
assert.equal(rowCount, 6, 'one row per hour in the union of all models\' coverage (0..5)');
const cellsPerRow = (bodyHtml.match(/wind-all-cell/g) || []).length;
assert.equal(cellsPerRow, 6 * 4, 'each row must carry exactly one cell per model');

assert.doesNotMatch(elements.windSummary.textContent, /Pick a specific model/,
  'summary line must no longer tell the user to pick a model when All can render the table');
assert.match(elements.windSummary.textContent, /Sustained/, 'All summary should still be informative');

// --- Missing model data renders an em-dash, not blank/NaN -----------------------------
// ICON never has data: every one of its six cells must be the em-dash placeholder.
const iconCellPattern = /wind-all-cell[^>]*--model-color:var\(--navy\)"><span class="wind-all-sustained">([^<]*)<\/span><span class="wind-all-gust">([^<]*)<\/span>/g;
let iconMatches = [...bodyHtml.matchAll(iconCellPattern)];
assert.equal(iconMatches.length, 6, 'ICON column present in all 6 rows');
iconMatches.forEach((m) => {
  assert.equal(m[1], '—', 'ICON sustained cell must render an em-dash when the model has no data');
  assert.equal(m[2], '—', 'ICON gust cell must render an em-dash when the model has no data');
});

// ECMWF is missing hour 3 (ms = 3*hour) specifically — that one row's ECMWF cell must be a
// placeholder while hour 3 for NWS/GFS (which do have data there) is not.
const rows = bodyHtml.split('<tr>').slice(1);
const hour3Row = rows.find((r) => r.startsWith('<td>' + fmtTime(3 * hour) + '</td>'));
assert.ok(hour3Row, 'hour-3 row must exist (NWS and GFS both have data there)');
const ecmwfCellMatch = hour3Row.match(/--model-color:var\(--orange\)"><span class="wind-all-sustained">([^<]*)<\/span><span class="wind-all-gust">([^<]*)<\/span>/);
assert.ok(ecmwfCellMatch, 'ECMWF cell must be present (as a placeholder) even without data for this hour');
assert.equal(ecmwfCellMatch[1], '—', 'ECMWF sustained must be an em-dash for its missing hour');
const nwsCellMatch = hour3Row.match(/--model-color:var\(--accent\)"><span class="wind-all-sustained">([^<]*)<\/span>/);
assert.equal(nwsCellMatch[1], '13.0', 'NWS (which has hour-3 data) must show its real value, not a placeholder');

// --- Single model view still renders its original four columns ------------------------
state.windModel = 'nws';
context.renderWindHourlyTable([], departureMs, returnMs, limits, null, null);

assert.equal(elements.windTableHeadRow.innerHTML, '<th>Time</th><th>Dir</th><th class="num">Sustained</th><th class="num">Gust</th>',
  'switching back to a single model must restore the original 4-column header');
const singleBody = elements.windTableBody.innerHTML;
const singleRowCount = (singleBody.match(/<tr/g) || []).length;
assert.equal(singleRowCount, 6, 'single-model table still has one row per covered hour');
const singleCellCount = (singleBody.match(/<td/g) || []).length;
assert.equal(singleCellCount, 6 * 4, 'single-model rows keep exactly four cells: time, dir, sustained, gust');
assert.doesNotMatch(singleBody, /wind-all-cell/, 'single-model view must not use the All comparison-cell markup');
assert.match(singleBody, /cell-(green|yellow|red)/, 'single-model rows keep their hazard-color class');

console.log('Wind All-models hourly table assertions passed');
