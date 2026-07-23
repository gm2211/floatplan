import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// iOS Safari zooms the page (and stays zoomed) when a focused control's font size is
// below 16px, which clips the topbar title and pushes the fixed tabbar off-screen.
assert.match(
  html,
  /@media \(max-width: 699px\)[\s\S]*?input\[type="datetime-local"\], input\[type="number"\], input\[type="text"\],\s*input\[type="tel"\], select, textarea, \.plan-code-field \{ font-size: 16px; \}/,
  'mobile widths should give every editable control a 16px font so iOS never auto-zooms on focus'
);

// The rule must come after the base control styles and the .plan-code-field override so it
// wins the cascade (equal specificity resolves by order).
const mobileRule = html.indexOf('input[type="tel"], select, textarea, .plan-code-field { font-size: 16px; }');
const baseControls = html.indexOf('padding: 8px 10px; font-size: 14px; font-family: inherit;');
const planCodeField = html.indexOf('font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px;');
assert.ok(baseControls !== -1 && planCodeField !== -1 && mobileRule !== -1, 'expected all three rules to exist');
assert.ok(mobileRule > baseControls, 'the 16px mobile rule must follow the base 14px control rule');
assert.ok(mobileRule > planCodeField, 'the 16px mobile rule must follow the 11px plan-code rule');

// The tabbar itself must stay pinned to the viewport.
assert.match(
  html,
  /\.tabbar \{\s*display: none; position: fixed; bottom: 0; left: 0; right: 0;/,
  'the mobile tabbar should remain fixed to the bottom of the viewport'
);

console.log('mobile input zoom tests passed');
