import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schedulerStart = html.indexOf('var sourceRecomputeScheduled');
const schedulerEnd = html.indexOf('function loadSource', schedulerStart);
assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart,
  'source recompute scheduler block must remain discoverable');

const queuedFrames = [];
let recomputeCount = 0;
const context = vm.createContext({
  requestAnimationFrame(callback) { queuedFrames.push(callback); },
  setTimeout(callback) { queuedFrames.push(callback); },
  recomputeWindowDependentUI() { recomputeCount += 1; }
});
vm.runInContext(html.slice(schedulerStart, schedulerEnd), context);

context.scheduleSourceRecompute();
context.scheduleSourceRecompute();
context.scheduleSourceRecompute();
assert.equal(queuedFrames.length, 1, 'same-frame source updates must share one scheduled render');
assert.equal(recomputeCount, 0, 'source updates must yield before the batched render');

queuedFrames.shift()();
assert.equal(recomputeCount, 1, 'the first frame must perform one dashboard recompute');

context.scheduleSourceRecompute();
context.scheduleSourceRecompute();
assert.equal(queuedFrames.length, 1, 'a later burst must also coalesce into one frame');
queuedFrames.shift()();
assert.equal(recomputeCount, 2, 'a later frame must remain able to render fresh data');

const loadSourceStart = html.indexOf('function loadSource', schedulerEnd);
const loadSourceEnd = html.indexOf('// Every loadX()', loadSourceStart);
const loadSourceBlock = html.slice(loadSourceStart, loadSourceEnd);
assert.equal((loadSourceBlock.match(/scheduleSourceRecompute\(\)/g) || []).length, 2,
  'both cached and fresh source applications must use the batched scheduler');
assert.ok(!loadSourceBlock.includes('recomputeWindowDependentUI();'),
  'generic source loading must not trigger full synchronous redraws');

console.log('Source recompute batching assertions passed');
