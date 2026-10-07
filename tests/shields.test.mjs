import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shieldRecord,
  capabilities,
  resolveShieldHit,
  applyHTResult,
  repairShield,
  coverAdvice,
} from '../scripts/shields.mjs';
import {
  readShields,
  changeShields,
  undoShields,
  shieldTrackerUpdate,
} from '../scripts/shield-store.mjs';
import { ID } from '../scripts/core.mjs';

const shield = (options = {}) =>
  shieldRecord({ enabled: true, mode: 'detailed', dr: 2, maxHP: 20, db: 2, ...options });
const hit = (s, damage, type = 'cr', extra = {}) => resolveShieldHit(s, { damage, type, ...extra });

test('new shields are opt-in; disabled tracking rejects damage', () => {
  assert.equal(shieldRecord().enabled, false);
  assert.throws(() => hit(shieldRecord(), 10), /Enable/);
});
test('all sample Cover DR values agree with maximum HP formula', () => {
  for (const [dr, maxHP, expected] of [
    [2, 20, 7],
    [6, 36, 15],
    [12, 36, 21],
    [2, 12, 5],
    [4, 10, 6],
    [7, 40, 17],
    [15, 20, 20],
    [0, 10, 2],
  ])
    assert.equal(shield({ dr, maxHP }).coverDR, expected);
});
test('Cover DR stays independent of current HP; DB0 buckler can block without cover', () => {
  const s = shield({ db: 0, dr: 4, maxHP: 10, hp: 2, canCover: false });
  assert.equal(s.coverDR, 6);
  assert.equal(capabilities(s).canBlock, true);
  assert.equal(capabilities(s).canCover, false);
  assert.throws(() => hit(s, 20, 'imp', { reason: 'cover' }), /cannot provide cover/);
});
test('detailed damage subtracts DR before homogeneous injury modifiers', () => {
  assert.equal(hit(shield(), 10, 'cut').loss, 12);
  assert.equal(hit(shield(), 10, 'imp').loss, 4);
  assert.equal(hit(shield(), 10, 'pi').loss, 1);
  assert.equal(hit(shield(), 3, 'pi-').loss, 1);
  assert.equal(hit(shield(), 2, 'cut').loss, 0);
});
test('construction and armour divisor affect detailed injury', () => {
  assert.equal(hit(shield({ construction: 'normal' }), 10, 'imp').loss, 16);
  assert.equal(hit(shield({ construction: 'unliving' }), 10, 'imp').loss, 8);
  assert.equal(hit(shield({ dr: 8 }), 10, 'cr', { divisor: 2 }).loss, 6);
  assert.equal(hit(shield({ dr: 0 }), 10, 'cr', { divisor: 0.5 }).loss, 8);
});
test('detailed thresholds, remaining Block, and enchantment loss', () => {
  const s = shield({ enchanted: true });
  const zero = hit(s, 22).shield;
  assert.equal(zero.hp, 0);
  assert.deepEqual(capabilities(zero), {
    condition: 'disabled',
    db: 0,
    canBlock: true,
    canCover: false,
    coverDR: 7,
  });
  assert.equal(capabilities(shield({ db: 0, hp: 0 })).canBlock, false);
  const destroyed = hit(s, 42).shield;
  assert.equal(destroyed.condition, 'destroyed');
  assert.equal(destroyed.magicLost, true);
  assert.equal(capabilities(destroyed).canBlock, false);
  assert.equal(hit(s, 122).shield.condition, 'pulverised');
});
test('simple mode uses full cutting damage and no fractional hit carry-over', () => {
  const s = shield({ mode: 'simple', coverDR: 10 });
  assert.equal(hit(s, 9).hits, 0);
  assert.equal(hit(s, 10, 'cut').hits, 1);
  assert.equal(hit(s, 19, 'cut').hits, 1);
  assert.equal(hit(s, 19, 'imp').hits, 0);
  assert.equal(hit(s, 20, 'imp').hits, 1);
  assert.equal(hit(s, 49, 'pi').hits, 0);
  assert.equal(hit(s, 50, 'pi').hits, 1);
});
test('simple fourth and seventh hits; one attack uses starting threshold', () => {
  const s = shield({ mode: 'simple', coverDR: 10, enchanted: true });
  const four = hit(s, 40).shield;
  assert.equal(four.hits, 4);
  assert.equal(capabilities(four).db, 1);
  assert.equal(capabilities(four).coverDR, 5);
  assert.equal(four.magicLost, false);
  const seven = hit(four, 15).shield;
  assert.equal(seven.hits, 7);
  assert.equal(seven.condition, 'destroyed');
  assert.equal(seven.magicLost, true);
  assert.equal(hit(shield({ mode: 'simple', hits: 3, coverDR: 10 }), 20).shield.hits, 5);
  assert.equal(
    capabilities(hit(shield({ mode: 'simple', db: 1, coverDR: 10 }), 40).shield).canBlock,
    false,
  );
});
test('simple zero barrier needs a manual ruling instead of infinite hits', () => {
  assert.throws(() => shield({ mode: 'simple', coverDR: 0 }), /positive Cover DR/);
  assert.throws(
    () => hit(shield({ mode: 'simple' }), 10, 'cr', { divisor: 0 }),
    /manual hit ruling/,
  );
});
test('overpenetration is separate from shield HP injury', () => {
  const r = hit(shield(), 17, 'imp', { reason: 'cover' });
  assert.equal(r.loss, 7);
  assert.equal(r.residual, 10);
  assert.equal(hit(shield(), 17, 'imp', { reason: 'db' }).residual, 0);
  assert.equal(hit(shield(), 17, 'cut', { reason: 'cover' }).residual, 0);
  assert.equal(hit(shield(), 17, 'imp', { reason: 'slung' }).residual, 15);
  assert.equal(hit(shield({ mode: 'basic' }), 17, 'cut').residual, 10);
});
test('Massive threshold includes equality; critical Block stops everything', () => {
  const s = shield({ massive: true });
  assert.equal(hit(s, 20, 'imp', { reason: 'massive', margin: 2 }).residual, 6);
  assert.throws(() => hit(s, 20, 'imp', { reason: 'massive', margin: 1 }), /DB intercepted/);
  const r = hit(s, 1000, 'imp', { reason: 'massive', margin: 0, critical: true });
  assert.equal(r.loss, 0);
  assert.equal(r.residual, 0);
  assert.deepEqual(r.shield, s);
});
test('cover includes miss by DB but never treats a hit as a miss', () => {
  const s = shield();
  assert.equal(coverAdvice(s, { legal: true, miss: 2 }).shieldHit, true);
  assert.equal(coverAdvice(s, { legal: true, miss: 3 }).shieldHit, false);
  assert.equal(coverAdvice(s, { legal: true, miss: 0 }).shieldHit, false);
  assert.equal(coverAdvice(s, { legal: false, miss: 1 }).shieldHit, false);
  assert.equal(coverAdvice(s, { legal: true, use: 'slung' }).coverDR, 2);
});
test('Take Cover and optional Total Cover use current DB', () => {
  assert.equal(coverAdvice(shield({ db: 3 }), { legal: true, use: 'take-ranged' }).penalty, 1);
  assert.equal(coverAdvice(shield({ db: 3 }), { legal: true, use: 'take-area' }).areaAllowed, true);
  assert.equal(
    coverAdvice(shield({ db: 2 }), { legal: true, use: 'take-area' }).areaAllowed,
    false,
  );
  assert.equal(
    coverAdvice(shield({ totalCover: true }), { legal: true, posture: 3, sm: 0 }).total,
    true,
  );
  assert.equal(
    coverAdvice(shield({ totalCover: true }), { legal: true, posture: 3, sm: 1 }).total,
    false,
  );
  assert.equal(coverAdvice(shield(), { legal: true, posture: 3 }).total, false);
});
test('Basic HT thresholds are crossed once; detailed mode has no checks', () => {
  const r = hit(shield({ mode: 'basic' }), 65);
  assert.deepEqual(
    r.checks.map((x) => x.threshold),
    [-20, -40],
  );
  assert.equal(hit(shield(), 65).checks.length, 0);
  assert.equal(hit(shield({ mode: 'basic', hp: -20 }), 3).checks.length, 0);
  assert.equal(applyHTResult(shield({ mode: 'basic', hp: 0 }), 'use', 13).condition, 'disabled');
  assert.equal(
    applyHTResult(shield({ mode: 'basic', ht: 20 }), 'destruction', 17).condition,
    'destroyed',
  );
  assert.equal(hit(shield({ mode: 'basic' }), 122).shield.condition, 'destroyed');
});
test('repairs preserve lost magic and refuse pulverised shields/artifacts', () => {
  const s = shield({
    hp: -20,
    condition: 'destroyed',
    enchanted: true,
    magicLost: true,
    cost: 100,
  });
  const r = repairShield(s, 40);
  assert.equal(r.shield.hp, 20);
  assert.equal(r.shield.condition, 'functional');
  assert.equal(r.shield.magicLost, true);
  assert.equal(r.cost, 100);
  assert.equal(repairShield(shield({ hp: 0, cost: 100 }), 20, 3).cost, 30);
  assert.throws(() => repairShield(shield({ hp: -100 }), 20), /pulverised/);
  assert.throws(() => repairShield(shield({ artifact: true }), 20), /GM ruling/);
});
test('bad inputs fail before any damage', () => {
  for (const damage of [-1, NaN, Infinity, '', 1.5]) assert.throws(() => hit(shield(), damage));
  assert.throws(() => hit(shield(), 10, 'cor'));
  assert.throws(() => shield({ id: 'x.y' }));
});

