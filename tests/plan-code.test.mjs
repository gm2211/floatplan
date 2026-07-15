import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("var FLOAT_CODE_PREFIX = 'FP1';");
const end = html.indexOf('function renderPlanCodePreview', start);
assert.ok(start >= 0 && end > start, 'production Plan Code codec not found');

globalThis.DEFAULT_LIMITS = { reefLow: 15, reefHigh: 18, noGoSustained: 20, noGoGust: 25 };
(0, eval)(html.slice(start, end));

const fixture = {
  createdAtMs: Date.parse('2026-07-15T12:00:00-04:00'),
  departureMs: Date.parse('2026-07-15T15:00:00-04:00'),
  durationMinutes: 180,
  heading: 'S', verdictLevel: 'REEF', maxSustainedKt: 16.7, maxGustKt: 21,
  thunder: false, alertHashes: ['abc123'], limits: [15, 18, 20, 25],
  vesselName: 'AY10', vesselType: '', sailNumber: '', crewCount: '3'
};

const code = encodeFloatCode(fixture);
assert.match(code, /^FP1-[A-Za-z0-9_-]+-[0-9a-z]{7}$/);
const decoded = decodeFloatCode(code);
for (const key of ['createdAtMs', 'departureMs', 'durationMinutes', 'heading', 'verdictLevel',
  'maxSustainedKt', 'maxGustKt', 'thunder', 'vesselName', 'crewCount']) {
  assert.deepEqual(decoded[key], fixture[key], `${key} must survive Plan Code round-trip`);
}
assert.deepEqual(decoded.alertHashes, fixture.alertHashes);
assert.deepEqual(decoded.limits, fixture.limits);
assert.equal(vesselSummaryForCode(decoded), 'AY10 · 3 crew + 1 skipper (4 aboard)');

const damaged = code.slice(0, -1) + (code.endsWith('a') ? 'b' : 'a');
assert.throws(() => decodeFloatCode(damaged), /damaged or incomplete/);

assert.ok(html.includes('Built from dashboard data using fixed rules, not AI.'),
  'fallback status must explain that deterministic rules generated the narrative');
assert.ok(html.includes('Loading it fetches current source data for comparison.'),
  'Plan Code copy must distinguish saved fields from live comparison data');
assert.ok(html.includes('vesselName: compactPlanText(getVesselDisplayName(), 36)'),
  'Plan Code creation must serialize the visible vessel preset, not only a hidden custom field');
assert.ok(html.includes('id="sharePlanBtn">Share plan</button>'));
assert.ok(html.includes('id="checkPlanBtn">Check a plan</button>'));

console.log('Plan Code round-trip and UX copy assertions passed');
