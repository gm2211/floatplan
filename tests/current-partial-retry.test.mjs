import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var CURRENT_RETRY_DELAYS_MS');
const end = html.indexOf('function getReturnMs', start);
assert.ok(start >= 0 && end > start, 'current retry state block not found');

const timers = [];
const clearedTimers = [];
const status = { textContent: '', className: '' };
const context = vm.createContext({
  state: { departureMs: 100, curvePoints: [] },
  setTimeout: (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  },
  clearTimeout: timer => clearedTimers.push(timer),
  $: id => id === 'directionStatus' ? status : null,
  getReturnMs: () => 300,
  currentCurveCoversWindow: () => false,
  currentVelocityWithinCoverage: () => null,
  slackTimingCoversWindow: () => false
});
vm.runInContext(html.slice(start, end), context);

let calls = 0;
const loader = () => { calls += 1; };
assert.equal(context.scheduleCurrentRetry('slack', loader), true);
assert.equal(timers.length, 1);
assert.equal(timers[0].delay, 30000);
assert.equal(context.scheduleCurrentRetry('slack', loader), false, 'a pending retry must be deduplicated');
assert.equal(timers.length, 1);

timers[0].callback();
assert.equal(calls, 1);
assert.equal(context.scheduleCurrentRetry('slack', loader), true);
assert.equal(timers[1].delay, 60000);
context.resetCurrentRetry('slack');
assert.equal(context.currentRetryState.slack.attempt, 0, 'success resets bounded backoff');
assert.equal(context.currentRetryState.slack.timer, null);
assert.equal(clearedTimers.length, 1);

context.currentFeedState.curve = 'error';
context.currentFeedState.slack = 'error';
context.scheduleCurrentRetry('curve', loader);
context.scheduleCurrentRetry('slack', loader);
context.renderDirectionDataStatus();
assert.equal(status.textContent, 'Some current data unavailable · retrying automatically');
assert.equal(status.className, 'direction-status warn');

assert.doesNotMatch(html, /id="directionError"/);
assert.match(html, /resetCurrentRetry\('slack'\)/);
assert.match(html, /resetCurrentRetry\('curve'\)/);
assert.match(html, /if \(currentLoadInFlight\.slack\) return currentLoadInFlight\.slack/);
assert.match(html, /if \(currentLoadInFlight\.curve\) return currentLoadInFlight\.curve/);

console.log('Partial current retry assertions passed');
