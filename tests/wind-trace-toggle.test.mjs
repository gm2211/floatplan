import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ---- locate the production source blocks this test exercises ----------------------------

const lsGetJSONStart = html.indexOf('function lsGetJSON');
const lsGetJSONEnd = html.indexOf('function lsSetJSON', lsGetJSONStart);
assert.ok(lsGetJSONStart >= 0 && lsGetJSONEnd > lsGetJSONStart, 'lsGetJSON not found');
const lsGetJSONSrc = html.slice(lsGetJSONStart, lsGetJSONEnd);

const helpersStart = html.indexOf('var DEFAULT_WIND_TRACE_VISIBILITY');
const helpersEnd = html.indexOf('function renderWindChart', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'wind trace visibility helper block not found');
const helpersSrc = html.slice(helpersStart, helpersEnd);

const splitStart = html.indexOf('function splitWindPointSegments');
const splitEnd = html.indexOf('function windLegendLineSvg', splitStart);
assert.ok(splitStart >= 0 && splitEnd > splitStart, 'wind/observed segment splitters not found');
const splitSrc = html.slice(splitStart, splitEnd);

const pathStart = html.indexOf('function linearPathD');
const pathEnd = html.indexOf('/* ============================== Weather card data model', pathStart);
assert.ok(pathStart >= 0 && pathEnd > pathStart, 'linearPathD/smoothPathD not found');
const pathSrc = html.slice(pathStart, pathEnd);

const initStart = html.indexOf('function init()');
const loadLineStart = html.indexOf("state.windTraceVisibility = lsGetJSON('windTraceVisibility'", initStart);
assert.ok(initStart >= 0 && loadLineStart > initStart, 'wind trace visibility load line not found in init()');
const loadLineEnd = html.indexOf(';', loadLineStart) + 1;
const loadLineSrc = html.slice(loadLineStart, loadLineEnd);

// ---- shared stand-ins for the handful of external helpers these blocks call --------------

function escapeHtmlStub(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function round1Stub(n) { return (Math.round(n * 10) / 10).toFixed(1); }
// vm contexts have their own realm (own Object.prototype), so a plain object built inside one
// fails assert.deepEqual's prototype check against a same-shaped literal in this module. Strip
// that away by round-tripping through JSON before comparing.
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function makeFakeLocalStorage(initial) {
  const store = Object.assign({}, initial);
  return {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; }
  };
}

function buildContext(overrides) {
  const ctx = vm.createContext(Object.assign({
    state: {},
    escapeHtml: escapeHtmlStub,
    round1: round1Stub,
    OBS_WIND_STATION_LABELS: { robbinsReef: 'Robbins Reef', weatherflow: 'Willy Wall' },
    observedWindHistoryForStation: () => [],
    rerenderWindCard: () => {},
    lsSetJSON: () => {}
  }, overrides || {}));
  vm.runInContext(splitSrc, ctx);
  vm.runInContext(pathSrc, ctx);
  vm.runInContext(helpersSrc, ctx);
  return ctx;
}

// ---- (a) default visibility is all-true; a missing/corrupt saved value falls back to it --

for (const corrupt of [undefined, '{not valid json', '42', '"forecast"']) {
  const localStorage = makeFakeLocalStorage(corrupt === undefined ? {} : { 'fp25.windTraceVisibility': corrupt });
  const ctx = vm.createContext({ localStorage, LS_PREFIX: 'fp25.', state: {} });
  vm.runInContext(lsGetJSONSrc, ctx);
  vm.runInContext(helpersSrc, ctx);
  vm.runInContext(loadLineSrc, ctx);
  assert.deepEqual(plain(ctx.state.windTraceVisibility), { forecast: true, robbinsReef: true, willyWall: true },
    'missing/corrupt (' + JSON.stringify(corrupt) + ') must fall back to all traces visible');
}

