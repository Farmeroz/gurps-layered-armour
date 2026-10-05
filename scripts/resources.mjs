import { ID, clone, layerMaximumDR, normaliseStore, validateProfile } from './core.mjs';

export const TRACKERS = 'system.additionalresources.tracker';

function integer(value, label, min = 0) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min)
    throw new Error(`${label} must be a whole number of at least ${min}.`);
  return n;
}

export function armourTrackers(actor) {
  const found = new Map();
  for (const [key, tracker] of Object.entries(actor.system?.additionalresources?.tracker ?? {})) {
    const meta = tracker?.gla;
    if (meta?.kind !== 'armour' || !meta.resourceId) continue;
    if (!/^\d+$/.test(key)) throw new Error('An Armour Layers tracker has an invalid slot.');
    if (found.has(meta.resourceId))
      throw new Error(
        'Duplicate Armour Layers condition trackers found. Remove the duplicate tracker.',
      );
    const max = integer(tracker.max, `${tracker.name || 'Armour'} maximum`);
    const value = integer(tracker.value, `${tracker.name || 'Armour'} current value`);
    if (value > max)
      throw new Error(`${tracker.name || 'Armour'} current value exceeds its maximum.`);
    found.set(meta.resourceId, {
      key,
      tracker,
      resourceId: meta.resourceId,
      max,
      value,
      path: `${TRACKERS}.${key}`,
    });
  }
  return found;
}

export function readArmourConditions(actor) {
  return Object.fromEntries(
    [...armourTrackers(actor)].map(([resourceId, record]) => [resourceId, record.value]),
  );
}

function degradingLayers(store) {
  store = normaliseStore(clone(store));
  const found = new Map();
  for (const set of store.sets) {
    const profile = validateProfile(set.profile);
    for (const layer of profile.layers) {
      if (layer.depletion === 'none') continue;
      if (!layer.resourceId)
        throw new Error(
          `${layer.name} uses ${layer.depletion} DR but has no condition tracker link.`,
        );
      const maximum = layerMaximumDR(layer);
      const existing = found.get(layer.resourceId);
      if (existing && existing.maximum !== maximum)
        throw new Error(
          `${layer.name} shares an armour condition tracker with a different maximum DR. Duplicate or relink the layer.`,
        );
      found.set(layer.resourceId, {
        resourceId: layer.resourceId,
        name: layer.name,
        maximum,
        depletion: layer.depletion,
      });
    }
  }
  return found;
}

function nextSlot(root, reserved) {
  let n = Math.max(
    -1,
    ...Object.keys(root)
      .filter((key) => /^\d+$/.test(key))
      .map(Number),
  ) + 1;
  while (reserved.has(String(n).padStart(4, '0'))) n++;
  return String(n).padStart(4, '0');
}

export function trackerSyncUpdate(actor, store) {
  const desired = degradingLayers(store);
  const current = armourTrackers(actor);
  const root = actor.system?.additionalresources?.tracker ?? {};
  const update = {};
  const reserved = new Set(Object.keys(root));

  for (const [resourceId, wanted] of desired) {
    const linked = current.get(resourceId);
    const key = linked?.key ?? nextSlot(root, reserved);
    reserved.add(key);
    const oldMax = linked?.max ?? wanted.maximum;
    const oldValue = linked?.value ?? wanted.maximum;
    const lost = Math.max(0, oldMax - oldValue);
    const value = Math.max(0, wanted.maximum - lost);
    update[`${TRACKERS}.${key}`] = {
      ...(linked?.tracker ?? root[key]),
      name: `Armour: ${wanted.name}`,
      alias: linked?.tracker?.alias || 'DR',
      value,
      max: wanted.maximum,
      min: 0,
      points: linked?.tracker?.points ?? 0,
      pdf: 'B46',
      isDamageTracker: false,
      isDamageType: false,
      isMinimumEnforced: true,
      isMaximumEnforced: true,
      thresholds: linked?.tracker?.thresholds ?? [],
      gla: {
        kind: 'armour',
        resourceId,
        depletion: wanted.depletion,
        version: 1,
      },
    };
  }

  for (const [resourceId, linked] of current) {
    if (!desired.has(resourceId)) update[`${TRACKERS}.-=${linked.key}`] = null;
  }
  return update;
}

export async function syncArmourTrackers(actor, store) {
  const update = trackerSyncUpdate(actor, store);
  if (Object.keys(update).length) await actor.update(update);
}

export function requireConditions(actor, profile) {
  profile = validateProfile(profile);
  const conditions = readArmourConditions(actor);
  for (const layer of profile.layers) {
    if (!layer.enabled || layer.depletion === 'none') continue;
    if (!layer.resourceId)
      throw new Error(`${layer.name} uses ${layer.depletion} DR but has no condition tracker.`);
    if (!Object.hasOwn(conditions, layer.resourceId))
      throw new Error(
        `${layer.name} is missing its visible armour condition tracker. Open Armour Layers and save the actor to recreate it.`,
      );
  }
  return conditions;
}

export function depletionPlan(traces) {
  const losses = {};
  for (const trace of traces) {
    for (const row of trace?.rows ?? []) {
      if (!row.resourceId || !row.depletionLoss) continue;
      losses[row.resourceId] = (losses[row.resourceId] ?? 0) + row.depletionLoss;
    }
  }
  return losses;
}

export async function applyDepletion(actor, losses, expected = null) {
  const current = armourTrackers(actor);
  const update = {};
  const result = [];
  for (const [resourceId, amountRaw] of Object.entries(losses ?? {})) {
    const amount = integer(amountRaw, 'Armour depletion');
    if (!amount) continue;
    const linked = current.get(resourceId);
    if (!linked)
      throw new Error('An armour condition tracker disappeared before damage was applied.');
    if (expected && expected[resourceId] !== linked.value)
      throw new Error(
        `${linked.tracker.name} changed while damage was being applied. Review its current condition before continuing.`,
      );
    const next = Math.max(0, linked.value - amount);
    update[`${linked.path}.value`] = next;
    result.push({
      resourceId,
      name: linked.tracker.name,
      before: linked.value,
      after: next,
      loss: linked.value - next,
    });
  }
  if (Object.keys(update).length) await actor.update(update);
  return result;
}
