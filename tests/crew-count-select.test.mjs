import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* ============================== Markup ============================== */
// The crew-count control moved from a spinner <input type="number"> to a native <select> so it
// renders as the platform's real scrolling-wheel picker (iOS Safari's spinning wheel, macOS
// Safari/Android Chrome/Windows Chrome's own idiomatic dropdown) instead of a bespoke widget.

const planCardStart = html.indexOf('<section class="card" id="planCard">');
assert.ok(planCardStart >= 0, 'planCard not found');
const planCardEnd = html.indexOf('</section>', planCardStart);
assert.ok(planCardEnd > planCardStart, 'planCard closing tag not found');
const planCardHtml = html.slice(planCardStart, planCardEnd);

assert.ok(!/<input[^>]*id="fpCrewCount"/.test(planCardHtml),
  'fpCrewCount must no longer render as a spinner <input>');
assert.ok(planCardHtml.includes('<label for="fpCrewCount">Crew (excl. skipper)</label>'),
  'the label text and its for-target must be unchanged');

const selectMatch = /<select id="fpCrewCount">([\s\S]*?)<\/select>/.exec(planCardHtml);
assert.ok(selectMatch, 'fpCrewCount must render as a native <select>');
const options = [...selectMatch[1].matchAll(/<option value="(\d+)">(\d+)<\/option>/g)];
assert.deepEqual(options.map((m) => m[1]), Array.from({ length: 13 }, (_, i) => String(i)),
  'fpCrewCount must offer exactly options 0 through 12, matching the old input min=0 max=12');
options.forEach((m) => assert.equal(m[1], m[2], 'each option value must match its visible label'));

/* ============================== Behavior harness ============================== */
// Node has no DOM, so loadFloatPlanFields/crewSummaryLine/buildFloatCodePlan are exercised
// against a minimal document/localStorage stub, same pattern as plan-computed-fields.test.mjs
// and plan-code.test.mjs — the production functions run unmodified via eval'd source slices.

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return html.slice(start, end);
}

function evalLine(exactText) {
  assert.ok(html.includes(exactText), `expected production line not found: ${exactText}`);
  (0, eval)(exactText);
}

function makeEl(value) {
  return { value: value, addEventListener: function () {}, classList: { toggle: function () {} } };
}

let elements = {};
let storage = {};
globalThis.document = {
  getElementById: function (id) {
    return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null;
  }
};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function (k, v) { storage[k] = v; }
};
globalThis.LS_PREFIX = 'fp25.';
globalThis.VESSEL_PRESETS = ['AY10', 'AY11'];

evalLine('function $(id) { return document.getElementById(id); }');
evalLine("var FLOATPLAN_FIELDS = ['fpVesselSelect', 'fpVesselName', 'fpCrewCount', 'fpPhones'];");
(0, eval)(sliceBetween('function lsGetJSON(key, fallback, requireObject) {', '/* ================================ Fetch layer'));
(0, eval)(sliceBetween('function getVesselDisplayName() {', 'function atlanticYachtingStartWeather'));

function freshElements() {
  elements = {
    fpVesselSelect: makeEl('AY10'), fpVesselName: makeEl(''),
    fpCrewCount: makeEl(''), fpPhones: makeEl(''), fpVesselCustomRow: makeEl('')
  };
}

// An in-range saved value selects the matching option.
freshElements();
storage['fp25.floatplan'] = JSON.stringify({ fpVesselSelect: 'AY10', fpCrewCount: '5', fpPhones: '' });
loadFloatPlanFields();
assert.equal(elements.fpCrewCount.value, '5', 'an in-range saved crew count must restore to that option');

// An out-of-range saved value (outside 0-12) lands deliberately on '0', not on whatever a
// <select> happens to do internally when assigned a value matching no <option>.
freshElements();
storage['fp25.floatplan'] = JSON.stringify({ fpCrewCount: '17' });
loadFloatPlanFields();
assert.equal(elements.fpCrewCount.value, '0', 'an out-of-range saved crew count must fall back to 0, not silently misbehave');

