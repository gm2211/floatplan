import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Shared card recovery is bounded and deduplicated per status slot.
const recoveryStart = html.indexOf('var CARD_RETRY_DELAYS_MS');
const recoveryEnd = html.indexOf('function prefixedErrorMessage', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'shared card recovery helpers not found');
const timers = [];
const cleared = [];
const recoveryContext = vm.createContext({
  Promise,
  setTimeout: (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  },
  clearTimeout: timer => cleared.push(timer),
  $: () => null,
  escapeHtml: String,
  showEl: () => {},
  hideEl: () => {}
});
vm.runInContext(html.slice(recoveryStart, recoveryEnd), recoveryContext);
let retries = 0;
const retry = () => { retries += 1; return false; };
assert.equal(recoveryContext.scheduleCardRecovery('weatherError', retry), true);
assert.equal(recoveryContext.scheduleCardRecovery('weatherError', retry), false, 'pending retry must dedupe');
assert.deepEqual(timers.map(timer => timer.delay), [30000]);
timers[0].callback();
await Promise.resolve();
await Promise.resolve();
assert.equal(retries, 1);
assert.equal(recoveryContext.scheduleCardRecovery('weatherError', retry), true);
assert.equal(timers[1].delay, 60000);
recoveryContext.clearCardError('weatherError');
assert.equal(recoveryContext.cardRecoveryState.weatherError.attempt, 0, 'success resets retry backoff');
assert.equal(cleared.length, 1);

// Retries never stop: exhaust the full delay sequence three more times and confirm the
// schedule keeps firing at the 120 s ceiling indefinitely instead of giving up once
// CARD_RETRY_DELAYS_MS is exhausted (a long outage must not strand the page on stale data).
for (const expectedDelay of [30000, 60000, 120000]) {
  assert.equal(recoveryContext.scheduleCardRecovery('weatherError', retry), true);
  const scheduled = timers[timers.length - 1];
  assert.equal(scheduled.delay, expectedDelay);
  scheduled.callback();
  await Promise.resolve();
  await Promise.resolve();
}
assert.equal(recoveryContext.scheduleCardRecovery('weatherError', retry), true);
const fourthRetry = timers[timers.length - 1];
assert.equal(fourthRetry.delay, 120000, '4th attempt clamps to the 120 s ceiling, not a bail-out');
fourthRetry.callback();
await Promise.resolve();
await Promise.resolve();
assert.equal(recoveryContext.scheduleCardRecovery('weatherError', retry), true);
const fifthRetry = timers[timers.length - 1];
assert.equal(fifthRetry.delay, 120000, '5th attempt still fires — retries never permanently stop');

// Missing critical feeds cannot produce a green GO, while all available + no hazards can.
const verdictStart = html.indexOf("var LEVEL_ORDER = ['GO'");
const verdictEnd = html.indexOf('function alertEndMs', verdictStart);
assert.ok(verdictStart >= 0 && verdictEnd > verdictStart, 'verdict logic not found');
const verdictContext = vm.createContext({
  round1: value => Math.round(value * 10) / 10,
  fmtAlertWindow: () => ''
});
vm.runInContext(html.slice(verdictStart, verdictEnd), verdictContext);
const limits = { reefLow: 15, reefHigh: 18, noGoSustained: 20, noGoGust: 25 };
const safe = { maxSustainedKt: 10, maxGustKt: 12, thunderHourLabels: [], alertsInWindow: [], limits };
assert.equal(verdictContext.computeVerdict({ ...safe, availability: { wind: true, hourly: true, alerts: true } }).level, 'GO');
for (const missing of ['wind', 'hourly', 'alerts']) {
  const availability = { wind: true, hourly: true, alerts: true, [missing]: false };
  const verdict = verdictContext.computeVerdict({ ...safe, availability });
  assert.equal(verdict.level, 'CAUTION', `${missing} failure must gate GO`);
  assert.equal(verdict.dataUnavailable, true);
  assert.match(verdict.reasons[0], /Data unavailable:/);
}

// A still-loading feed is not yet missing: it softens an otherwise-green verdict to
// CAUTION — CHECKING LIVE DATA rather than falsely claiming CAUTION — DATA UNAVAILABLE.
const pendingVerdict = verdictContext.computeVerdict({
  ...safe, availability: { wind: true, hourly: 'pending', alerts: true }
});
assert.equal(pendingVerdict.level, 'CAUTION');
assert.equal(pendingVerdict.pendingGated, true);
assert.equal(pendingVerdict.dataUnavailable, false);
assert.match(pendingVerdict.reasons[0], /Confirming live data: hourly forecast/);

// Pending must never suppress or add noise to a verdict already worse than GO on real hazards.
const windyPendingVerdict = verdictContext.computeVerdict({
  ...safe, maxSustainedKt: 22, availability: { wind: true, hourly: 'pending', alerts: true }
});
assert.equal(windyPendingVerdict.level, 'NOGO');
assert.ok(!windyPendingVerdict.reasons.some(r => /Confirming/.test(r)),
  'a real hazard verdict must not add pending noise');

