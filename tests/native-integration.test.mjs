import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { patchADD, stateFor, report, reviewError } from '../scripts/integration.mjs';
import { newLayer } from '../scripts/core.mjs';
const source = process.env.GGA_SOURCE;
const manual = process.env.MANUAL_ADD_SOURCE;
if (!source || !manual) {
  test('native GGA and Manual Damage integration (see README)', { skip: true }, () => {});
} else {
  const { createManualDialogClass, RecipientSession } = await import(
    path.join(manual, 'scripts/dialog.mjs')
  );
  const { collectRecipients } = await import(path.join(manual, 'scripts/core.mjs'));
  globalThis.document = parseHTML('<html><body></body></html>').document;
  const settingsText = fs.readFileSync(path.join(source, 'lib/miscellaneous-settings.js'), 'utf8');
  globalThis.Settings = Object.fromEntries(
    [...settingsText.matchAll(/export const (\w+) = '([^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  let updates = [],
    messages = [],
    errors = [],
    rolls = 0,
    failUpdateAt = 0;
  const settings = new Map();
  function reset() {
    updates = [];
    messages = [];
    errors = [];
    rolls = 0;
    failUpdateAt = 0;
    settings.clear();
    for (const key of [
      'SETTING_BLUNT_TRAUMA',
      'SETTING_LOCATION_MODIFIERS',
      'SETTING_APPLY_DIVISOR',
    ])
      settings.set(Settings[key], true);
    settings.set('enabled', true);
    settings.set(Settings.SETTING_DEFAULT_ADD_ACTION, 'apply');
    settings.set(Settings.SETTING_SIMPLE_DAMAGE, true); // Must still open full ADD.
    game.user = { id: 'gm', name: 'GM', isGM: true };
    game.users = [{ id: 'gm', name: 'GM', isGM: true, active: true, avatar: 'gm.png' }];
    GURPS.lastInjuryRolls = {};
  }
  globalThis.game = {
    user: {},
    users: [],
    version: '14.367',
    actors: new Map(),
    settings: { get: (_scope, key) => settings.get(key) },
    i18n: { localize: (key) => key },
  };
  globalThis.canvas = { tokens: { placeables: [] } };
  globalThis.ui = {
    notifications: { warn: (x) => errors.push(x), error: (x) => errors.push(x), info: () => {} },
  };
  globalThis.foundry = {
    utils: {
      mergeObject: (a, b) => ({ ...a, ...b }),
      randomID: () => Math.random().toString(36).slice(2),
      isNewerVersion: () => false,
    },
  };
  globalThis.Application = class {
    static get defaultOptions() {
      return { classes: [] };
    }
    constructor(options = {}) {
      this.options = { ...this.constructor.defaultOptions, ...options };
    }
    render() {
      this.rendered = true;
      return this;
    }
    async close() {
      this.rendered = false;
    }
    getData() {
      return {};
    }
    activateListeners() {}
  };
  globalThis.objectToArray = (x) => Object.values(x ?? {});
  globalThis.zeroFill = (n, w) => String(n).padStart(w, '0');
  globalThis.generateUniqueId = () => Math.random().toString(36).slice(2);
  globalThis.isNiceDiceEnabled = () => false;
  globalThis.TokenActions = { fromToken: async () => null, fromActor: async () => null };
  globalThis.hitlocation = { LIMB: 'limb', EXTREMITY: 'extremity', CHEST: 'chest', GROIN: 'groin' };
  globalThis.HitLocationEntry = {
    findLocation: (entries, name) => entries.find((x) => x.where === name),
    getLargeAreaDR: (entries) => entries[0].getDR(),
  };
  globalThis.GURPS = {
    DamageTables: {
      woundModifiers: Object.fromEntries(
        Object.entries({
          cr: 1,
          cut: 1.5,
          imp: 2,
          burn: 1,
          tox: 1,
          fat: 1,
          'pi-': 0.5,
          pi: 1,
          'pi+': 1.5,
          'pi++': 2,
        }).map(([k, multiplier]) => [k, { multiplier }]),
      ),
      translate: (x) => x,
    },
    lastInjuryRolls: {},
  };
  globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
  globalThis.ChatMessage = {
    getSpeaker: () => ({ alias: 'GM' }),
    create: async (data) => {
      const message = { id: String(messages.length), ...data };
      messages.push(message);
      return message;
    },
  };
  globalThis.renderTemplate = async (name, data) =>
    name.endsWith('chat-damage-results.hbs')
      ? JSON.stringify(data)
      : `<div class="results-table">${data.CALC?.pointsToApply}</div>`;
  globalThis.$ = (html) => ({ find: () => ({ clone: () => ({ html: () => html }) }) });
  globalThis.Roll = {
    create: () => ({
      total: 1,
      evaluate: async () => {
        rolls++;
      },
      toMessage: async () => {},
    }),
  };
  function load(file, className) {
    let code = fs.readFileSync(path.join(source, file), 'utf8');
    code = code.replace(/^import [\s\S]*? from ['"][^'"]+['"]\s*;?\s*$/gm, '');
    code = code.replace(/export default class /, 'class ').replace(/export class /g, 'class ');
    return vm.runInThisContext(`(function(){${code}\nreturn ${className};})()`, { filename: file });
  }
  globalThis.CompositeDamageCalculator = load(
    'module/damage/damagecalculator.js',
    'CompositeDamageCalculator',
  );
  const NativeADD = load('module/damage/applydamage.js', 'ApplyDamageDialog');
  // Foundry/jQuery's native event wiring is outside this DOM harness.
  NativeADD.prototype.activateListeners = function () {};
  GURPS.ApplyDamageDialog = NativeADD;
  globalThis.libWrapper = {
    register(_id, target, fn, type) {
      assert.equal(type, 'WRAPPER');
      const method = target.split('.').at(-1),
        previous = NativeADD.prototype[method];
      NativeADD.prototype[method] = function (...args) {
        return fn.call(this, previous.bind(this), ...args);
      };
    },
  };
  patchADD(NativeADD, async () => {});
  const Manual = createManualDialogClass(NativeADD);
  function actor(id, dr = 4) {
    const a = {
      id,
      uuid: `Actor.${id}`,
      name: id,
      img: 'npc.png',
      isOwner: true,
      hasPlayerOwner: true,
      defaultHitLocation: 'Torso',
      effects: [],
      system: {
        HP: { value: 30, max: 10 },
        FP: { value: 10, max: 10 },
        attributes: { ST: { value: 10 } },
        ads: {},
        hitlocations: {},
        additionalresources: { tracker: {} },
      },
      _additionalResources: { tracker: {} },
      _hitLocationRolls: {
        Torso: { role: 'chest' },
        Vitals: { role: 'chest' },
        'Left Arm': { role: 'limb' },
      },
    };
    a.hitLocationsWithDR = ['Torso', 'Vitals', 'Left Arm'].map((where) => ({
      where,
      dr,
      getDR: () => dr,
    }));
    a.system.hitlocations = Object.fromEntries(
      a.hitLocationsWithDR.map((v, i) => [i, { where: v.where, dr: String(dr) }]),
    );
    a.getFlag = (_id, key) => a.flags?.[key];
    a.flags = {};
    a.getOwners = () => [{ id: 'gm' }];
    a.update = async (changes) => {
      if (failUpdateAt && updates.length + 1 === failUpdateAt)
        throw new Error('Simulated document update failure');
      updates.push({ id, changes });
      for (const [key, value] of Object.entries(changes)) {
        const parts = key.split('.');
        let target = a;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    };
    return a;
  }
  function recipient(a, id = a.id, linked = false) {
    const doc = {
      id,
      name: id,
      uuid: `Scene.s.Token.${id}`,
      actorLink: linked,
      texture: { src: 'token.png' },
    };
    const token = { actor: a, document: doc };
    return collectRecipients([token], game.user, false).recipients[0];
  }
  function session(actors, seed = { damage: 12, damageType: 'cut', armorDivisor: 1 }) {
    const s = new RecipientSession(
      Manual,
      actors.map((a) => recipient(a)),
      seed,
      () => {},
    );
    s.show();
    return s;
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  function layers(a, ...data) {
    a.flags.profile = {
      schema: 1,
      enabled: true,
      layers: data.map((x) => ({ ...newLayer(['Torso']), ...x })),
    };
    return a;
  }
  async function ready(d) {
    await d.getData();
    return d;
  }
  test('native ADD reads the active named set and prevents HP writes for unresolved equipment', async () => {
    reset();
    const a = layers(actor('sets', 99), { dr: 12, hardened: 1 }, { dr: 6 });
    const combat = structuredClone(a.flags.profile);
    const everyday = structuredClone(combat);
    everyday.layers = [{ ...newLayer(['Torso']), dr: 2 }];
    a.flags.profile = {
      schema: 2,
      activeId: 'combat',
      sets: [
        { id: 'default', name: 'Everyday', profile: everyday },
        { id: 'combat', name: 'Combat', profile: combat },
      ],
    };
    const d = await ready(new NativeADD(a, { damage: 20, damageType: 'cut', armorDivisor: 3 }));
    assert.equal(d._calculator.effectiveDR, 8);
    combat.layers[0].reviewRequired = true;
    combat.layers[0].dr = null;
    assert.match(reviewError(stateFor(d)), /needs review/);
    await assert.rejects(d.resolveInjury(true, 18, true, 'calculated result'), /needs review/);
    assert.equal(a.system.HP.value, 30);
    assert.equal(updates.length, 0);
    assert.equal(messages.length, 0);
    combat.layers[0].dr = 12;
    combat.layers[0].reviewRequired = false;
    assert.equal(reviewError(stateFor(d)), '');
    await d.resolveInjury(true, d._calculator.pointsToApply, true, 'calculated result');
    assert.equal(a.system.HP.value, 12);
  });
  test('native ADD and Manual Damage both use layers; native wound modifier and HP update remain', async () => {
    reset();
    const a = layers(actor('one', 99), { dr: 12, hardened: 1 }, { dr: 6 });
    const d = await ready(new NativeADD(a, { damage: 20, damageType: 'cut', armorDivisor: 3 }));
    assert.equal(d._calculator.DR, 18);
    assert.equal(d._calculator.effectiveDR, 8);
    assert.equal(d._calculator.penetratingDamage, 12);
    assert.equal(d._calculator.pointsToApply, 18);
    assert.equal(d.isSimpleDialog, false);
    await d.resolveInjury(
      true,
      d._calculator.pointsToApply,
      true,
      '<div id="result-dr"></div><div></div><div></div>',
    );
    await tick();
    assert.equal(a.system.HP.value, 12);
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /Armour|armour|layers/);
    reset();
    const b = layers(actor('two', 99), { dr: 12, hardened: 1 }, { dr: 6 });
    const s = session([b], { damage: 20, damageType: 'cut', armorDivisor: 3 });
    await ready(s.dialog);
    await s.dialog.submitInjuryApply({}, true, true);
    await tick();
    assert.equal(b.system.HP.value, 12);
    assert.match(messages[0].content, /Manual damage/);
    assert.match(messages[0].content, /effective DR 8/);
  });
  test('native calculated blunt trauma uses damage reaching flexible DR', async () => {
    reset();
    const a = layers(actor('one'), { dr: 6 }, { dr: 20, flexible: true });
    const d = await ready(new NativeADD(a, { damage: 20, damageType: 'cr', armorDivisor: 1 }));
    assert.equal(d._calculator.pointsToApply, 2);
    assert.equal(d._calculator.effectiveBluntTrauma, 2);
  });
  test('temporary overrides do not alter actor flags and actor saves are read live', async () => {
    reset();
    const a = layers(actor('one'), { dr: 5 });
    const d = await ready(new NativeADD(a, { damage: 20, damageType: 'cr', armorDivisor: 1 }));
    const state = stateFor(d);
    state.override = { schema: 1, enabled: true, layers: [{ ...newLayer(['Torso']), dr: 12 }] };
    assert.equal(d._calculator.effectiveDR, 12);
    assert.equal(a.flags.profile.layers[0].dr, 5);
    state.override = null;
    a.flags.profile.layers[0].dr = 9;
    assert.equal(d._calculator.effectiveDR, 9);
    state.useLayers = false;
    assert.equal(d._calculator.effectiveDR, 4);
  });
  test('per-target armour remains distinct in Manual Damage queue', async () => {
    reset();
    const a = layers(actor('one', 99), { dr: 2 }),
      b = layers(actor('two', 99), { dr: 8 });
    const s = session([a, b], { damage: 12, damageType: 'cr', armorDivisor: 1 });
    await ready(s.dialog);
    await s.dialog.submitInjuryApply({}, false, true);
    await ready(s.dialog);
    assert.equal(s.dialog.actor, b);
    assert.equal(s.dialog._calculator.effectiveDR, 8);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 20);
    assert.equal(b.system.HP.value, 26);
  });
  test('large-area review blocks application until explicit native fallback', async () => {
    reset();
    const a = layers(actor('one'), { dr: 5 });
    const d = await ready(new NativeADD(a, { damage: 20, damageType: 'cr', armorDivisor: 1 }));
    d._calculator.hitLocation = 'Large-Area';
    assert.match(reviewError(stateFor(d)), /specific hit location/);
    await assert.rejects(d.resolveInjury(true, 1, true, 'results'));
    assert.equal(updates.length, 0);
    stateFor(d).useLayers = false;
    assert.equal(reviewError(stateFor(d)), '');
  });
  test('inner rigid armour after flexible stopping requires reviewed blunt trauma', async () => {
    reset();
    const a = layers(actor('one'), { dr: 20, flexible: true }, { dr: 4 });
    const d = await ready(new NativeADD(a, { damage: 20, damageType: 'cr', armorDivisor: 1 }));
    assert.match(reviewError(stateFor(d)), /inner rigid/);
    d._calculator._calculators[0]._bluntTrauma = 0;
    assert.equal(reviewError(stateFor(d)), '');
    assert.equal(d._calculator.pointsToApply, 0);
  });
  test('multi-hit native calculator applies protection to every hit', async () => {
    reset();
    const a = layers(actor('one'), { dr: 6 });
    const d = await ready(
      new NativeADD(a, [
        { damage: 10, damageType: 'cr', armorDivisor: 1 },
        { damage: 12, damageType: 'cr', armorDivisor: 1 },
      ]),
    );
    assert.equal(d._calculator.pointsToApply, 10);
    assert.deepEqual(
      d._calculator._calculators.map((c) => c.penetratingDamage),
      [4, 6],
    );
  });
  test('ADD panel stays inside application content; native single-DR controls are disabled', async () => {
    reset();
    const a = layers(actor('one'), { dr: 6, hardened: 1 });
    const d = await ready(new NativeADD(a, { damage: 12, damageType: 'cut', armorDivisor: 2 }));
    const { document: doc } = parseHTML(
      '<div class="window-app"><header>Title</header><section class="window-content"><div class="gga-app"><div id="override-dr"><input><button></button></div><input id="hardened"><input id="flexible-armor"><div id="result-dr"></div><div>6</div><div>Torso</div><div>Effective</div><div>3</div><div>wrong formula</div><div id="result-penetrating"></div></div></section></div>',
    );
    const root = doc.querySelector('.window-app');
    d.activateListeners(root);
    d.activateListeners(root);
    assert.equal(root.querySelectorAll('.armour-add-panel').length, 1);
    assert.equal(root.querySelector('.armour-add-panel').parentElement.className, 'gga-app');
    assert.equal(root.querySelector('#override-dr input').disabled, true);
    assert.match(
      root.querySelector('#result-penetrating').previousElementSibling.textContent,
      /each layer/,
    );
    assert.match(root.querySelector('summary').textContent, /effective DR 6/);
  });
  test('native DR fallback, injury tolerance and quiet messages still work', async () => {
    reset();
    const a = actor('one', 4);
    a.system.ads = { a: { name: 'Injury Tolerance (Unliving)', notes: '', contains: {} } };
    const d = await ready(new NativeADD(a, { damage: 12, damageType: 'pi', armorDivisor: 1 }));
    assert.equal(d._calculator.effectiveDR, 4);
    assert.equal(d._calculator.pointsToApply, 2);
    await d.resolveInjury(true, 2, false, 'results');
    await tick();
    assert.deepEqual(messages[0].whisper, ['gm']);
  });
}