// A malformed/non-integer leftover from an older save (e.g. a stray decimal) also falls back.
freshElements();
storage['fp25.floatplan'] = JSON.stringify({ fpCrewCount: '3.5' });
loadFloatPlanFields();
assert.equal(elements.fpCrewCount.value, '0', 'a non-integer saved crew count must fall back to 0');

freshElements();
storage['fp25.floatplan'] = JSON.stringify({ fpCrewCount: 'abc' });
loadFloatPlanFields();
assert.equal(elements.fpCrewCount.value, '0', 'garbage saved crew count must fall back to 0');

// No saved plan at all (first-ever visit) must not throw and must land on the same deliberate default.
freshElements();
storage = {};
loadFloatPlanFields();
assert.equal(elements.fpCrewCount.value, '0', 'a missing saved crew count must default to 0');

/* ============================== crewSummaryLine ============================== */
(0, eval)(sliceBetween('function crewSummaryLine() {', '/* ============================== Float Codes'));

elements = { fpCrewCount: { value: '4' } };
assert.equal(crewSummaryLine(), '4 crew + 1 skipper (5 aboard)',
  'crewSummaryLine must render identically for a <select>-sourced string value');

elements = { fpCrewCount: { value: '0' } };
assert.equal(crewSummaryLine(), '0 crew + 1 skipper (1 aboard)');

elements = { fpCrewCount: { value: '12' } };
assert.equal(crewSummaryLine(), '12 crew + 1 skipper (13 aboard)');

/* ============================== Plan Code round-trip ============================== */
// buildFloatCodePlan reads $('fpCrewCount').value straight off the DOM (now the <select>), then
// encodeFloatCode/decodeFloatCode must carry that string through unchanged.
(0, eval)(sliceBetween('var FLOAT_CODE_PREFIX = \'FP2\';', 'function renderPlanCodePreview'));

globalThis.state = {
  lastDirectionRec: { initialHeading: 'S' },
  departureMs: Date.parse('2026-07-15T15:00:00-04:00'),
  durationHours: 3
};
elements = { fpVesselSelect: { value: 'AY10' }, fpVesselName: { value: '' }, fpCrewCount: { value: '7' } };

const builtPlan = buildFloatCodePlan();
assert.equal(builtPlan.crewCount, '7', 'buildFloatCodePlan must read the select value straight off the DOM');
const roundTripCode = encodeFloatCode(builtPlan);
const roundTripDecoded = decodeFloatCode(roundTripCode);
assert.equal(roundTripDecoded.crewCount, '7', 'the select-sourced crew count must survive the Plan Code round-trip');

/* ============================== Reaches the Atlantic Yachting filing payload ============================== */
// buildAtlanticYachtingFloatPlan's `writtenPlan` field (the text actually submitted to the Club)
// is composeTemplateNarrative(buildPlanNarrativeContext()); buildPlanNarrativeContext sources
// ctx.vessel.crewCount via vesselField('fpCrewCount') — i.e. the very same DOM element. Exercise
// composeTemplateNarrative directly with a select-sourced crew value (bypassing the weather/tide
// plumbing buildPlanNarrativeContext also needs, which is unrelated to this control) to confirm
// the value still flows into the checked-in-aboard line that ships in the filing payload.
(0, eval)(sliceBetween('function composeTemplateNarrative(ctx) {', 'function buildNarrativePromptText'));
globalThis.DEFAULT_LIMITS = { reefLow: 15, reefHigh: 18, noGoSustained: 20, noGoGust: 25 };

elements = { fpCrewCount: { value: '2' } };
const narrative = composeTemplateNarrative({ vessel: { name: 'AY10', crewCount: elements.fpCrewCount.value, phone: null } });
assert.ok(narrative.includes('AY10 · 3 aboard (skipper + 2 crew)'),
  'the select-sourced crew count must reach the narrative text that is submitted as the Club filing\'s writtenPlan');

console.log('Crew-count <select> markup and behavior assertions passed');
