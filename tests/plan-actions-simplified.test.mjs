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

assert.ok(html.includes('id="importCodeBtn">Import code</button>'),
  'a single Import code toolbar button must exist');
assert.ok(!html.includes('Share plan</button>') && !html.includes('Check a plan</button>'),
  '"Share plan" and "Check a plan" buttons must be gone');

// The live code row must exist, must not itself be hidden, and must not be nested inside the
// Import code panel or the (also hidden-by-default) club panel.
const planCardStart = html.indexOf('<section class="card" id="planCard">');
const planCardEnd = html.indexOf('</section>', planCardStart);
const planCardHtml = html.slice(planCardStart, planCardEnd);
assert.match(planCardHtml, /<div class="plan-code-live-row" id="planCodeLiveRow">/,
  'the live Plan Code row must exist and start visible (no "hidden" class)');
assert.match(planCardHtml, /id="livePlanCode"/, 'the live row must carry the current code');
assert.match(planCardHtml, /compact form of this plan/i,
  'the live row must carry a short one-line label explaining it is a compact form of the plan');

const importPanelStart = planCardHtml.indexOf('id="importCodePanel"');
const importPanelEnd = planCardHtml.indexOf('</div>', planCardHtml.indexOf('previewPlanCodeBtn', importPanelStart));
assert.ok(importPanelStart >= 0 && importPanelEnd > importPanelStart, 'importCodePanel must exist');
assert.ok(!planCardHtml.slice(importPanelStart, importPanelEnd).includes('id="livePlanCode"'),
  'the live code row must live outside the Import code panel');
assert.match(planCardHtml, /class="import-code-panel hidden" id="importCodePanel"/,
  'Import code panel must start hidden, opened only via the toolbar button');

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

console.log('Plan card simplification (compare removal, Plan Code panel, Atlantic Yachting toggle) assertions passed');
