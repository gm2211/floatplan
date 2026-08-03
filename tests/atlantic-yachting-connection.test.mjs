import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("var ATLANTIC_YACHTING_BASE_URL =");
const end = html.indexOf('function getVesselDisplayName', start);
assert.ok(start >= 0 && end > start, 'Atlantic Yachting connection helpers must be present');
globalThis.nyWallTimeToUtcMs = (y, m, d, hh, mi) => ({ utcMs: Date.UTC(y, m - 1, d, hh, mi) });
(0, eval)(html.slice(start, end));

assert.equal(normalizeAtlanticYachtingSailId('SL-890624'), 'SL-890624');
assert.equal(normalizeAtlanticYachtingSailId('javascript:alert(1)'), null);
assert.equal(
  atlanticYachtingQuarterdeckUrl('SL-890624'),
  'https://clubapp.atlanticyachting.com/skipper/quarterdeck?sailId=SL-890624'
);
assert.equal(
  atlanticYachtingFloatPlanUrl('SL-890624'),
  'https://clubapp.atlanticyachting.com/float-plan/SL-890624?from=quarterdeck'
);

const ay11 = normalizeAtlanticYachtingSignup({
  sailId: 'SL-744408', Date: '2026-08-03', StartTime: '5:30 PM', EndTime: '7:45 PM',
  PrimaryBoatID: 'AY11', role: 'Skipper'
});
const ay10 = normalizeAtlanticYachtingSignup({
  SailID: 'SL-744409', Date: '2026-08-03', StartTime: '17:20', EndTime: '19:30',
  PrimaryBoatID: 'AY10', Role: 'Skipper'
});
const cancelled = normalizeAtlanticYachtingSignup({
  sailId: 'SL-744410', Date: '2026-08-03', StartTime: '17:25', EndTime: '19:30',
  PrimaryBoatID: 'AY11', signupStatus: 'Confirmed', SailStatus: 'Cancelled'
});
assert.equal(ay11.startMs, Date.UTC(2026, 7, 3, 17, 30));
assert.equal(ay11.endMs, Date.UTC(2026, 7, 3, 19, 45));
assert.equal(
  chooseAtlanticYachtingVoyage([ay10, ay11, cancelled], Date.UTC(2026, 7, 3, 17, 25), 'AY11', Date.UTC(2026, 7, 1)).sailId,
  'SL-744408',
  'vessel match must outrank a slightly closer voyage on another boat'
);

for (const id of ['connectClubBtn', 'disconnectClubBtn', 'clubVoyageSelect',
  'clubSafetyGearTested', 'fileClubPlanBtn', 'viewClubPlanBtn']) {
  assert.ok(html.includes(`id="${id}"`), `${id} must be available in the Sail Plan card`);
}
assert.ok(!html.includes('id="aySailReference"'), 'direct filing must not ask the sailor to paste a Sail ID');
assert.ok(!html.includes('id="findClubSailsBtn"'), 'direct filing must not send the sailor away to find a Sail ID');
for (const field of ['departureTime', 'estReturnTime', 'startWind', 'startTideState', 'startTideSpeed',
  'startWeather', 'writtenPlan', 'routeWaypoints', 'routeDistance', 'routeDuration',
  'outboundHeading', 'inboundHeading', 'tideCurrentChangeTime']) {
  assert.ok(html.includes(`${field}:`), `Club filing must map ${field}`);
}
assert.ok(html.includes('inMemoryPersistence'), 'Club authentication must be memory-only');
assert.ok(html.includes("atlanticYachtingApi('getMySignups'"), 'connection must load booked voyages');
assert.ok(html.includes("atlanticYachtingApi('submitFloatPlan'"), 'connection must submit the mapped plan directly');
assert.ok(html.includes("state.lastVerdict.level === 'NO-GO'"), 'NO-GO plans must be blocked from direct filing');
assert.ok(html.includes("!state.lastVerdict || !state.lastDirectionRec"), 'filing must wait for the safety and route checks');
assert.ok(html.includes('safetyGearTested = true'), 'submission must carry the explicit safety-gear attestation');
assert.ok(html.includes('never stores your login token'), 'UI must state the least-privilege credential boundary');
assert.ok(html.includes('Filed successfully for '), 'UI must claim filing only after API success');

console.log('Atlantic Yachting direct connection assertions passed');
