import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  html,
  /@media \(min-width: 700px\) and \(max-width: 1199px\)[\s\S]*?\.columns-row\.layout-medium\s*\{\s*flex-wrap:\s*wrap;\s*\}/,
  'the medium dashboard should allow a dedicated full-width pair row'
);
assert.match(
  html,
  /\.columns-row\.layout-medium > \.alerts-pair\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?flex:\s*1 0 100%;/,
  'medium widths should pair the alert cards across the full dashboard width'
);
assert.match(
  html,
  /\.columns-row\.layout-medium > \.alerts-pair > \.card\s*\{\s*margin:\s*0;\s*min-width:\s*0;\s*align-self:\s*start;/,
  'paired medium cards should align independently without overflowing'
);
assert.match(
  html,
  /<div class="alerts-pair hidden" id="alertsPair"><\/div>/,
  'the column dashboard should provide the dedicated alert pair container'
);
assert.match(
  html,
  /medium:\s*\{[\s\S]*?colB:\s*\['windCard', 'radarCard', 'weatherCard', 'observedCard', 'sunTwilightCard'\],[\s\S]*?alertsPair:\s*\['advisoriesCard', 'marineTextCard'\]/,
  'the medium assignment should move only the alert cards into the pair row'
);
assert.match(
  html,
  /\['colA', 'colB', 'colC', 'alertsPair'\]\.forEach\(function \(containerKey\)/,
  'layout application should populate and hide the pair container like other containers'
);
assert.match(
  html,
  /\.columns-row\.layout-medium > \.alerts-pair \.marine-subtitle\s*\{\s*display:\s*none;/,
  'the medium pair should omit the long marine explanation'
);
assert.match(
  html,
  /\.columns-row\.layout-medium > \.alerts-pair \.marine-table th:nth-child\(1\)\s*\{\s*width:\s*16%;\s*\}[\s\S]*?nth-child\(2\)[^\{]*\{\s*width:\s*38%;\s*\}[\s\S]*?nth-child\(3\)[^\{]*\{\s*width:\s*28%;\s*\}[\s\S]*?nth-child\(4\)[^\{]*\{\s*width:\s*18%;/,
  'the medium marine table should use compact readable column proportions'
);

assert.match(
  html,
  /@media \(min-width: 520px\) and \(max-width: 699px\)[\s\S]*?#app\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  'larger narrow widths should use a two-column app grid'
);
assert.match(
  html,
  /#app > \*\s*\{\s*grid-column:\s*1 \/ -1;\s*min-width:\s*0;/,
  'unrelated narrow cards should remain full-width'
);
assert.match(
  html,
  /#app > \.card,\s*#app > \.changed-banner\s*\{\s*margin:\s*0;/,
  'the narrow grid gap should replace card margins'
);
assert.match(
  html,
  /#app > #advisoriesCard,[\s\S]*?#app > #marineTextCard\s*\{\s*grid-column:\s*auto;\s*align-self:\s*start;/,
  'Advisories and Marine Forecast should share a row from 520 through 699px'
);
assert.match(
  html,
  /#app > #marineTextCard \.marine-subtitle\s*\{\s*display:\s*none;/,
  'the narrow pair should omit the long marine explanation'
);
assert.match(
  html,
  /#app > #marineTextCard \.marine-table th:nth-child\(1\)\s*\{\s*width:\s*20%;\s*\}[\s\S]*?nth-child\(2\)[^\{]*\{\s*width:\s*35%;\s*\}[\s\S]*?nth-child\(3\)[^\{]*\{\s*width:\s*25%;\s*\}[\s\S]*?nth-child\(4\)[^\{]*\{\s*width:\s*20%;/,
  'the narrow marine table should reserve enough room for every header'
);

assert.doesNotMatch(
  html,
  /@media \(max-width: 519px\)[\s\S]*?#app\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/,
  'narrow phones should retain the stacked layout'
);
assert.match(
  html,
  /\.columns-row\.layout-wide > #colC\s*\{\s*flex:/,
  'the existing wide three-column rail should remain intact'
);

console.log('responsive alerts layout tests passed');
