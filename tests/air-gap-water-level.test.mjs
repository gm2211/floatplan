import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const sliceBetween = (startMarker, endMarker) => {
  const start = html.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return html.slice(start, end);
};

const constants = sliceBetween('var STATION_AIRGAP_VERRAZANO =', 'var KVK_FLOOD_AXIS_DEG =');
const helpers = sliceBetween('function airGapRowsToMap(', '// Combines the three water-level-related fetches');

const store = new Map();
const context = vm.createContext({
  Map, Math, Date, JSON, String, Number, isFinite, parseFloat, console,
  localStorage: {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  },
  LS_PREFIX: 'fp25.',
  pad2: n => String(n).padStart(2, '0'),
  parseNoaaGmt: str => {
    if (!str) return null;
    const ms = new Date(str.replace(' ', 'T') + 'Z').getTime();
    return isFinite(ms) ? ms : null;
  },
  lsGetJSON: (key, fallback, requireObject) => {
    const raw = store.get('fp25.' + key);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      if (requireObject && (parsed === null || typeof parsed !== 'object')) return fallback;
      return parsed;
    } catch { return fallback; }
  },
  lsSetJSON: (key, value) => store.set('fp25.' + key, JSON.stringify(value))
});
vm.runInContext(constants + '\n' + helpers, context);

const { AIRGAP_LEAD_MS, AIRGAP_CAL_MAX_AGE_MS, AIRGAP_CAL_MIN_SAMPLES } = context;
assert.equal(AIRGAP_LEAD_MS, 30 * 60000, 'Verrazano leads The Battery by 30 minutes');

const STEP = 6 * 60000;
const T0 = Date.UTC(2026, 7, 8, 0, 0);
const stamp = ms => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:` +
    `${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// A synthetic semidiurnal tide standing in for The Battery, and the air gap that would be
// observed 30 minutes EARLIER at the bridge for a soffit of 232.31 ft (the August figure).
const SOFFIT = 232.31;
const tideAt = ms => 2.6 + 2.55 * Math.sin((2 * Math.PI * (ms - T0)) / (12.42 * 3600000));
const COUNT = 120;
const observedRows = Array.from({ length: COUNT }, (_, i) => ({
  t: stamp(T0 + i * STEP), v: tideAt(T0 + i * STEP).toFixed(3)
}));
// Air gap sample at time t corresponds to the Battery level at t + lead.
const airGapRows = Array.from({ length: COUNT }, (_, i) => {
  const ms = T0 + i * STEP;
  return { t: stamp(ms), v: (SOFFIT - tideAt(ms + AIRGAP_LEAD_MS)).toFixed(3) };
});

// --- calibration recovers the soffit -----------------------------------------------------
const cal = context.calibrateAirGapSoffit(airGapRows, observedRows, T0 + COUNT * STEP);
assert.ok(cal, 'calibration should succeed with a full overlap');
assert.ok(Math.abs(cal.soffitFt - SOFFIT) < 0.01,
  `recovered soffit ${cal.soffitFt} should match ${SOFFIT}`);
assert.ok(cal.samples >= AIRGAP_CAL_MIN_SAMPLES);

// A single wild spike must not move the answer — that is why the solver takes a median.
const spiked = airGapRows.map((r, i) => (i === 40 ? { t: r.t, v: '188.0' } : r));
const spikedCal = context.calibrateAirGapSoffit(spiked, observedRows, T0);
assert.ok(Math.abs(spikedCal.soffitFt - SOFFIT) < 0.01,
  'median calibration must be unmoved by an outlier that would shift a mean');

// Too little overlap is refused rather than fit badly.
assert.equal(context.calibrateAirGapSoffit(airGapRows.slice(0, 5), observedRows, T0), null);
assert.equal(context.calibrateAirGapSoffit([], observedRows, T0), null);
assert.equal(context.calibrateAirGapSoffit(airGapRows, [], T0), null);

// --- derivation reproduces the Battery curve, on Battery time ----------------------------
const derived = context.deriveLevelFromAirGap(airGapRows, SOFFIT);
assert.equal(derived.length, COUNT);
const byTime = new Map(derived.map(r => [r.t, parseFloat(r.v)]));
let worst = 0;
observedRows.forEach(row => {
  const got = byTime.get(row.t);
  if (got == null) return;
  worst = Math.max(worst, Math.abs(got - parseFloat(row.v)));
});
assert.ok(worst < 0.001, `derived curve should land on Battery timestamps (worst ${worst})`);
assert.ok(byTime.has(stamp(T0 + AIRGAP_LEAD_MS)),
  'derived timestamps must carry the lead correction, not raw Verrazano time');

// Derived rows must round-trip through the same parser the real NOAA rows use.
derived.forEach(row => assert.ok(context.parseNoaaGmt(row.t) != null,
  `derived timestamp ${row.t} must be parseable`));

// Arrays cross the vm realm boundary, so compare lengths rather than identity.
assert.equal(context.deriveLevelFromAirGap(airGapRows, NaN).length, 0);
assert.equal(context.deriveLevelFromAirGap([{ t: 'garbage', v: 'x' }], SOFFIT).length, 0);

// --- stored calibration expires ----------------------------------------------------------
const NOW = Date.UTC(2026, 7, 9, 12, 0);
context.lsSetJSON(context.AIRGAP_CAL_KEY, { soffitFt: SOFFIT, samples: 300, ms: NOW - 3600000 });
assert.ok(context.readAirGapCalibration(NOW), 'a fresh calibration is usable');

context.lsSetJSON(context.AIRGAP_CAL_KEY, {
  soffitFt: 235.82, samples: 300, ms: NOW - AIRGAP_CAL_MAX_AGE_MS - 1
});
assert.equal(context.readAirGapCalibration(NOW), null,
  'a stale calibration must be discarded — the deck moves ~3.5 ft seasonally');

context.lsSetJSON(context.AIRGAP_CAL_KEY, { soffitFt: 'nonsense', ms: NOW });
assert.equal(context.readAirGapCalibration(NOW), null, 'malformed calibration is rejected');
store.delete('fp25.' + context.AIRGAP_CAL_KEY);
assert.equal(context.readAirGapCalibration(NOW), null, 'absent calibration cannot cold-start');

console.log('air-gap-water-level: ok');
