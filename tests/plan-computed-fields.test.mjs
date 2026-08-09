import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* ============================== Markup: the four echo fields are gone ============================== */
// ETD/ETA/Turn-around/Sunset used to be rendered as disabled inputs that only echoed values the
// app already knew (and looked editable when they weren't). The course output is different — a
// planned course is a genuine planning statement, not a restatement of an input the user typed —
// so it must remain.

const planCardStart = html.indexOf('<section class="card" id="planCard">');
assert.ok(planCardStart >= 0, 'planCard not found');
const planCardEnd = html.indexOf('</section>', planCardStart);
assert.ok(planCardEnd > planCardStart, 'planCard closing tag not found');
const planCardHtml = html.slice(planCardStart, planCardEnd);

['fpEtd', 'fpEta', 'fpTurnaround', 'fpSunset', 'fpPlannedRoute'].forEach(function (id) {
  assert.ok(!planCardHtml.includes('id="' + id + '"'),
    'planCard must no longer render id="' + id + '"');
});
assert.ok(planCardHtml.includes('id="fpPlannedRouteDisplay"'),
  'the visible planned-course output must remain in planCard');

/* ============================== Behavior: print summary reads state, not the DOM ============================== */
// Drive updateFloatPlanAutoFields -> state.planComputed -> buildPrintSummary through the real
// production code (not a re-implementation), with a minimal DOM stub standing in for elements
// the builders still legitimately read (fpPhones, fpCrewCount, fpVesselSelect) or write
// (printSummary). Anything not seeded resolves to null, same as a missing element in production.

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

const elements = {
  fpPhones: { value: '' },
  fpCrewCount: { value: '3' },
  fpPlannedRouteDisplay: { textContent: '' },
  printSummary: { innerHTML: '' }
};
globalThis.document = {
  getElementById: function (id) { return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null; }
};
globalThis.VESSEL_PRESETS = ['AY10', 'AY11'];

globalThis.state = {
  departureMs: Date.parse('2026-07-15T17:00:00-04:00'),
  durationHours: 3,
  sailSim: null,
  slackEvents: [],
  gridSeries: null, curvePoints: [], hourlyRaw: null,
  lastVerdict: null, lastDirectionRec: null, alertsRaw: null, planNarrative: '',
  planComputed: null
};

// Sunset math is covered by its own tests (sunset-policy, twilight-sail-delta); here it only
// needs to hand a deterministic value through updateFloatPlanAutoFields into state.planComputed.
globalThis.twilightTimes = function () { return { sunsetMs: Date.parse('2026-07-15T20:24:00-04:00') }; };
globalThis.getNYParts = function () { return { y: 2026, m: 7, d: 15 }; };
globalThis.PIER25 = { lat: 40.7203, lon: -74.0135 };
// Source-link footer is unrelated to the fields under test here.
globalThis.verificationSources = function () { return []; };

evalLine('function $(id) { return document.getElementById(id); }');
evalLine('function getReturnMs() { return state.departureMs + state.durationHours * 3600000; }');
evalLine("function fmtDateTime(ms) { return fmtTime(ms, { month: 'short', day: 'numeric' }); }");
evalLine('var VERDICT_LABELS = { GO: \'GO\', REEF: \'GO — REEF EXPECTED\', CAUTION: \'CAUTION — ADVISORY\', NOGO: \'NO-GO\' };');

(0, eval)(sliceBetween('function fmtTime(ms, opts) {', 'function fmtDateHeader'));
(0, eval)(sliceBetween('function escapeHtml(s) {', 'function showStaleChip'));
(0, eval)(sliceBetween('// Turn-around instant for the computed plan:', '/* ============================== Computed window summaries'));
(0, eval)(sliceBetween('/* ============================== Computed window summaries', '// Crew line:'));
(0, eval)(sliceBetween('function crewSummaryLine() {', '/* ============================== Float Codes'));
(0, eval)(sliceBetween('function getVesselDisplayName() {', 'function updateVesselCustomVisibility'));
(0, eval)(sliceBetween('function buildPrintSummary(verdict, direction, departureMs, returnMs, maxSustainedKt, maxGustKt) {',
  'function buildObservedNowContext() {'));

const departureMs = state.departureMs;
const returnMs = getReturnMs();
const direction = { initialHeading: 'S' };

// This is the production call site's shape: computed once per plan-window recompute, into
// state rather than onto readonly inputs.
updateFloatPlanAutoFields(direction, departureMs, returnMs);

assert.ok(state.planComputed, 'updateFloatPlanAutoFields must populate state.planComputed');
assert.equal(state.planComputed.route, 'Depart Pier 25 mooring → Hudson South → return');
assert.equal(state.planComputed.etd, fmtDateTime(departureMs));
assert.equal(state.planComputed.eta, fmtDateTime(returnMs));
assert.equal(state.planComputed.turnaround, '~' + fmtTime((departureMs + returnMs) / 2),
  'with no sail-sim result and no slack event, turn-around falls back to the window midpoint');
assert.equal(state.planComputed.sunset, fmtTime(Date.parse('2026-07-15T20:24:00-04:00')));

assert.equal($('fpPlannedRouteDisplay').textContent, state.planComputed.route,
  'the visible course output must still be kept in sync');

// Same trap on the print path: it used to scrape the same four DOM inputs independently.
buildPrintSummary({ level: 'GO', reasons: [] }, direction, departureMs, returnMs, null, null);
const printHtml = elements.printSummary.innerHTML;
assert.ok(printHtml.includes('<strong>Course:</strong> ' + state.planComputed.route),
  'print summary must source the course from state.planComputed, not a DOM input');
assert.ok(printHtml.includes('<strong>ETD:</strong> ' + state.planComputed.etd +
  ' &middot; <strong>Turn-around:</strong> ' + state.planComputed.turnaround +
  ' &middot; <strong>ETA:</strong> ' + state.planComputed.eta),
  'print summary ETD/Turn-around/ETA row must carry real values from state.planComputed');
assert.ok(printHtml.includes('<strong>Sunset:</strong> ' + state.planComputed.sunset),
  'print summary Sunset row must carry a real value from state.planComputed');

// A converged sail-sim turn must flow through to the fallback-free label — the same
// computeTurnaroundMs precedence the plan card used to show via the readonly input.
state.sailSim = { converged: true, turnMs: departureMs + 45 * 60000 };
updateFloatPlanAutoFields(direction, departureMs, returnMs);
assert.equal(state.planComputed.turnaround, '~' + fmtTime(departureMs + 45 * 60000),
  'a converged sail-sim turn must take precedence over the window midpoint');

console.log('Plan computed-fields assertions passed');
