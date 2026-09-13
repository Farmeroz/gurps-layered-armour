import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentOn, layerFromEquipment, sourceStatus } from '../scripts/equipment.mjs';
import { stackFor, validateProfile, normaliseStore, readProfile } from '../scripts/core.mjs';
import { exportSetup, importSetup } from '../scripts/transfer.mjs';

function actor(eqt) {
  return {
    system: {
      hitlocations: {
        a: { where: 'Torso', dr: 99 },
        b: { where: 'Right Arm', dr: 99 },
        c: { where: 'Left Arm', dr: 99 },
      },
      equipment: { carried: { a: eqt } },
    },
  };
}
const profile = (layer) => ({ schema: 1, enabled: true, layers: [layer] });
const detect = (eqt) => {
  const a = actor(eqt);
  return layerFromEquipment(equipmentOn(a)[0], a);
};
test('equipment scans containers and stored items, deduplicating embedded mirrors but retaining identical names', () => {
  const a = actor({
    name: 'Bag',
    contains: { b: { name: 'Mail', itemid: 'mail', uuid: 'u' } },
    collapsed: { c: { name: 'Mail', uuid: 'v' } },
  });
  a.system.equipment.other = { d: { name: 'Spare helmet' } };
  a.items = [
    {
      id: 'mail',
      type: 'equipment',
      name: 'Mail',
      system: { eqt: { uuid: 'u' }, bonuses: 'DR +6 Torso' },
    },
    { id: 'weapon', type: 'melee', name: 'Sword' },
  ];
  const records = equipmentOn(a);
  assert.equal(records.length, 4);
  assert.equal(records.filter((r) => r.name === 'Mail').length, 2);
  assert.equal(records.find((r) => r.key === 'item:mail').bonuses, 'DR +6 Torso');
  assert.equal(records.find((r) => r.name === 'Spare helmet').carried, false);
});
test('complete GGA DR bonuses preserve location differences, global DR and wildcards', () => {
  const layer = detect({ name: 'Suit', count: 20, bonuses: '[DR +2]\nDR +4 Torso\nDR +3 "*Arm"' });
  assert.equal(layer.dr, 2);
  assert.equal(layer.allLocations, true);
  assert.deepEqual(
    layer.locations.map((l) => [l.where, l.dr]),
    [
      ['Torso', 6],
      ['Right Arm', 5],
      ['Left Arm', 5],
    ],
  );
  layer.reviewRequired = false;
  assert.equal(stackFor(profile(layer), 'Torso', 'cr').rawDR, 6);
  assert.equal(stackFor(profile(layer), 'Right Arm', 'cr').rawDR, 5);
  assert.equal(stackFor(profile(layer), 'Tail', 'cr').rawDR, 2);
});
test('missing and ambiguous DR remain unknown; container locations and sheet totals never become armour values', () => {
  for (const eqt of [
    { name: 'Vest', location: 'Torso' },
    { name: 'Mail', dr: '6/2' },
    { name: 'Armour', bonuses: 'DR -2 Torso' },
    { name: 'Armour', bonuses: 'DR +4 Torso if burning' },
  ]) {
    const layer = detect(eqt);
    assert.equal(layer.dr, null);
    assert.deepEqual(layer.locations, []);
    assert.equal(layer.reviewRequired, true);
    assert.equal(validateProfile(profile(layer)).layers[0].dr, null);
    assert.throws(() => stackFor(profile(layer), 'Skull', 'cr'), /needs review/);
  }
});
test('explicit metadata fills DR and modifiers but still requires review; zero is a known value', () => {
  const layer = detect({
    name: 'Clothing',
    notes: 'DR: 0; Coverage: Torso; Hardened: 2; Flexible',
  });
  assert.equal(layer.dr, 0);
  assert.equal(layer.hardened, 2);
  assert.equal(layer.flexible, true);
  assert.equal(layer.locations[0].where, 'Torso');
  assert.equal(layer.reviewRequired, true);
  assert.deepEqual(layer.source.issues, []);
});
test('changed or removed source keeps saved values; portable files omit source links and accept older exports', () => {
  const a = actor({ uuid: 'u', name: 'Plate', dr: 8, coverage: 'Torso' });
  const layer = layerFromEquipment(equipmentOn(a)[0], a);
  assert.match(sourceStatus(layer, equipmentOn(a)), /unchanged/);
  a.system.equipment.carried.a.dr = 12;
  assert.match(sourceStatus(layer, equipmentOn(a)), /changed/);
  assert.equal(layer.dr, 8);
  assert.match(sourceStatus(layer, []), /unavailable/);
  const exported = exportSetup(profile(layer));
  assert.doesNotMatch(exported, /fingerprint|eqt:u/);
  const imported = importSetup(exported);
  assert.equal(imported.layers[0].dr, 8);
  assert.equal(imported.layers[0].reviewRequired, true);
  assert.equal(imported.layers[0].source, undefined);
  const legacy = JSON.parse(exported);
  legacy.version = 1;
  delete legacy.profile.layers[0].reviewRequired;
  assert.equal(importSetup(JSON.stringify(legacy)).layers[0].dr, 8);
  legacy.profile.layers[0].reviewRequired = 'false';
  assert.throws(() => importSetup(JSON.stringify(legacy)), /Invalid layer/);
});
test('old actor profiles migrate in memory; active set alone supplies ADD and malformed sets are rejected', () => {
  const old = profile(detect({ name: 'Plate', dr: 10, coverage: 'Torso' }));
  old.layers[0].reviewRequired = false;
  const before = JSON.stringify(old),
    store = normaliseStore(old);
  assert.equal(JSON.stringify(old), before);
  assert.equal(store.sets[0].name, 'Default');
  const second = structuredClone(store.sets[0]);
  second.id = 'combat';
  second.name = 'Combat';
  second.profile.layers[0].dr = 20;
  store.sets.push(second);
  store.activeId = 'combat';
  const a = { getFlag: () => store };
  assert.equal(readProfile(a).layers[0].dr, 20);
  assert.equal(store.sets[0].profile.layers[0].dr, 10);
  second.name = 'default';
  assert.throws(() => normaliseStore(store), /unique name/);
  second.name = 'Combat';
  second.id = 'default';
  assert.throws(() => normaliseStore(store), /duplicate set ID/);
});
