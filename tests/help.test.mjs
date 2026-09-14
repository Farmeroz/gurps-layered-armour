import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { attachHelp, registerHelpSetting } from '../scripts/help.mjs';
import { ID } from '../scripts/core.mjs';
test('help preference is a client setting enabled by default', () => {
  let registration;
  globalThis.game = { settings: { register: (...args) => (registration = args) } };
  registerHelpSetting();
  assert.equal(registration[0], ID);
  assert.equal(registration[1], 'helpTooltips');
  assert.equal(registration[2].scope, 'client');
  assert.equal(registration[2].default, true);
  assert.equal(registration[2].type, Boolean);
});
test('hover and focus show escaped help; Escape, blur and cleanup remove it; disabled preference retains labels', async () => {
  let enabled = true;
  globalThis.game = { settings: { get: () => enabled } };
  const { document, window } = parseHTML(
    '<html><body><form><button data-help="Use &lt;armour&gt; safely" title="old" aria-label="Add armour" aria-describedby="existing">Add</button></form></body></html>',
  );
  const root = document.querySelector('form'),
    button = root.querySelector('button');
  button.getBoundingClientRect = () => ({ left: 10, bottom: 20 });
  const hide = attachHelp(root);
  assert.equal(button.hasAttribute('title'), false);
  button.dispatchEvent(new window.Event('focus'));
  await new Promise((resolve) => setTimeout(resolve, 480));
  assert.equal(document.querySelector('[role="tooltip"]').textContent, 'Use <armour> safely');
  assert.equal(document.querySelector('armour'), null);
  assert.match(button.getAttribute('aria-describedby'), /^existing armour-help-/);
  const escape = new window.Event('keydown', { bubbles: true });
  escape.key = 'Escape';
  button.dispatchEvent(escape);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(button.getAttribute('aria-describedby'), 'existing');
  button.dispatchEvent(new window.Event('mouseenter'));
  await new Promise((resolve) => setTimeout(resolve, 480));
  assert.ok(document.querySelector('[role="tooltip"]'));
  button.dispatchEvent(new window.Event('blur'));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  enabled = false;
  button.dispatchEvent(new window.Event('focus'));
  await new Promise((resolve) => setTimeout(resolve, 480));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(button.getAttribute('aria-label'), 'Add armour');
  hide();
});
