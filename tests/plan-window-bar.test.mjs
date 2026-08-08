import assert from 'node:assert/strict';
import fs from 'node:fs';

// Regression guard for the "departure/duration only reachable from the Plan tab" bug: the
// plan-window controls (departure + duration) are GLOBAL state that drives every tab's charts,
// so they must live in a strip outside #app entirely — never inside a tab-filtered card — so
// MOBILE_TABS/CARD_ORDER tab filtering (.mtab-hidden) can never hide them.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const topbarIdx = html.indexOf('class="topbar"');
const planWindowBarIdx = html.indexOf('id="planWindowBar"');
const mainAppIdx = html.indexOf('<main id="app">');
assert.ok(topbarIdx >= 0 && planWindowBarIdx >= 0 && mainAppIdx >= 0,
  'topbar, planWindowBar, and #app must all be present');

// The strip must sit in the chrome area — after the topbar, but entirely outside <main id="app">
// — so no tab-filtering code that only ever walks #app's children can reach it.
assert.ok(planWindowBarIdx > topbarIdx, 'planWindowBar must come after the topbar in the DOM');
assert.ok(planWindowBarIdx < mainAppIdx, 'planWindowBar must sit outside/above <main id="app">, not inside it');

// It must not be a .card (that styling and DOM role is reserved for tab content).
assert.doesNotMatch(html, /<div class="card plan-window-bar"|<div class="plan-window-bar card"/,
  'plan-window-bar must not double as a .card');
assert.match(html, /<div class="plan-window-bar" id="planWindowBar">/,
  'plan-window-bar must be a plain chrome container, not a <section class="card">');

// It must never be enrolled in tab filtering or the column-balancing reflow — both keyed off
// these two arrays exclusively by id.
const mobileTabsBlock = html.match(/var MOBILE_TABS = \[([\s\S]*?)\];/)[1];
assert.doesNotMatch(mobileTabsBlock, /planWindowBar/,
  'planWindowBar must never be assigned to a MOBILE_TABS tab — it would then get .mtab-hidden on every other tab');
const cardOrderBlock = html.match(/var CARD_ORDER = \[([\s\S]*?)\];/)[1];
assert.doesNotMatch(cardOrderBlock, /planWindowBar/,
  'planWindowBar must never be in CARD_ORDER — that array is appendChild-ed into #columnsRow, which would move it inside #app');

// planCard (Sail Plan, a Plan-tab-only card) must no longer contain the departure/duration
// controls — they were moved out, not duplicated.
const planCardStart = html.indexOf('<section class="card" id="planCard">');
const planCardEnd = html.indexOf('</section>', planCardStart);
assert.ok(planCardStart >= 0 && planCardEnd > planCardStart, 'planCard must still exist');
const planCardHtml = html.slice(planCardStart, planCardEnd);
assert.doesNotMatch(planCardHtml, /id="departureInput"/, 'departureInput must have moved out of planCard');
assert.doesNotMatch(planCardHtml, /id="durationChips"/, 'durationChips must have moved out of planCard');
assert.doesNotMatch(planCardHtml, /id="customDurationRow"/, 'customDurationRow must have moved out of planCard');
// sunsetPolicy is advisory status about the chosen departure, not a control — it stays put.
assert.match(planCardHtml, /id="sunsetPolicy"/, 'sunsetPolicy must remain in planCard');
assert.match(planCardHtml, /id="fpVesselSelect"/, 'the vessel/crew form-grid must remain in planCard');

// The moved controls must still carry their exact original ids (nothing renamed) — the JS
// wiring ($('departureInput') etc.) and the departure-meridiem/sunset-policy tests depend on
// these exact strings existing somewhere in the document.
for (const id of ['departureInput', 'durationChips', 'customDurationInput', 'customDurationRow']) {
  assert.match(html, new RegExp('id="' + id + '"'), id + ' must still exist in the document');
}
assert.match(html, /data-meridiem="am"/);
assert.match(html, /data-meridiem="pm"/);

console.log('Plan-window-bar placement assertions passed');
