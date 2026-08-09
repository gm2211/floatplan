import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* ============================== Change 1: compare is gone ============================== */
// The whole plan-comparison feature (baseline set from a loaded Plan Code, "Compared with
// current conditions" block, verdict/wind diff table, "Stop comparing") must be gone. The
// Monitor feature (a different thing — it watches live conditions for the CURRENT plan) is
// pinned separately below and must be untouched.

for (const needle of [
  'renderSharedPlanComparison', 'clearSharedPlanComparison',
  'comparisonWindText', 'function sameLimits', 'id="sharedPlanComparison"',
  'shared-plan-comparison', 'comparison-state', 'comparison-list',
  'Compared with current conditions', 'No material change', 'Stop comparing',
  'Plan Code comparison', 'Schedule changed', 'clearSharedComparisonBtn',
  'sharePlanPanel', 'share-plan-panel', 'sharePlanSwitcher', 'share-plan-switcher',
  'sharePlanBtn', 'checkPlanBtn', 'generatedPlanCode', 'closePlanCodeBtn',
  'setPlanCodeMode', 'openPlanCodePanel(', 'closePlanCodePanel(', 'FLOAT_CODE_TO_VERDICT',
  'VERDICT_TO_FLOAT_CODE', 'state.sharedPlanBaseline', "lsGetJSON('sharedPlanBaseline'",
  "lsSetJSON('sharedPlanBaseline'"
]) {
  assert.ok(!html.includes(needle), `compare-related "${needle}" must be fully removed`);
}
// The old localStorage key is actively cleaned up on load (not merely stopped-from-growing) —
// that cleanup is expected to be the only remaining mention of the key name.
assert.equal((html.match(/sharedPlanBaseline/g) || []).length, 1,
  'the only remaining reference to sharedPlanBaseline must be the one-time localStorage cleanup');

// The Monitor feature is a separate mechanism (watches the CURRENT plan for live changes) and
// must still be intact.
for (const needle of [
  'function diffAgainstSavedPlan', 'function buildPlanSnapshotForWindow', 'function savePlan',
  'function startMonitor', 'function stopMonitor', 'id="monitorChangedBanner"',
  'id="monitorToggle"', 'id="monitorIntervalLabel"'
]) {
  assert.ok(html.includes(needle), `Monitor feature must remain intact: missing "${needle}"`);
}

/* ============================== Change 2: collapsed Plan Code panel ============================== */

assert.ok(html.includes('id="importCodeBtn">Import</button>'),
  'a single Import toolbar button must exist');
assert.ok(!html.includes('Share plan</button>') && !html.includes('Check a plan</button>'),
  '"Share plan" and "Check a plan" buttons must be gone');

// The live code row must exist, must start hidden (a Plan Code encodes a generated plan, so
// it is only offered once one exists), and must not be nested inside the Import code panel or
// the (also hidden-by-default) club panel.
const planCardStart = html.indexOf('<section class="card" id="planCard">');
const planCardEnd = html.indexOf('</section>', planCardStart);
const planCardHtml = html.slice(planCardStart, planCardEnd);
assert.match(planCardHtml, /<div class="plan-code-live-row hidden" id="planCodeLiveRow">/,
  'the live Plan Code row must exist and start hidden until a plan is generated');
assert.match(planCardHtml, /id="livePlanCode"/, 'the live row must carry the current code');
assert.match(planCardHtml, /compact form of this plan/i,
  'the live row must carry a short one-line label explaining it is a compact form of the plan');

const importViewStart = planCardHtml.indexOf('id="planImportView"');
const importViewEnd = planCardHtml.indexOf('</div>', planCardHtml.indexOf('previewPlanCodeBtn', importViewStart));
assert.ok(importViewStart >= 0 && importViewEnd > importViewStart, 'planImportView must exist');
assert.ok(!planCardHtml.slice(importViewStart, importViewEnd).includes('id="livePlanCode"'),
  'the live code row must live outside the Import sub-view (it lives in the default sub-view)');
assert.match(planCardHtml, /class="plan-main-view hidden" id="planImportView"/,
  'the Import sub-view must start hidden, opened only via the toolbar button');
assert.match(planCardHtml, /<div class="plan-main-view" id="planDefaultView">/,
  'the default sub-view must exist and start visible (no "hidden" class)');
assert.ok(planCardHtml.indexOf('id="livePlanCode"') > planCardHtml.indexOf('id="planDefaultView"') &&
  planCardHtml.indexOf('id="livePlanCode"') < importViewStart,
  'the live Plan Code row must live inside the default sub-view');

// The live row is kept current from the same recompute pass that redraws every other
// window-dependent element, and also right after a code is applied.
assert.ok(html.includes('function updateLivePlanCode()'), 'updateLivePlanCode must exist');
assert.ok(/updateLivePlanCode\(\);\s*\n\}/.test(html) || html.includes('  updateLivePlanCode();'),
  'updateLivePlanCode must be wired into the window-dependent recompute pass');
