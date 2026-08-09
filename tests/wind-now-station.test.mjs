import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Wind headline used to hardcode Robbins Reef, so selecting Willy Wall produced a card
// that read "8.2 kt ... Observed - Robbins Reef" above Willy Wall's six-hour-old timestamp:
// one station's number spliced onto another station's clock. These tests pin the headline to
// the selected station, and pin stale readings out of the go/no-go color.

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const pickerStart = html.indexOf('var OBS_WIND_STATION_LABELS');
const pickerEnd = html.indexOf('var OBS_CURRENT_REFERENCES', pickerStart);
assert.ok(pickerStart >= 0 && pickerEnd > pickerStart, 'observed wind station picker block not found');

const nowStart = html.indexOf('var OBS_WIND_FRESH_MS');
const nowEnd = html.indexOf('/* ============================== Wind card: model switcher', nowStart);
assert.ok(nowStart >= 0 && nowEnd > nowStart, 'wind headline block not found');

// --- minimal DOM/util stubs -------------------------------------------------------------
const nodes = {};
function makeNode(id) {
  const classes = new Set();
  return {
    id,
    textContent: '',
    innerHTML: '',
    attrs: {},
    title: '',
    hidden: false,
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
    },
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
    querySelectorAll: () => []
  };
}
['windNowValue', 'windNowDir', 'windNowCaption', 'windObsDeltaNote', 'obsWindRow',
  'obsStationWeatherflowChip', 'obsWindStationRow'].forEach(id => { nodes[id] = makeNode(id); });

globalThis.$ = id => nodes[id] || null;
globalThis.setText = (id, text) => { if (nodes[id]) nodes[id].textContent = text; };
globalThis.showEl = el => { el.hidden = false; };
globalThis.hideEl = el => { el.hidden = true; };
globalThis.escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
globalThis.round1 = v => Math.round(v * 10) / 10;
globalThis.degToCompass = deg => (deg == null ? '' : 'NNW');
globalThis.fmtTime = ms => new Date(ms).toISOString().slice(11, 16);
globalThis.windCellClass = () => 'cell-green';
globalThis.nearestSeriesValue = () => null;
globalThis.valueAtMs = () => null;
globalThis.lsSetJSON = () => {};
globalThis.rerenderWindCard = () => {};
globalThis.DEFAULT_LIMITS = {};
globalThis.WILLY_WALL_SOURCE_URL = 'https://www.wunderground.com/dashboard/pws/KNJNEWJE43';

const NOW = Date.parse('2026-08-09T17:52:00Z');
const REAL_NOW = Date.now;
Date.now = () => NOW;

globalThis.state = { obsWindStation: 'robbinsReef', settings: null, gridSeries: null };

(0, eval)(html.slice(pickerStart, pickerEnd));
(0, eval)(html.slice(nowStart, nowEnd));

const freshRobbins = { ms: NOW - 10 * 60000, sustainedKt: 8.2, gustKt: 14.4, dirDeg: 341, dirCardinal: 'NNW' };
const staleWilly = { ms: NOW - 368 * 60000, sustainedKt: 5.1, gustKt: 9.3, dirDeg: 300, dirCardinal: null };
state.observedRaw = { wind: freshRobbins, windHistory: [freshRobbins] };
state.obsWindWeatherflowRaw = staleWilly;

// Robbins Reef selected: unchanged live behavior.
renderWindNow({});
assert.match(nodes.windNowCaption.textContent, /^Observed · Robbins Reef · as of /);
assert.ok(nodes.windNowValue.classList.contains('cell-green'), 'a fresh reading keeps its limits color');
assert.ok(!nodes.windNowValue.classList.contains('is-stale'));

// Willy Wall selected: the headline must switch stations, not keep Robbins Reef's number.
state.obsWindStation = 'weatherflow';
renderWindNow({});
assert.match(nodes.windNowCaption.textContent, /Willy Wall/,
  'the headline must name the selected station');
assert.doesNotMatch(nodes.windNowCaption.textContent, /Robbins Reef/,
  'the headline must not attribute the reading to an unselected station');
assert.match(nodes.windNowValue.innerHTML, /5\.1/,
  "the headline must show the selected station's own reading");
assert.doesNotMatch(nodes.windNowValue.innerHTML, /8\.2/);

// A six-hour-old reading is history: it keeps its number but loses the go/no-go color and
// says how old it is, so it cannot be read as live conditions.
assert.ok(nodes.windNowValue.classList.contains('is-stale'), 'a stale reading must drop its limits color');
assert.ok(!nodes.windNowValue.classList.contains('cell-green'));
assert.match(nodes.windNowCaption.textContent, /last reading .*368m ago/,
  'a stale headline must carry its age');

// Nothing at all from the selected station reads as unavailable for that station.
state.obsWindWeatherflowRaw = null;
renderWindNow({});
assert.equal(nodes.windNowCaption.textContent, 'Observed · Willy Wall · unavailable');
assert.equal(nodes.windNowValue.textContent, '—');

// The chip flags staleness, not merely a failed request: the WU feed keeps answering while
// its anemometer is faulted, so "the fetch worked" is not "the station is reporting".
updateWillyWallChipState(staleWilly);
assert.ok(nodes.obsStationWeatherflowChip.classList.contains('station-unavailable'),
  'a station with no current reading must be flagged on the chip');
assert.match(nodes.obsStationWeatherflowChip.title, /not reporting wind right now/);
updateWillyWallChipState(freshRobbins);
assert.ok(!nodes.obsStationWeatherflowChip.classList.contains('station-unavailable'));
updateWillyWallChipState(null);
assert.match(nodes.obsStationWeatherflowChip.title, /could not be loaded/);

// The meta row points at the source dashboard whenever there is no live number, whether the
// feed died or merely went quiet.
state.obsWindWeatherflowRaw = staleWilly;
renderObsWindRow({});
assert.match(nodes.obsWindRow.innerHTML, /No current reading &middot; check source/);
assert.match(nodes.obsWindRow.innerHTML, /last reading .*368m ago/);
state.obsWindWeatherflowRaw = null;
renderObsWindRow({});
assert.match(nodes.obsWindRow.innerHTML, /Live feed unavailable &middot; check source/);
state.obsWindStation = 'robbinsReef';
renderObsWindRow({});
assert.doesNotMatch(nodes.obsWindRow.innerHTML, /check source/,
  'Robbins Reef must not borrow the Willy Wall failure notice');
assert.match(nodes.obsWindRow.innerHTML, /as of /);

Date.now = REAL_NOW;
console.log('wind-now-station tests passed');
