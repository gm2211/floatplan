import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

globalThis.DEFAULT_LIMITS = { reefLow: 15, reefHigh: 18, noGoSustained: 20, noGoGust: 25 };
globalThis.round1 = (value) => Math.round(value * 10) / 10;
globalThis.fmtTime = (ms) => new Date(ms).toISOString().slice(11, 16);

function evaluateBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block not found: ${startMarker}`);
  (0, eval)(html.slice(start, end));
}

evaluateBetween('function alertEndMs', 'function computePreMotorAdvice');
evaluateBetween('function windowAdvisorySummaries', '// Compact structured snapshot');
evaluateBetween('function composeTemplateNarrative', 'function buildNarrativePromptText');
evaluateBetween('function buildNarrativePromptText', 'function sanitizeNarrativeOutput');

const departureMs = Date.parse('2026-07-15T17:00:00-04:00');
const returnMs = Date.parse('2026-07-15T20:00:00-04:00');
const alert = (event, start, end) => ({ properties: { event, onset: start, ends: end } });
const advisories = windowAdvisorySummaries([
  alert('Air Quality Alert', '2026-07-15T09:00:00-04:00', '2026-07-15T12:00:00-04:00'),
  alert('Air Quality Alert', '2026-07-15T15:00:00-04:00', '2026-07-16T00:00:00-04:00'),
  alert('Air Quality Alert', '2026-07-15T16:00:00-04:00', '2026-07-15T22:00:00-04:00'),
  alert('Special Marine Warning', '2026-07-15T17:15:00-04:00', '2026-07-15T18:00:00-04:00'),
  alert('Special Marine Warning', '2026-07-15T17:30:00-04:00', '2026-07-15T18:15:00-04:00')
], departureMs, returnMs);

assert.equal(advisories.length, 3, 'duplicate advisories collapse but distinct warnings remain');
assert.equal(advisories.filter((item) => item.event === 'Air Quality Alert').length, 1);
assert.equal(advisories.filter((item) => item.event === 'Special Marine Warning').length, 2);
assert.equal(advisories.find((item) => item.event === 'Air Quality Alert').endMs,
  Date.parse('2026-07-16T00:00:00-04:00'), 'dedupe must retain the latest overlapping end');

const narrative = composeTemplateNarrative({
  departure: 'Jul 15 at 5:00 PM',
  returnTime: 'Jul 15 at 8:00 PM',
  turnaroundMs: Date.parse('2026-07-15T18:32:00-04:00'),
  turnaroundTime: '6:32 PM',
  currentPhase: 'ebb',
  initialHeading: 'N',
  currentEvents: [{ ms: Date.parse('2026-07-15T18:47:00-04:00'), type: 'slack', time: '6:47 PM', speedKt: 0 }],
  currentTimeline: [
    { time: '5:00 PM', label: 'departure', phase: 'ebb', speedKt: 1.8 },
    { time: '6:47 PM', label: 'turn', phase: 'slack', speedKt: 0 },
    { time: '8:00 PM', label: 'return', phase: 'flood', speedKt: 0.6 }
  ],
  windDirection: 'NNW',
  windSustainedMinKt: 6,
  windSustainedMaxKt: 7,
  windGustMaxKt: 20,
  windGustMaxTime: '5:00 PM',
  observed_now: { windSustainedKt: 22, windGustKt: 26 },
  reefBandLow: 15,
  reefBandHigh: 18,
  advisories: [{ event: 'Special Marine Warning', endsTime: '6:15 PM' }],
  vessel: { name: 'AY10', crewCount: '3', phone: null },
  pre_motor: {
    sentence: 'available', direction: 'N', durationMin: 45, target: 'Intrepid',
    opposingCurrentKt: 1.8, currentPhase: 'ebb'
  },
  verdictReasons: ['Sustained 7.0 kt, gusts 20.0 kt — within limits'],
  tideEvents: [{ type: 'low', time: '3:51 PM' }, { type: 'high', time: '9:54 PM' }],
  sunset: '8:26 PM'
});

assert.equal(narrative.split('8:00 PM back').length - 1, 1, 'return deadline must appear once');
assert.equal(narrative.split('6:47 PM').length - 1, 1, 'slack time must appear once');
assert.equal(narrative.split('20 kt').length - 1, 1, 'gust value must appear once');
assert.equal(narrative.split('Special Marine Warning').length - 1, 1, 'exceptional warning must appear once');
assert.ok(!narrative.includes('within limits'), 'generic verdict boilerplate must be omitted');
assert.ok(!narrative.includes('Battery tide'), 'non-actionable tide facts must be omitted');
assert.ok(!narrative.includes('Sunset'), 'sunset must not be repeated when it does not constrain return');
assert.ok(!narrative.includes('Expected return'), 'check-in must not repeat the return deadline');
assert.ok(narrative.includes('CURRENT & ROUTE'));
assert.ok(narrative.includes('WIND & WEATHER'));
assert.ok(narrative.includes('ABOARD & CHECK-IN'));
assert.ok(!narrative.includes('SAFETY NOTES\n'));
assert.ok(narrative.includes('5:00 PM depart — ebb 1.8 kt · 6:47 PM — slack · 8:00 PM back — flood 0.6 kt'));
assert.ok(narrative.includes('Head north against the ebb'));
assert.ok(narrative.includes('turn near 6:32 PM before slack'));
assert.ok(!narrative.includes('then return to Pier 25'), 'route should not repeat the return action');
assert.ok(!narrative.includes('Observed now'), 'live observation comparison belongs in the wind widget, not the compact plan');
assert.ok(narrative.includes('4 aboard (skipper + 3 crew)'));
assert.ok(narrative.split(/\s+/).length <= 90,
  `representative compact plan must stay within 90 words (${narrative.split(/\s+/).length})\n${narrative}`);

const emptySafety = composeTemplateNarrative({
  departure: '5:00 PM', returnTime: '8:00 PM', windSustainedMaxKt: 6,
  reefBandLow: 15, reefBandHigh: 18, advisories: [], vessel: {}
});
assert.ok(!emptySafety.includes('Advisories: none'), 'empty advisory copy must be omitted');

const withCurrent = composeTemplateNarrative({
  departure: '5:00 PM', returnTime: '8:00 PM', initialHeading: 'N', currentPhase: 'flood',
  windSustainedMaxKt: 6, reefBandLow: 15, reefBandHigh: 18, advisories: [], vessel: {}
});
assert.ok(withCurrent.includes('Head north on the flood'), 'northbound on flood must not say against current');

const turnAfterSlack = composeTemplateNarrative({
  departure: '5:00 PM', returnTime: '8:00 PM', turnaroundMs: 200, turnaroundTime: '7:00 PM',
  currentEvents: [{ ms: 100, type: 'slack', time: '6:47 PM' }],
  windSustainedMaxKt: 6, reefBandLow: 15, reefBandHigh: 18, advisories: [], vessel: {}
});
assert.ok(turnAfterSlack.includes('after slack at 6:47 PM'), 'turn/event relationship must follow timestamps');

const noGo = composeTemplateNarrative({
  departure: '5:00 PM', returnTime: '8:00 PM', windSustainedMaxKt: 22,
  windGustMaxKt: 28, windGustMaxTime: '5:00 PM', reefBandLow: 15, reefBandHigh: 18,
  verdictLevel: 'NO-GO', verdictReasons: ['Sustained wind exceeds limit'], advisories: [], vessel: {}
});
assert.ok(noGo.includes('NO-GO: forecast exceeds configured safety limits.'), 'wind NO-GO must remain explicit');

const thunder = composeTemplateNarrative({
  departure: '5:00 PM', returnTime: '8:00 PM', windSustainedMaxKt: 7,
  reefBandLow: 15, reefBandHigh: 18, verdictLevel: 'NO-GO',
  verdictReasons: ['Thunderstorms in forecast 5:00 PM'], advisories: [], vessel: {}
});
assert.equal(thunder.split('Thunderstorms in forecast 5:00 PM').length - 1, 1,
  'thunder NO-GO reason must be retained exactly once');

const prompt = buildNarrativePromptText({ reefBandLow: 15, reefBandHigh: 18 });
assert.ok(prompt.includes('max 90 words'));
assert.ok(prompt.includes('State each time, speed, gust, alert, and action only once.'));
assert.ok(prompt.includes('CURRENT & ROUTE'));
assert.ok(prompt.includes('ABOARD & CHECK-IN'));

assert.equal(isExceptionalPlanAdvisory({ event: 'Air Quality Alert' }), false,
  'routine advisory should not crowd the compact plan');
assert.equal(isExceptionalPlanAdvisory({ event: 'Special Marine Warning' }), true,
  'marine warnings remain in the compact plan');
assert.equal(isActionablePlanPrecip('Partly cloudy — precip chance up to 8%.'), false,
  'dry/benign weather summary should be omitted');
assert.equal(isActionablePlanPrecip('Light rain after 7:00 PM — precip chance up to 30%.'), true,
  'actionable precipitation should remain');

const sunsetClose = composeTemplateNarrative({
  returnTime: '8:00 PM', sunsetMarginMin: 25, windSustainedMaxKt: 6,
  reefBandLow: 15, reefBandHigh: 18, advisories: [], vessel: {}
});
assert.ok(sunsetClose.includes('Back 25 min before sunset.'));
const sunsetFar = composeTemplateNarrative({
  returnTime: '6:00 PM', sunsetMarginMin: 145, windSustainedMaxKt: 6,
  reefBandLow: 15, reefBandHigh: 18, advisories: [], vessel: {}
});
assert.ok(!sunsetFar.includes('sunset'), 'distant sunset should not add noise');

console.log('float-plan narrative distillation assertions passed');
