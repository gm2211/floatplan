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

console.log('App resilience assertions passed');
