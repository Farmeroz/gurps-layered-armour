import test from 'node:test';
import assert from 'node:assert/strict';
import {newLayer, emptyProfile, validateProfile, parseSplit, stackFor, traceDamage, hardenedDivisor, canEdit} from '../scripts/core.mjs';
const layer = (dr, props = {}) => ({...newLayer(['Torso']), dr, ...props});
const profile = (...layers) => ({...emptyProfile(), enabled: true, layers});
test('Hardened belongs to its own layer; order does not change basic penetration', () => {
  const outer = layer(12, {hardened: 1}), inner = layer(6);
  for (const layers of [[outer, inner], [inner, outer]]) {
    const stack = stackFor(profile(...layers), 'Torso', 'cut', 3);
    assert.equal(stack.effectiveDR, 8);
    assert.equal(traceDamage(stack, 20, 'cut').penetrating, 12);
  }
});
test('Hardened progression, ignore DR, fractions and unsupported divisors', () => {
  assert.equal(hardenedDivisor(-1, 1), 100);
  assert.equal(hardenedDivisor(-1, 6), 1);
  assert.equal(hardenedDivisor(100, 2), 5);
  assert.equal(hardenedDivisor(4, 1), 2);
  assert.equal(hardenedDivisor(.5, 6), .5);
  assert.throws(() => hardenedDivisor(7, 1));
  assert.equal(stackFor(profile(layer(30), layer(100, {hardened: 1})), 'Torso', 'pi', -1).effectiveDR, 1);
});
test('combined rounding preserves native additive DR for layers sharing a divisor', () => {
  const p = profile(layer(1), layer(1));
  assert.equal(stackFor(p, 'Torso', 'cut', 2).effectiveDR, 1);
  assert.deepEqual(stackFor(p, 'Torso', 'cut', 2).rows.map(r => r.effective), [0, 1]);
  assert.equal(stackFor(profile(layer(0)), 'Torso', 'cr', .5).effectiveDR, 2);
});
test('zero split DR, explicit locations, disabled coverage and uncovered fallback', () => {
  const p = profile(layer(9, {split: {cr: 0, cut: 4}, locations: [{where: 'Torso', dr: 3, split: {cut: 7}}]}));
  assert.equal(stackFor(p, 'Torso', 'cr').rawDR, 0);
  assert.equal(stackFor(p, 'Torso', 'cut').rawDR, 7);
  assert.equal(stackFor(p, 'Torso', 'imp').rawDR, 3);
  assert.equal(stackFor(p, 'Skull', 'imp'), null);
  p.layers[0].enabled = false;
  assert.equal(stackFor(p, 'Torso', 'imp').effectiveDR, 0);
  p.enabled = false;assert.equal(stackFor(p, 'Torso', 'imp'), null);
});
test('outer rigid DR reduces the damage eligible for flexible blunt trauma (B379)', () => {
  const stack = stackFor(profile(layer(6), layer(20, {flexible: true})), 'Torso', 'cr');
  assert.equal(traceDamage(stack, 20, 'cr').bluntTrauma, 2);
  assert.equal(traceDamage(stack, 5, 'cr').bluntTrauma, 0);
  assert.equal(traceDamage(stack, 30, 'cr').bluntTrauma, 0);
  const reverse = stackFor(profile(layer(20, {flexible: true}), layer(6)), 'Torso', 'cr');
  assert.match(traceDamage(reverse, 20, 'cr').review, /inner rigid/);
});
test('consecutive flexible layers combine for blunt trauma; types and penetration respected', () => {
  const stack = stackFor(profile(layer(6, {flexible: true}), layer(10, {flexible: true})), 'Torso', 'cr');
  assert.equal(traceDamage(stack, 15, 'cr').bluntTrauma, 3);
  assert.equal(traceDamage(stack, 15, 'cut').bluntTrauma, 1);
  assert.equal(traceDamage(stack, 15, 'burn').bluntTrauma, 0);
  assert.equal(traceDamage(stack, 17, 'cr').bluntTrauma, 0);
});
test('shotgun multiplier applies to DR before divisors', () => {
  assert.equal(stackFor(profile(layer(3), layer(2)), 'Torso', 'pi', 2, 4).effectiveDR, 10);
});
test('validation rejects malformed flags and ambiguous slash DR; forcefields cannot be flexible', () => {
  assert.throws(() => validateProfile({schema: 2, layers: []}));
  for (const dr of [-1, NaN, Infinity, '4/2', '', .5]) assert.throws(() => validateProfile(profile(layer(dr))));
  assert.deepEqual(parseSplit('cr=0; pi+=8'), {cr: 0, 'pi+': 8});
  assert.throws(() => parseSplit('pi=4; pi=7'));
  assert.throws(() => parseSplit('__proto__=7'));
  assert.equal(validateProfile(profile(layer(2, {kind: 'forcefield', flexible: true}))).layers[0].flexible, false);
  assert.equal(canEdit({isOwner: true}, {isGM: false}), true);
  assert.equal(canEdit({isOwner: false}, {isGM: false}), false);
});