function actor() {
  return {
    uuid: 'Scene.a.Token.b.Actor.c',
    isOwner: true,
    flags: {},
    system: { additionalresources: { tracker: { '0000': { name: 'Other', value: 9 } } } },
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
const user = { isGM: false };
test('atomic flag/tracker save, visible condition, ownership, and undo', async () => {
  const a = actor();
  const initial = JSON.stringify(readShields(a));
  await changeShields(a, initial, 'add', () => [shield()], user);
  assert.equal(a.system.additionalresources.tracker['0000'].value, 9);
  assert.equal(a.system.additionalresources.tracker['0001'].name, 'Shield: Shield');
  const before = JSON.stringify(readShields(a));
  await changeShields(a, before, 'damage', (items) => [hit(items[0], 12).shield], user);
  assert.equal(readShields(a).items[0].hp, 10);
  await undoShields(a, JSON.stringify(readShields(a)), user);
  assert.equal(readShields(a).items[0].hp, 20);
  a.isOwner = false;
  await assert.rejects(
    () => changeShields(a, JSON.stringify(readShields(a)), 'x', () => [], user),
    /own/,
  );
});
test('stale windows and externally edited trackers cannot silently overwrite changes', async () => {
  const a = actor();
  await changeShields(a, JSON.stringify(readShields(a)), 'add', () => [shield()], user);
  const expected = JSON.stringify(readShields(a));
  a.system.additionalresources.tracker['0001'].value = 12;
  assert.equal(readShields(a).items[0].hp, 12);
  await assert.rejects(() => changeShields(a, expected, 'save', () => [shield()], user), /changed/);
  await assert.rejects(
    () => undoShields(a, JSON.stringify(readShields(a)), user),
    /tracker changed/,
  );
});
test('duplicate trackers rejected; removing shield preserves unrelated resources', () => {
  const a = actor();
  a.system.additionalresources.tracker['0001'] = {
    value: 20,
    gla: { kind: 'shield', resourceId: 'shield' },
  };
  const update = shieldTrackerUpdate(a, []);
  assert.deepEqual(update, { 'system.additionalresources.tracker.-=0001': null });
  a.flags[ID] = { shields: { schema: 1, revision: 0, items: [shield()], history: [] } };
  a.system.additionalresources.tracker['0002'] = structuredClone(
    a.system.additionalresources.tracker['0001'],
  );
  assert.throws(() => readShields(a), /Duplicate/);
});
test('concurrent same-client actions are rejected', async () => {
  const a = actor();
  const expected = JSON.stringify(readShields(a));
  let release;
  const pending = changeShields(
    a,
    expected,
    'add',
    async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return [shield()];
    },
    user,
  );
  await assert.rejects(() => changeShields(a, expected, 'add', () => [], user), /still saving/);
  release();
  await pending;
});

test('successive undo walks backward instead of redoing the preceding action', async () => {
  const a = actor();
  await changeShields(a, JSON.stringify(readShields(a)), 'add', () => [shield()], user);
  await changeShields(
    a,
    JSON.stringify(readShields(a)),
    'hit',
    (items) => [hit(items[0], 12).shield],
    user,
  );
  await undoShields(a, JSON.stringify(readShields(a)), user);
  assert.equal(readShields(a).items[0].hp, 20);
  await undoShields(a, JSON.stringify(readShields(a)), user);
  assert.equal(readShields(a).items.length, 0);
  assert.equal(readShields(a).history.length, 0);
});
