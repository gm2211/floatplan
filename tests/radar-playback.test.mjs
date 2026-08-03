import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const playbackStart = html.indexOf('function createRadarFrameLayer');
const playbackEnd = html.indexOf('// Switches between live NEXRAD', playbackStart);
assert.ok(playbackStart >= 0 && playbackEnd > playbackStart, 'radar playback implementation block not found');
const playback = html.slice(playbackStart, playbackEnd);

assert.ok(html.includes('var RADAR_FRAME_FADE_MS = 180;'));
assert.ok(html.includes('var RADAR_FRAME_HOLD_MS = 420;'));
assert.ok(html.includes("className: 'radar-frame-tiles'"), 'radar layers need a shared crossfade class');
assert.ok(html.includes('.radar-map .radar-frame-tiles { transition: opacity 180ms'));
assert.ok(html.includes("window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0"));
assert.ok(playback.includes('function preloadAdjacentRadarFrame()'), 'exactly one adjacent frame should warm before playback advances');
assert.ok(playback.includes("createRadarFrameLayer(frame, radarState.mode === 'forecast', 0, 5)"));
assert.ok(playback.includes('var outgoingLayer = radarState.currentLayer;'), 'the displayed layer must survive while its replacement loads');
assert.ok(playback.includes("layer.once('load', revealLoadedFrame)"), 'uncached frames must wait for complete visible-tile loading');
assert.ok(playback.includes('outgoingLayer.setOpacity(0)'), 'the old frame should fade only after the new frame is ready');
assert.ok(playback.includes('radarState.map.removeLayer(outgoingLayer)'), 'the old frame should be removed after the fade');
assert.ok(playback.includes('radarState.retiringLayer = outgoingLayer'), 'interrupted fades must retain the layer cleanup target');
assert.ok(playback.includes('radarState.map.removeLayer(radarState.retiringLayer)'), 'rapid scrubbing must not leak an interrupted outgoing layer');
assert.ok(!playback.includes('if (radarState.currentLayer) radarState.map.removeLayer(radarState.currentLayer)'), 'frame changes must not flash the base map');

const toggleStart = html.indexOf('function toggleRadarPlay()');
const toggleEnd = html.indexOf('// Fallback when the NEXRAD', toggleStart);
const toggle = html.slice(toggleStart, toggleEnd);
assert.ok(toggle.includes('scheduleRadarPlayback(0)'), 'play should begin from the preloaded adjacent frame');
assert.ok(!toggle.includes('setInterval'), 'playback cadence must wait for frame readiness instead of racing the network');
assert.ok(toggle.includes('clearTimeout(radarState.playTimer)'));

console.log('radar playback preload and crossfade assertions passed');
