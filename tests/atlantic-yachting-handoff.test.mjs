import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("var ATLANTIC_YACHTING_BASE_URL =");
const end = html.indexOf('function getVesselDisplayName', start);
assert.ok(start >= 0 && end > start, 'Atlantic Yachting reference parser must be present');
(0, eval)(html.slice(start, end));

assert.equal(parseAtlanticYachtingSailReference('SL-890624'), 'SL-890624');
assert.equal(parseAtlanticYachtingSailReference('SL-temp-1780240851661'), 'SL-temp-1780240851661');
assert.equal(
  parseAtlanticYachtingSailReference('https://clubapp.atlanticyachting.com/skipper/quarterdeck?sailId=SL-890624'),
  'SL-890624'
);
assert.equal(
  parseAtlanticYachtingSailReference('https://ay-sailing-club.web.app/float-plan/SL-temp-1780240851661?from=dashboard'),
  'SL-temp-1780240851661'
);
assert.equal(parseAtlanticYachtingSailReference('https://example.com/?sailId=SL-890624'), null,
  'untrusted hosts must never become Club handoff targets');
assert.equal(parseAtlanticYachtingSailReference('javascript:alert(1)'), null);
assert.equal(
  atlanticYachtingQuarterdeckUrl('SL-890624'),
  'https://clubapp.atlanticyachting.com/skipper/quarterdeck?sailId=SL-890624'
);
assert.equal(
  atlanticYachtingFloatPlanUrl('SL-890624'),
  'https://clubapp.atlanticyachting.com/float-plan/SL-890624?from=quarterdeck'
);

for (const id of ['findClubSailsBtn', 'aySailReference', 'fileClubPlanBtn', 'viewClubPlanBtn']) {
  assert.ok(html.includes(`id="${id}"`), `${id} must be available in the Sail Plan card`);
}
for (const field of ['departureTime', 'estReturnTime', 'startWind', 'startTideState', 'startTideSpeed',
  'startWeather', 'writtenPlan', 'routeWaypoints', 'routeDistance', 'routeDuration',
  'outboundHeading', 'inboundHeading', 'tideCurrentChangeTime']) {
  assert.ok(html.includes(`${field}:`), `Club handoff must map ${field}`);
}
assert.ok(html.includes('never your Club login or session token'),
  'handoff copy must describe the least-privilege credential boundary');
assert.ok(html.includes('review and submission'),
  'handoff must not imply that opening Quarterdeck submitted the plan');

console.log('Atlantic Yachting sail-reference and handoff assertions passed');
