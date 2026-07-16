import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function estimateLabelWidth');
const end = html.indexOf('// Sail-window status labels', start);
assert.ok(start >= 0 && end > start, 'chart label layout helper block not found');
(0, eval)(html.slice(start, end));

const minX = 34;
const maxX = 666;
const labels = [
  { x: 200, text: 'start 5:00 PM' },
  { x: 380, text: 'turn 6:33 PM' },
  { x: 406, text: 'slack 6:47 PM' },
  { x: 451, text: 'now' },
  { x: 519, text: 'moored 7:45 PM' },
  { x: 548, text: 'end 8:00 PM' }
];

layoutBandLabels(labels, CHART_LABEL_LANE_STEP, minX, maxX);

for (let i = 0; i < labels.length; i++) {
  const a = labels[i];
  assert.ok(a.labelX - a.labelHalfWidth >= minX - 1e-9, `${a.text} must stay inside the left plot edge`);
  assert.ok(a.labelX + a.labelHalfWidth <= maxX + 1e-9, `${a.text} must stay inside the right plot edge`);
  for (let j = i + 1; j < labels.length; j++) {
    const b = labels[j];
    if (a.bandRow === b.bandRow) {
      const left = a.labelX <= b.labelX ? a : b;
      const right = left === a ? b : a;
      assert.ok(
        right.labelX - right.labelHalfWidth - (left.labelX + left.labelHalfWidth) >= CHART_LABEL_HORIZONTAL_GAP - 1e-9,
        `${a.text} and ${b.text} must clear each other horizontally when sharing a lane`
      );
    } else {
      assert.ok(
        Math.abs(a.bandY - b.bandY) >= CHART_LABEL_LANE_STEP,
        `${a.text} and ${b.text} must have full outlined-text clearance in separate lanes`
      );
    }
  }
}

assert.ok(new Set(labels.map(label => label.bandRow)).size >= 2, 'the representative turn/slack/now cluster must use multiple lanes');

const edgeLabels = [
  { x: 34, text: 'ebb 3:50 PM' },
  { x: 666, text: 'flood 9:36 PM' }
];
layoutBandLabels(edgeLabels, CHART_LABEL_LANE_STEP, minX, maxX);
assert.ok(edgeLabels[0].labelX > edgeLabels[0].x, 'left-edge label shifts inward without moving its marker');
assert.ok(edgeLabels[1].labelX < edgeLabels[1].x, 'right-edge label shifts inward without moving its marker');

const bottomLabels = [
  { x: 300, text: 'H 9:41 AM · 5.1 ft' },
  { x: 315, text: 'L 9:51 AM · -0.2 ft' }
];
layoutBandLabels(bottomLabels, -CHART_LABEL_LANE_STEP, minX, maxX);
assert.equal(Math.abs(bottomLabels[0].bandY), 0);
assert.equal(bottomLabels[1].bandY, -CHART_LABEL_LANE_STEP, 'bottom collisions stack upward into the chart, not down into axis text');

const snapshot = labels.map(({ text, labelX, bandRow, bandY }) => ({ text, labelX, bandRow, bandY }));
const rerun = labels.map(({ x, text }) => ({ x, text }));
layoutBandLabels(rerun, CHART_LABEL_LANE_STEP, minX, maxX);
assert.deepEqual(
  rerun.map(({ text, labelX, bandRow, bandY }) => ({ text, labelX, bandRow, bandY })),
  snapshot,
  'lane placement must be deterministic'
);

console.log('Timeline label lane layout assertions passed');
