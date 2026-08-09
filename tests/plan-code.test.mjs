import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("var FLOAT_CODE_PREFIX = 'FP2';");
const end = html.indexOf('function renderPlanCodePreview', start);
assert.ok(start >= 0 && end > start, 'production Plan Code codec not found');

(0, eval)(html.slice(start, end));

// FP2 dropped the creation-time verdict/wind/advisory/limits snapshot — those fields existed
// solely to feed the (now-deleted) plan-comparison feature. Only what "Load schedule" actually
// needs survives: departure, duration, first leg, and the vessel/crew summary.
const fixture = {
  createdAtMs: Date.parse('2026-07-15T12:00:00-04:00'),
  departureMs: Date.parse('2026-07-15T15:00:00-04:00'),
  durationMinutes: 180,
  heading: 'S',
  vesselName: 'AY10', crewCount: '3'
};

const code = encodeFloatCode(fixture);
assert.match(code, /^FP2-[A-Za-z0-9_-]+-[0-9a-z]{7}$/);
const decoded = decodeFloatCode(code);
for (const key of ['createdAtMs', 'departureMs', 'durationMinutes', 'heading', 'vesselName', 'crewCount']) {
  assert.deepEqual(decoded[key], fixture[key], `${key} must survive Plan Code round-trip`);
}
assert.equal(vesselSummaryForCode(decoded), 'AY10 · 3 crew + 1 skipper (4 aboard)');

const damaged = code.slice(0, -1) + (code.endsWith('a') ? 'b' : 'a');
assert.throws(() => decodeFloatCode(damaged), /damaged or incomplete/);

// No FP1 code has ever been shared outside this dashboard (confirmed by the user), so there is
// no round-trip obligation for the old format — decodeFloatCode rejects it outright with a
// clear upgrade message instead of silently misparsing a payload shape that no longer applies.
const legacyPacked = [1, 1000, 2000, 180, 'S', 'G', 167, 210, 0, ['abc123'], [150, 180, 200, 250], 'AY10', '', '', '3'];
const legacyPayload = base64UrlEncodeUtf8(JSON.stringify(legacyPacked));
const legacyCode = 'FP1-' + legacyPayload + '-' + floatCodeHash(legacyPayload);
assert.throws(() => decodeFloatCode(legacyCode), /older version/,
  'an FP1 code must be rejected with a clear upgrade message, not silently misparsed');

assert.ok(html.includes('Built from dashboard data using fixed rules, not AI.'),
  'fallback status must explain that deterministic rules generated the narrative');
assert.ok(html.includes('vesselName: compactPlanText(getVesselDisplayName(), 36)'),
  'Plan Code creation must serialize the visible vessel preset, not only a hidden custom field');

console.log('Plan Code round-trip and UX copy assertions passed');
