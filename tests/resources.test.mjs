import test from 'node:test';
import assert from 'node:assert/strict';
import { newLayer, emptyProfile } from '../scripts/core.mjs';
import {
  trackerSyncUpdate,
  readArmourConditions,
  depletionPlan,
  applyDepletion,
} from '../scripts/resources.mjs';

function profile(...layers) {
  return { ...emptyProfile(), enabled: true, layers };
}

function actor(trackers = {}) {
  const a = {
    system: { additionalresources: { tracker: structuredClone(trackers) } },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split('.');
        let target = this;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    },
  };
  return a;
}

test('tracker sync creates a visible remaining-DR pool', () => {
  const a = actor();
  const armour = {
    ...newLayer(['Torso']),
    name: 'Ballistic Vest',
    dr: 12,
    depletion: 'ablative',
    resourceId: 'vest',
  };
  const store = {
    schema: 2,
    activeId: 'default',
    sets: [{ id: 'default', name: 'Default', profile: profile(armour) }],
  };
  const update = trackerSyncUpdate(a, store);
  const tracker = update['system.additionalresources.tracker.0000'];
  assert.equal(tracker.name, 'Armour: Ballistic Vest');
  assert.equal(tracker.value, 12);
  assert.equal(tracker.max, 12);
  assert.equal(tracker.gla.resourceId, 'vest');
});

test('tracker sync preserves existing armour loss when maximum DR changes', () => {
  const a = actor({
    '0000': {
      name: 'Armour: Vest',
      value: 7,
      max: 12,
      gla: { kind: 'armour', resourceId: 'vest', version: 1 },
    },
  });
  const armour = {
    ...newLayer(['Torso']),
    name: 'Vest',
    dr: 14,
    depletion: 'semi-ablative',
    resourceId: 'vest',
  };
  const store = { schema: 2, activeId: 'default', sets: [{ id: 'default', name: 'Default', profile: profile(armour) }] };
  const update = trackerSyncUpdate(a, store);
  assert.equal(update['system.additionalresources.tracker.0000'].max, 14);
  assert.equal(update['system.additionalresources.tracker.0000'].value, 9);
});

test('condition reader and depletion plan use resource IDs', () => {
  const a = actor({
    '0000': {
      name: 'Armour: Vest',
      value: 9,
      max: 12,
      gla: { kind: 'armour', resourceId: 'vest', version: 1 },
    },
  });
  assert.deepEqual(readArmourConditions(a), { vest: 9 });
  assert.deepEqual(
    depletionPlan([
      { rows: [{ resourceId: 'vest', depletionLoss: 2 }, { resourceId: '', depletionLoss: 4 }] },
      { rows: [{ resourceId: 'vest', depletionLoss: 1 }] },
    ]),
    { vest: 3 },
  );
});

test('depletion application refuses stale tracker state', async () => {
  const a = actor({
    '0000': {
      name: 'Armour: Vest',
      value: 9,
      max: 12,
      gla: { kind: 'armour', resourceId: 'vest', version: 1 },
    },
  });
  await assert.rejects(() => applyDepletion(a, { vest: 2 }, { vest: 10 }), /changed/);
  const result = await applyDepletion(a, { vest: 2 }, { vest: 9 });
  assert.equal(a.system.additionalresources.tracker['0000'].value, 7);
  assert.equal(result[0].loss, 2);
});