// Once a sail window has ended, the banner is a neutral review state rather than a false
// present-tense safety warning. Any genuine archive gap remains visible with accurate wording.
const presentationStart = html.indexOf('var VERDICT_LABELS =');
const presentationEnd = html.indexOf('function renderVerdict', presentationStart);
assert.ok(presentationStart >= 0 && presentationEnd > presentationStart, 'verdict presentation helper not found');
const presentationContext = vm.createContext({ fmtTime: ms => `${ms}ms` });
vm.runInContext(html.slice(presentationStart, presentationEnd), presentationContext);
const missingHourlyVerdict = verdictContext.computeVerdict({
  ...safe, availability: { wind: true, hourly: false, alerts: true }
});
const activePresentation = presentationContext.verdictPresentation(missingHourlyVerdict, 100, 200, 150);
assert.equal(activePresentation.label, 'CAUTION — DATA UNAVAILABLE');
const completedPresentation = presentationContext.verdictPresentation(missingHourlyVerdict, 100, 200, 200);
assert.equal(completedPresentation.label, 'SAIL COMPLETE');
assert.equal(completedPresentation.pillLabel, 'COMPLETE');
assert.match(completedPresentation.reasons[0], /Sail window completed/);
assert.match(completedPresentation.reasons[1], /Historical review incomplete: full-window coverage for hourly forecast/);
assert.doesNotMatch(completedPresentation.reasons.join(' '), /Data unavailable/);

// A successful hourly refresh must retain elapsed forecast periods for an active or recently
// completed sail instead of replacing the cache wholesale with NWS's forward-only response.
const hourlyMergeStart = html.indexOf('function mergeHourlyForecastHistory');
const hourlyMergeEnd = html.indexOf('// Fetched with the regular refresh sweep', hourlyMergeStart);
assert.ok(hourlyMergeStart >= 0 && hourlyMergeEnd > hourlyMergeStart, 'hourly history merger not found');
const hourlyContext = vm.createContext({ Map, Date, isFinite });
vm.runInContext(html.slice(hourlyMergeStart, hourlyMergeEnd), hourlyContext);
const period = (hour, marker) => ({
  startTime: `2026-07-31T${String(hour).padStart(2, '0')}:00:00-04:00`,
  endTime: `2026-07-31T${String(hour + 1).padStart(2, '0')}:00:00-04:00`,
  marker
});
const previousHourly = [period(16, 'too-old'), period(17, 'retained'), period(18, 'old-version')];
const freshHourly = [period(18, 'fresh-version'), period(19, 'fresh')];
const retainFromMs = new Date('2026-07-31T17:30:00-04:00').getTime();
const mergedHourly = hourlyContext.mergeHourlyForecastHistory(previousHourly, freshHourly, retainFromMs);
assert.deepEqual(Array.from(mergedHourly, p => p.marker), ['retained', 'fresh-version', 'fresh']);
assert.match(html, /mergeHourlyForecastHistory\(state\.hourlyRaw, freshPeriods, retainFromMs\)/,
  'loadHourly must cache the merged history, not the forward-only response');

// Successful [] means no active advisories; failed/unknown [] must not make that claim.
const advisoryStart = html.indexOf('function renderAdvisories(');
const advisoryEnd = html.indexOf('/* ============================== CWF forecast', advisoryStart);
assert.ok(advisoryStart >= 0 && advisoryEnd > advisoryStart, 'advisory renderer not found');
const list = { innerHTML: '', querySelectorAll: () => [] };
const badge = { classList: { toggle: () => {} } };
const advisoryContext = vm.createContext({ $: id => id === 'advisoriesList' ? list : badge });
vm.runInContext(html.slice(advisoryStart, advisoryEnd), advisoryContext);
advisoryContext.renderAdvisories([], 0, 1, false);
assert.match(list.innerHTML, /Advisory status unavailable/);
assert.doesNotMatch(list.innerHTML, /No active advisories/);
advisoryContext.renderAdvisories([], 0, 1, true);
assert.match(list.innerHTML, /No active advisories/);

assert.match(html, /loaders\.map\(invokeSourceLoader\)/, 'loadAll must isolate every loader invocation');
assert.match(html, /\.card-error \{[\s\S]*?var\(--yellow-bg\)/, 'source recovery status must use neutral/yellow styling');
assert.doesNotMatch(html, /\.card-error \{[\s\S]{0,180}var\(--red-bg\)/, 'transport errors must not use hazard red');
assert.match(html, />Retry now<\/button>/);
assert.match(html, /Current forecast unavailable · retrying automatically/);
assert.match(html, /partial refresh .*critical data unavailable/, 'optional success must not look fully fresh');
assert.match(html, /criticalSourceHealth\.wind === 'available'/);
assert.match(html, /criticalDataAvailability\(departureMs, returnMs\)\.alerts === true/,
  'pending advisory availability must never be treated as a confirmed successful load');

console.log('App resilience assertions passed');