assert.ok(html.includes('encodeFloatCode(buildFloatCodePlan())'),
  'the live row must be built from the same codec as the rest of the Plan Code feature');

// The pre-load summary (departure/return/duration/first leg/vessel) survives in the minimal
// Import flow, but must not have grown back into a full panel with an intro paragraph.
assert.ok(html.includes('<span>Departure</span>') && html.includes('<span>Return</span>') &&
  html.includes('<span>Duration</span>') && html.includes('<span>Intended first leg</span>') &&
  html.includes('<span>Vessel</span>'), 'the pre-load Plan Code preview must still summarize the schedule');

/* ============================== Change 3: Atlantic Yachting behind a button ============================== */

assert.match(planCardHtml, /<div class="club-file-panel hidden" id="clubFilePanel">/,
  'clubFilePanel must start hidden');
assert.ok(html.includes('id="openClubFilePanelBtn">Atlantic Yachting&hellip;</button>'),
  'a toolbar button must open the Atlantic Yachting panel, labelled with an ellipsis');
assert.ok(html.includes('id="closeClubFilePanelBtn"'), 'the panel must have its own Close control');
// The toolbar button opens; the in-panel button files. They must never share a label.
assert.ok(html.includes('id="fileClubPlanBtn" disabled>File with Atlantic Yachting</button>'),
  'the in-panel primary action must keep its existing filing label');

/* ============================== Change 4: toolbar, bottom-of-card, Print/Copy gone ============================== */

assert.ok(!html.includes('id="printPlanBtn"'), 'the Print button must be removed');
assert.ok(!html.includes('id="copyPlanBtn"'), 'the Copy-as-text button must be removed');
assert.ok(!html.includes('importCodePanel'), 'the old importCodePanel id must be fully retired');

// The toolbar sits last in source, after both columns. On the phone card these wrappers are
// plain display:contents with no grid, so source order alone puts the actions at the bottom.
const actionsColIndex = planCardHtml.indexOf('<div class="plan-actions-col">');
const planAsideIndex = planCardHtml.indexOf('<div class="plan-aside">');
const planMainIndex = planCardHtml.indexOf('<div class="plan-main">');
assert.ok(actionsColIndex >= 0 && planAsideIndex >= 0 && planMainIndex >= 0,
  'the toolbar, aside and main wrappers must all exist');
assert.ok(actionsColIndex > planAsideIndex && actionsColIndex > planMainIndex,
  'the action toolbar must sit below the form/aside and the main column, not above them');
const sourcesIndex = planCardHtml.indexOf('<details class="source-links">');
assert.ok(sourcesIndex > actionsColIndex,
  'the toolbar must still come before the Sources row, so Sources stays the last thing in the card');

// The desktop card places by named grid area, so its row order must be moved to match rather
// than left relying on source order.
assert.ok(html.includes('grid-template-areas: "head head" "aside main" "actions actions" "src src"'),
  'the fit-shell plan grid must place the actions row below the aside/main row');
assert.ok(html.includes('grid-template-rows: auto minmax(0, 1fr) auto auto;'),
  'the aside/main row must be the flexible one, with the toolbar row sized to content');

/* ============================== Change 5: Plan Code row is gated on generation ============================== */

// A Plan Code is the compact form of a *generated* plan, so the row that advertises one must
// not appear before the user has generated anything. It is revealed by the same call that
// reveals the proposal text, so the two can never disagree about whether a plan exists.
const showNarrativeStart = html.indexOf('function showNarrativeSection()');
assert.ok(showNarrativeStart >= 0, 'showNarrativeSection must exist');
const showNarrativeBody = html.slice(showNarrativeStart, html.indexOf('\n}', showNarrativeStart));
assert.match(showNarrativeBody, /fpNarrativeBlock/,
  'showNarrativeSection must still reveal the proposal block');
assert.match(showNarrativeBody, /planCodeLiveRow/,
  'showNarrativeSection must also reveal the live Plan Code row');
assert.match(showNarrativeBody, /showEl\(codeRow\)/,
  'the Plan Code row must be revealed, not merely referenced');
// recomputeWindowDependentUI is the only other caller of updateLivePlanCode and need not have
// run yet on this load, so the row must be filled at the moment it is revealed — otherwise it
// appears holding an empty code beside a Copy button that silently does nothing.
assert.match(showNarrativeBody, /updateLivePlanCode\(\)/,
  'the Plan Code row must be populated when it is revealed, not left blank');

// Nothing else may reveal the row — in particular importing a code loads a schedule but does
// not generate a plan, so applySharedPlan must leave it hidden.
const applyShared = html.slice(html.indexOf('function applySharedPlan('),
  html.indexOf('\n}', html.indexOf('function applySharedPlan(')));
assert.ok(!applyShared.includes('planCodeLiveRow'),
  'importing a schedule must not reveal the Plan Code row');

console.log('Plan card simplification (compare removal, Plan Code panel, Atlantic Yachting toggle) assertions passed');
