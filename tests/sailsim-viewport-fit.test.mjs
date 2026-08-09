import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The Sim tab holds one card behind a tab bar that has already taken the page's vertical
// chrome budget, so the card is sized to the window rather than allowed to overrun it.
assert.match(
  html,
  /@media \(min-width: 900px\) \{[\s\S]*?body\[data-mtab="sim"\] #sailSimCard \{[\s\S]*?height:\s*clamp\(300px,\s*var\(--fp-sim-h,\s*560px\),\s*520px\);/,
  'the sim card should size itself to the measured leftover viewport height, floored and capped'
);
assert.match(
  html,
  /body\[data-mtab="sim"\] #sailSimCard \{[\s\S]*?grid-template-columns:\s*minmax\(250px, 1\.35fr\) minmax\(240px, 0\.9fr\) minmax\(220px, 0\.85fr\);/,
  'the fit layout should spend horizontal space on three columns: route, readouts, ancillary'
);
// `grid-row: 2 / -1` only reaches the end of the EXPLICIT grid, so the ancillary rows must be
// declared rather than left to grid-auto-rows, or the route collapses to a single row tall.
assert.match(
  html,
  /body\[data-mtab="sim"\] #sailSimCard \{[\s\S]*?grid-template-rows:\s*repeat\(5, min-content\) minmax\(0, 1fr\);/,
  'the fit layout should declare its ancillary rows and put the slack in the last one'
);
assert.match(
  html,
  /body\[data-mtab="sim"\] \.sailsim-body,\s*body\[data-mtab="sim"\] \.sailsim-top \{ display: contents; \}/,
  'regrouping should be display:contents so no simulator DOM is reparented'
);
assert.match(
  html,
  /body\[data-mtab="sim"\] \.sailsim-strip-wrap \{\s*grid-column: 1; grid-row: 2 \/ -1;/,
  'the route should span the full height of the fit card'
);
assert.match(
  html,
  /body\[data-mtab="sim"\] #sailSimSvgWrap \{[\s\S]*?aspect-ratio: 4 \/ 3; width: auto; max-width: 100%;\s*\}/,
  'the route should scale by height via an aspect-locked wrapper'
);
// Chart zoom sets an inline width on the svg; the fit layout must only claim the height so
// zooming still works.
assert.match(
  html,
  /body\[data-mtab="sim"\] #sailSimSvgWrap svg \{ height: 100%; \}/,
  'the fit layout should leave the svg width to the chart-zoom code'
);
assert.match(
  html,
  /body\[data-mtab="sim"\] \.sailsim-readouts \{[\s\S]*?grid-row: 2 \/ -1;[\s\S]*?max-height: 367px;/,
  'the readout legend should share the full card height but never stretch past its natural size'
);
assert.match(
  html,
  /body\[data-mtab="sim"\] \.sailsim-controls,[\s\S]*?body\[data-mtab="sim"\] #sailSimCard > \.source-links \{ grid-column: 3; \}/,
  'controls, warning, footnote, error and sources should all move into the third column'
);

// The measured height and the stylesheet must agree on where the fit layout starts.
assert.match(
  html,
  /var SIM_FIT_MIN_WIDTH = 900;/,
  'the measuring code should use the same 900px cutoff as the stylesheet'
);
assert.match(
  html,
  /function updateSimFitHeight\(\) \{[\s\S]*?card\.classList\.contains\('mtab-hidden'\) \|\| window\.innerWidth < SIM_FIT_MIN_WIDTH\) \{[\s\S]*?root\.style\.removeProperty\('--fp-sim-h'\);/,
  'the height should be cleared on other tabs and below the cutoff'
);
assert.match(
  html,
  /function updateSimFitHeight\(\) \{[\s\S]*?card\.getBoundingClientRect\(\)\.top \+ window\.scrollY[\s\S]*?root\.style\.setProperty\('--fp-sim-h',/,
  'the leftover height should be measured from the card offset, not by re-adding each chrome bar'
);
assert.match(
  html,
  /document\.body\.dataset\.mtab = mobileTabUI\.active;/,
  'the active tab should be published to the stylesheet'
);
assert.match(
  html,
  /function afterLayoutChange\(\) \{[\s\S]*?updateSimFitHeight\(\);\s*\}/,
  'a layout change should re-measure the sim fit'
);
assert.match(
  html,
  /window\.addEventListener\('resize', function \(\) \{[\s\S]*?updateSimFitHeight\(\);\s*clearTimeout\(viewportResizeTimer\);/,
  'a resize should re-measure immediately rather than waiting out the relayout debounce'
);

console.log('Sail simulator viewport-fit assertions passed');