// A partially-saved preference must only affect the key it actually set — an omitted key
// reads as visible via windTraceVisible's `!== false` check, never as hidden-by-omission.
{
  const localStorage = makeFakeLocalStorage({ 'fp25.windTraceVisibility': '{"willyWall":false}' });
  const ctx = vm.createContext({ localStorage, LS_PREFIX: 'fp25.', state: {} });
  vm.runInContext(lsGetJSONSrc, ctx);
  vm.runInContext(helpersSrc, ctx);
  vm.runInContext(loadLineSrc, ctx);
  assert.equal(ctx.windTraceVisible('willyWall'), false, 'the explicitly saved key must be honored');
  assert.equal(ctx.windTraceVisible('robbinsReef'), true, 'an omitted key must default to visible');
  assert.equal(ctx.windTraceVisible('forecast'), true, 'an omitted key must default to visible');
}

// Toggling flips exactly the touched key, persists the full three-key object, and re-renders.
{
  let saved = null, rerendered = 0;
  const ctx = buildContext({
    state: { windTraceVisibility: { forecast: true, robbinsReef: true, willyWall: true } },
    lsSetJSON: (key, value) => { saved = { key, value }; },
    rerenderWindCard: () => { rerendered += 1; }
  });
  ctx.toggleWindTraceVisibility('willyWall');
  assert.deepEqual(plain(ctx.state.windTraceVisibility), { forecast: true, robbinsReef: true, willyWall: false });
  assert.deepEqual(plain(saved), { key: 'windTraceVisibility', value: { forecast: true, robbinsReef: true, willyWall: false } });
  assert.equal(rerendered, 1, 'every toggle must re-render the wind card');
}

console.log('Wind trace visibility persistence assertions passed');

// ---- (b) the legend markup renders three toggle buttons with aria-pressed ---------------

{
  const ctx = buildContext({
    state: { windTraceVisibility: { forecast: true, robbinsReef: true, willyWall: false } }
  });
  const forecastHtml = ctx.windLegendForecastToggleHtml();
  const robbinsHtml = ctx.windLegendObsToggleHtml({ visKey: 'robbinsReef', swatch: 'swatch-obs', label: 'Robbins Reef' });
  const willyHtml = ctx.windLegendObsToggleHtml({ visKey: 'willyWall', swatch: 'swatch-obs-willy-wall', label: 'Willy Wall' });
  const legendHtml = forecastHtml + robbinsHtml + willyHtml;

  const buttonMatches = legendHtml.match(/<button type="button" class="legend-toggle[^"]*" data-wind-trace="(forecast|robbinsReef|willyWall)" aria-pressed="(true|false)"/g);
  assert.ok(buttonMatches, 'legend must render real <button> toggle chips');
  assert.equal(buttonMatches.length, 3, 'legend must expose exactly three toggle chips: forecast, Robbins Reef, Willy Wall');

  assert.match(forecastHtml, /<button type="button" class="legend-toggle" data-wind-trace="forecast" aria-pressed="true"/,
    'a visible trace must not carry the dimmed .off modifier');
  assert.match(robbinsHtml, /<button type="button" class="legend-toggle" data-wind-trace="robbinsReef" aria-pressed="true"/);
  assert.match(willyHtml, /<button type="button" class="legend-toggle off" data-wind-trace="willyWall" aria-pressed="false"/,
    'a hidden trace must carry the dimmed/struck .off modifier and aria-pressed="false"');
  assert.match(willyHtml, /Willy Wall/, 'the Willy Wall chip must still name its station while dimmed');
}

// Structural guard: the 'All' view must keep per-model entries informational (plain spans)
// and reuse the single forecast toggle rather than one toggle per model.
assert.match(html,
  /legendEl\.innerHTML = '<span class="legend-key-label">Models<\/span>' \+ WIND_MODEL_ORDER\.map\(function \(mk\) \{\s*return '<span>'/,
  "the 'All' view's per-model legend entries must stay informational, not per-model toggles");
assert.match(html, /\}\)\.join\(''\) \+ windLegendForecastToggleHtml\(\)/,
  "the 'All' view must govern every model's prediction lines with the one shared forecast toggle");

console.log('Wind legend toggle markup assertions passed');

// ---- (c) hiding Willy Wall omits its trace/label while Robbins Reef remains --------------

