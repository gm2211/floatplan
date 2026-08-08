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
  'clubSafetyGearTested', 'fileClubPlanBtn', 'viewClubPlanBtn',
  'clubTokenRow', 'clubTokenInput', 'clubTokenSubmitBtn', 'clubTokenCancelBtn']) {
  assert.ok(html.includes(`id="${id}"`), `${id} must be available in the Sail Plan card`);
}
assert.ok(!html.includes('id="aySailReference"'), 'direct filing must not ask the sailor to paste a Sail ID');
assert.ok(!html.includes('id="findClubSailsBtn"'), 'direct filing must not send the sailor away to find a Sail ID');
for (const field of ['departureTime', 'estReturnTime', 'startWind', 'startTideState', 'startTideSpeed',
  'startWeather', 'writtenPlan', 'routeWaypoints', 'routeDistance', 'routeDuration',
  'outboundHeading', 'inboundHeading', 'tideCurrentChangeTime']) {
  assert.ok(html.includes(`${field}:`), `Club filing must map ${field}`);
}
// The pasted token is a bearer credential for the member's whole Club account. Nothing may
// persist it past the tab, and nothing may write it into a plan that later gets shared.
const tokenSlice = html.slice(html.indexOf('function decodeAtlanticYachtingToken'),
  html.indexOf('function atlanticYachtingApi'));
// Scoped to the credential-handling region only: the plan's own vessel/crew fields legitimately
// persist via lsSetJSON, and sweeping those in would make this assertion meaningless.
const connectionSlice = html.slice(html.indexOf('function decodeAtlanticYachtingToken'),
  html.indexOf('function computeTurnaroundMs'));
for (const sink of ['localStorage.setItem', 'sessionStorage.setItem', 'lsSetJSON']) {
  assert.ok(!connectionSlice.includes(sink),
    `Club token must never reach ${sink} — it has to stay memory-only`);
}
assert.ok(/input\.value = ''/.test(html), 'the paste field must be cleared once the token is captured');
assert.ok(html.includes("atlanticYachtingApi('getMySignups'"), 'connection must load booked voyages');
assert.ok(html.includes("atlanticYachtingApi('submitFloatPlan'"), 'connection must submit the mapped plan directly');
assert.ok(html.includes("state.lastVerdict.level === 'NO-GO'"), 'NO-GO plans must be blocked from direct filing');
assert.ok(html.includes("!state.lastVerdict || !state.lastDirectionRec"), 'filing must wait for the safety and route checks');
assert.ok(html.includes('safetyGearTested = true'), 'submission must carry the explicit safety-gear attestation');
assert.ok(html.includes('never stores it'), 'UI must state the least-privilege credential boundary');
assert.ok(html.includes('Filed successfully for '), 'UI must claim filing only after API success');

// Token decoding: the member pastes only the token, so email and expiry have to come out of
// the JWT itself rather than out of a second field.
globalThis.atlanticYachtingConnection = { token: null, tokenExpMs: null, user: null, signups: [], selectedSailId: null };
(0, eval)(tokenSlice);

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`;

const future = Math.floor(Date.now() / 1000) + 3000;
const good = decodeAtlanticYachtingToken(jwt({ email: 'skipper@example.com', exp: future }));
assert.equal(good.email, 'skipper@example.com', 'email must be read from the token claims');
assert.equal(good.expMs, future * 1000, 'expiry must be read from the token claims');

assert.equal(decodeAtlanticYachtingToken('not-a-token'), null, 'a non-JWT paste must be rejected');
assert.equal(decodeAtlanticYachtingToken(''), null, 'an empty paste must be rejected');
assert.equal(decodeAtlanticYachtingToken(jwt({ exp: future })), null,
  'a token with no email claim must be rejected rather than guessed at');
assert.equal(
  decodeAtlanticYachtingToken(jwt({ firebase: { identities: { email: ['crew@example.com'] } }, exp: future })).email,
  'crew@example.com', 'the nested Firebase identities claim must also yield an email');
assert.equal(decodeAtlanticYachtingToken(`  ${jwt({ email: 'a@b.com', exp: future })}  `).email, 'a@b.com',
  'a paste with stray whitespace must still work');

atlanticYachtingConnection.tokenExpMs = Date.now() - 1000;
assert.equal(atlanticYachtingTokenExpired(), true, 'a past exp must read as expired');
atlanticYachtingConnection.tokenExpMs = Date.now() + 600000;
assert.equal(atlanticYachtingTokenExpired(), false, 'a future exp must read as live');
atlanticYachtingConnection.tokenExpMs = null;
assert.equal(atlanticYachtingTokenExpired(), false, 'an unknown exp must not block filing');

// An expiring token is the routine case, so it must be told apart from a genuine failure.
assert.equal(isAtlanticYachtingAuthError(new Error('Unauthorized: Invalid token or account suspended.')), true);
assert.equal(isAtlanticYachtingAuthError(new Error('Club request failed (500)')), false);

atlanticYachtingConnection.token = 'x';
atlanticYachtingConnection.user = { email: 'a@b.com' };
clearAtlanticYachtingToken();
assert.equal(atlanticYachtingConnection.token, null, 'clearing must drop the token');
assert.equal(atlanticYachtingConnection.user, null, 'clearing must drop the identity');

console.log('Atlantic Yachting direct connection assertions passed');
