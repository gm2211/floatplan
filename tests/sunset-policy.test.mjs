import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function applySunsetPolicy');
const end = html.indexOf('function sunsetPolicyForPlan', start);
assert.ok(start >= 0 && end > start, 'sunset plan policy must be present');
(0, eval)(html.slice(start, end));

const minute = 60000;
const sunset = 1000 * minute;
const departure = 820 * minute;

const shortened = applySunsetPolicy(departure, 3.25, sunset, false);
assert.equal(shortened.adjustment, 'duration');
assert.equal(shortened.returnMs, sunset);
assert.equal(shortened.durationHours, 3);

const allowed = applySunsetPolicy(departure, 3.25, sunset, true);
assert.equal(allowed.adjusted, false);
assert.equal(allowed.violates, true);
assert.equal(allowed.returnMs, departure + 3.25 * 60 * minute);

const shifted = applySunsetPolicy(970 * minute, 3, sunset, false);
assert.equal(shifted.adjustment, 'departure');
assert.equal(shifted.departureMs, sunset - 3 * 60 * minute);
assert.equal(shifted.returnMs, sunset);

const boundary = applySunsetPolicy(departure, 3, sunset, false);
assert.equal(boundary.adjusted, false);
assert.equal(boundary.violates, false);

assert.match(html, /id="sunsetOverrideAck"/);
assert.match(html, /applySunsetConstraint\(\)/);
assert.doesNotMatch(html, /carry navigation lights|navigation lights are mandatory/i);

console.log('Sunset plan-limit assertions passed');
