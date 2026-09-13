import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, ID } from '../scripts/core.mjs';
let ready,
  opened = [],
  notices = [],
  processor;
class Actors extends Map {
  filter(fn) {
    return [...this.values()].filter(fn);
  }
}
globalThis.Hooks = {
  once: (_name, fn) => {
    ready = fn;
  },
  on() {},
};
globalThis.ui = {
  windows: {},
  notifications: {
    info: (m) => notices.push(m),
    warn: (m) => notices.push(m),
    error: (m) => notices.push(m),
  },
};
globalThis.Application = class {
  static get defaultOptions() {
    return {};
  }
  constructor() {
    this.options = this.constructor.defaultOptions;
  }
  render() {
    this.rendered = true;
    opened.push(this.actor);
    return this;
  }
  bringToTop() {}
};
globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.game = {
  system: { id: 'gurps', version: '0.18.23' },
  user: { isGM: false },
  actors: new Actors(),
  modules: new Map([[ID, {}]]),
};
globalThis.GURPS = {
  ChatProcessors: {
    processorsForAll: () => [],
    processorsForGMOnly: () => [],
    registerProcessor: (p) => {
      processor = p;
    },
  },
  ApplyDamageDialog: class {
    getData() {}
    activateListeners() {}
    resolveInjury() {}
    _renderTemplate() {}
  },
};
const { open, command } = await import('../scripts/main.mjs');
await ready();
const actor = (id, owner = true) => ({
  uuid: `Actor.${id}`,
  name: id,
  isOwner: owner,
  getFlag: () => emptyProfile(),
  system: { hitlocations: { t: { where: 'Torso', dr: '0' } } },
});
test('chat processor exposes /armour and /armor to players without claiming unrelated commands', () => {
  assert.equal(processor.matches('/armour'), true);
  assert.equal(processor.matches('/armor "Ada"'), true);
  assert.equal(processor.matches('/armoured'), false);
  assert.equal(processor.isGMOnly(), false);
  assert.equal(typeof game.modules.get(ID).api.open, 'function');
});
test('named actor opens without canvas; assigned character works without selection', async () => {
  opened = [];
  const named = actor('Ada Lovelace');
  game.actors.set('a', named);
  await command('/armour "Ada Lovelace"');
  assert.equal(opened[0], named);
  const assigned = actor('Assigned');
  game.user.character = assigned;
  await command('/armor');
  assert.equal(opened[1], assigned);
});
test('selected linked actors deduplicate while synthetic actor UUIDs stay distinct', async () => {
  opened = [];
  const shared = actor('shared'),
    one = actor('synthetic1'),
    two = actor('synthetic2');
  globalThis.canvas = {
    tokens: { controlled: [{ actor: shared }, { actor: shared }, { actor: one }, { actor: two }] },
  };
  await open();
  assert.deepEqual(opened, [shared, one, two]);
});
test('explicit missing actor never falls back to selected token; unowned actors denied', async () => {
  opened = [];
  await open({ actor: null });
  await open({ actor: actor('other', false) });
  assert.equal(opened.length, 0);
  assert.ok(notices.some((m) => m.includes('actor you own')));
});
