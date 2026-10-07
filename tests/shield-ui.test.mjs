import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Handlebars from 'handlebars';
import { parseHTML } from 'linkedom';
import { createShieldEditor, reportShield, openResidual } from '../scripts/shield-editor.mjs';
import { ID } from '../scripts/core.mjs';

Handlebars.registerHelper('checked', (value) => (value ? 'checked' : ''));
const template = Handlebars.compile(
  await readFile(new URL('../templates/shields.hbs', import.meta.url), 'utf8'),
);
class Base {
  static get defaultOptions() {
    return {};
  }
  constructor() {
    this.options = {};
  }
  render() {
    return this;
  }
  activateListeners() {}
}
function setup() {
  globalThis.foundry = {
    utils: { mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'testShield' },
  };
  globalThis.game = { user: { isGM: false }, settings: { get: () => 'blindroll' } };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor.id }),
    applyRollMode: (data, mode) => {
      data.rollMode = mode;
    },
    create: async (data) => {
      globalThis.lastShieldChat = data;
    },
  };
  return {
    id: 'a',
    uuid: 'Actor.a',
    name: 'Tester',
    isOwner: true,
    flags: {},
    system: { additionalresources: { tracker: {} } },
    getFlag(id, key) {
      return this.flags[id]?.[key];
    },
    async update(data) {
      for (const [key, value] of Object.entries(data)) {
        if (key === `flags.${ID}.shields`) this.flags[ID] = { shields: structuredClone(value) };
        else {
          const slot = key.split('.').at(-1);
          if (slot.startsWith('-=')) delete this.system.additionalresources.tracker[slot.slice(2)];
          else this.system.additionalresources.tracker[slot] = structuredClone(value);
        }
      }
    },
  };
}
function render(app) {
  const { document } = parseHTML(template(app.getData()));
  const root = document.querySelector('form');
  // linkedom does not reflect selected defaults and checkboxes exactly like a browser.
  for (const select of root.querySelectorAll('select')) {
    const option = select.querySelector('[selected]') ?? select.querySelector('option');
    if (option) option.selected = true;
  }
  for (const input of root.querySelectorAll('input[type=checkbox]'))
    input.checked = input.hasAttribute('checked');
  app.activateListeners(root);
  return root;
}
async function click(app, root, action) {
  root.querySelector(`[data-shield-action="${action}"]`).click();
  for (let n = 0; n < 20 && app.busy; n++) await new Promise(setImmediate);
  assert.equal(app.busy, false);
}
test('player can add, configure, damage, and undo through the actual form', async () => {
  const a = setup();
  const Editor = createShieldEditor(Base);
  const app = new Editor(a);
  let root = render(app);
  await click(app, root, 'add');
  assert.equal(app.store.items.length, 1);
  root = render(app);
  root.querySelector('[data-shield="enabled"]').checked = true;
  await click(app, root, 'save');
  assert.equal(root.querySelector('[data-error]').textContent, '');
  assert.equal(app.store.items[0].enabled, true);
  root = render(app);
  root.querySelector('[data-damage]').value = '10';
  await click(app, root, 'damage');
  assert.equal(root.querySelector('[data-error]').textContent, '');
  assert.equal(app.store.items[0].hp, 37);
  assert.equal(globalThis.lastShieldChat.rollMode, 'blindroll');
  root = render(app);
  await click(app, root, 'undo');
  assert.equal(app.store.items[0].hp, 40);
});
test('chat escapes labels and notes and preserves configured visibility', async () => {
  const a = setup();
  await reportShield(a, '<img>', '<script>bad</script>');
  assert.match(globalThis.lastShieldChat.content, /&lt;script&gt;/);
  assert.ok(!globalThis.lastShieldChat.content.includes('<img>'));
  assert.equal(globalThis.lastShieldChat.rollMode, 'blindroll');
});
test('residual handoff passes basic damage and divisor to native ADD without actor mutation', async () => {
  const a = setup();
  let received;
  globalThis.GURPS = {
    ApplyDamageDialog: class {
      constructor(actor, data) {
        received = { actor, data };
      }
      render() {}
    },
  };
  await openResidual(a, { residual: 9, type: 'imp', divisor: 2 });
  assert.equal(received.actor, a);
  assert.deepEqual(received.data, {
    damage: 9,
    damageType: 'imp',
    armorDivisor: 2,
    dice: '9',
    attacker: 'a',
  });
  assert.deepEqual(a.flags, {});
  a.isOwner = false;
  await assert.rejects(() => openResidual(a, { residual: 9 }), /permission/);
});