{
  const domStart = 0, domEnd = 3600000, nowMs = 3600000;
  const robbinsHistory = [{ ms: 0, sustainedKt: 10 }, { ms: 300000, sustainedKt: 12 }];
  const willyHistory = [{ ms: 0, sustainedKt: 8 }, { ms: 300000, sustainedKt: 9 }];
  const ctx = buildContext({
    state: { windTraceVisibility: { forecast: true, robbinsReef: true, willyWall: false } },
    observedWindHistoryForStation: station =>
      station === 'robbinsReef' ? robbinsHistory : (station === 'weatherflow' ? willyHistory : [])
  });
  const x = ms => ms / 1000, y = v => 100 - v;

  const series = ctx.buildObservedWindChartSeries(domStart, domEnd, nowMs);
  assert.equal(series.length, 2);
  assert.equal(series[0].station, 'robbinsReef');
  assert.equal(series[0].points.length, 2, 'the visible station keeps its measured samples');
  assert.equal(series[1].station, 'weatherflow');
  assert.equal(series[1].points.length, 0, 'the hidden station has nothing left to draw');

  const combined = ctx.windObservedPathsHtml(series, x, y) + ctx.windObservedMarkersHtml(series, x, y, 700, 46);
  assert.match(combined, /Robbins Reef 12\.0/, 'the visible trace keeps its end-of-trace label');
  assert.match(combined, /var\(--violet\)/, 'the visible trace keeps its stroke color');
  assert.doesNotMatch(combined, /Willy Wall/, 'the hidden trace loses its end-of-trace label');
  assert.doesNotMatch(combined, /var\(--measured-current\)/, 'the hidden trace draws no path or marker');
}

console.log('Willy Wall toggle-off rendering assertions passed');

// ---- (d) hiding forecast omits sustained/gust lines while measured traces remain ---------

{
  const rows = [
    { ms: 0, sustained: 15, gust: 20, dir: 180 },
    { ms: 3600000, sustained: 16, gust: 22, dir: 190 }
  ];
  const x = ms => ms / 1000, y = v => 100 - v, baseline = 100;

  const ctxHidden = buildContext({ state: { windTraceVisibility: { forecast: false, robbinsReef: true, willyWall: true } } });
  const hiddenPaths = ctxHidden.windForecastPathsHtml(rows, ctxHidden.windTraceVisible('forecast'), x, y, baseline, 'var(--accent)', 'var(--ink-dim)');
  assert.equal(hiddenPaths.areaPath, '', 'forecast off must draw no sustained area fill');
  assert.equal(hiddenPaths.sustainedPath, '', 'forecast off must draw no sustained line');
  assert.equal(hiddenPaths.gustPath, '', 'forecast off must draw no gust line');

  const ctxVisible = buildContext({ state: { windTraceVisibility: { forecast: true, robbinsReef: true, willyWall: true } } });
  const visiblePaths = ctxVisible.windForecastPathsHtml(rows, ctxVisible.windTraceVisible('forecast'), x, y, baseline, 'var(--accent)', 'var(--ink-dim)');
  assert.match(visiblePaths.sustainedPath, /var\(--accent\)/, 'forecast on must draw the sustained line');
  assert.match(visiblePaths.gustPath, /var\(--ink-dim\)/, 'forecast on must draw the gust line');

  // Measured traces are independent of the forecast toggle: both stations still render with
  // forecast hidden.
  const robbinsHistory = [{ ms: 0, sustainedKt: 10 }, { ms: 300000, sustainedKt: 12 }];
  const willyHistory = [{ ms: 0, sustainedKt: 8 }, { ms: 300000, sustainedKt: 9 }];
  const ctxMeasured = buildContext({
    state: { windTraceVisibility: { forecast: false, robbinsReef: true, willyWall: true } },
    observedWindHistoryForStation: station =>
      station === 'robbinsReef' ? robbinsHistory : (station === 'weatherflow' ? willyHistory : [])
  });
  const series = ctxMeasured.buildObservedWindChartSeries(0, 3600000, 3600000);
  const combined = ctxMeasured.windObservedPathsHtml(series, x, y) + ctxMeasured.windObservedMarkersHtml(series, x, y, 700, 46);
  assert.match(combined, /Robbins Reef 12\.0/, 'measured Robbins Reef trace must remain while forecast is hidden');
  assert.match(combined, /Willy Wall 9\.0/, 'measured Willy Wall trace must remain while forecast is hidden');
}

console.log('Forecast toggle-off rendering assertions passed');
