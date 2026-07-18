import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = html.indexOf('function prefixedErrorMessage');
const helperEnd = html.indexOf('function showToast', helperStart);
const loadStart = html.indexOf('function currentCurveCoversWindow');
const loadEnd = html.indexOf('function loadWater', loadStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart && loadStart >= 0 && loadEnd > loadStart,
  'current refresh error helpers not found');

const cleared = [];
const shown = [];
const context = vm.createContext({
  isFinite,
  state: { departureMs: 100, curvePoints: [{ ms: 0 }, { ms: 200 }] },
  currentLoadInFlight: { curve: null },
  currentFeedState: { curve: 'loading' },
  getReturnMs: () => 150,
  loadSource: () => Promise.reject(new Error(
    'Currents (curve): Currents predictions are not available from the requested station.'
  )),
  fetchCurrentsCurve: () => Promise.resolve([]),
  buildCurvePoints: () => [],
  currentCurveBounds: points => points?.length ? {
    minMs: Math.min(...points.map(point => point.ms)),
    maxMs: Math.max(...points.map(point => point.ms))
  } : null,
  CURRENT_CURVE_MAX_GAP_MS: 45 * 60000,
  cancelScheduledCurrentRetry: () => {},
  resetCurrentRetry: () => {},
  scheduleCurrentRetry: () => true,
  renderDirectionDataStatus: () => {},
  scheduleSourceRecompute: () => {},
  clearCardError: id => cleared.push(id),
  showCardError: (id, message) => shown.push({ id, message })
});
vm.runInContext(html.slice(helperStart, helperEnd) + html.slice(loadStart, loadEnd), context);

assert.equal(context.currentCurveCoversWindow([{ ms: 100 }, { ms: 200 }], 120, 180), true);
assert.equal(context.currentCurveCoversWindow([{ ms: 100 }, { ms: 150 }], 120, 180), false);
assert.equal(context.currentCurveCoversWindow([{ ms: 0 }, { ms: 50 * 60000 }], 0, 50 * 60000), false,
  'bounds alone are insufficient when the current curve has a large missing interval');
assert.equal(await context.loadCurrentsCurve(), false);
assert.deepEqual(cleared, ['timelineError'], 'usable cached coverage keeps only the stale badge');
assert.deepEqual(shown, [], 'a failed refresh must not cover usable cached data with a red error');

context.state.curvePoints = [{ ms: 0 }, { ms: 120 }];
cleared.length = 0;
assert.equal(await context.loadCurrentsCurve(), false);
assert.deepEqual(shown, [{
  id: 'timelineError',
  message: 'Currents (curve): Currents predictions are not available from the requested station.'
}], 'missing-window cache still exposes a retryable, singly-prefixed error');

console.log('Current refresh error assertions passed');
