import { ID, clone, canEdit } from './core.mjs';
import { shieldRecord } from './shields.mjs';

const PATH = 'system.additionalresources.tracker';
const locks = new Map();
export function readShields(actor) {
  const saved = clone(
    actor.getFlag(ID, 'shields') ?? { schema: 1, revision: 0, items: [], history: [] },
  );
  if (saved.schema !== 1 || !Array.isArray(saved.items))
    throw new Error('Unsupported shield data.');
  const seen = new Set();
  saved.items = saved.items.map((input) => {
    const s = shieldRecord(input);
    if (seen.has(s.id)) throw new Error('Duplicate shield ID.');
    seen.add(s.id);
    const trackers = Object.values(actor.system?.additionalresources?.tracker ?? {}).filter(
      (t) => t?.gla?.kind === 'shield' && t.gla.resourceId === s.id,
    );
    if (trackers.length > 1)
      throw new Error('Duplicate shield condition trackers. Remove the duplicate.');
    if (trackers.length) {
      const field = s.mode === 'simple' ? 'hits' : 'hp';
      s[field] = trackers[0].value;
    }
    return shieldRecord(s);
  });
  return saved;
}
export function shieldTrackerUpdate(actor, items) {
  const root = actor.system?.additionalresources?.tracker ?? {};
  const update = {};
  const used = new Set(Object.keys(root));
  for (const s of items) {
    const found = Object.entries(root).filter(
      ([, t]) => t?.gla?.kind === 'shield' && t.gla.resourceId === s.id,
    );
    if (found.length > 1) throw new Error('Duplicate shield condition trackers.');
    let key = found[0]?.[0];
    if (!key) {
      let n = 0;
      while (used.has(String(n).padStart(4, '0'))) n++;
      key = String(n).padStart(4, '0');
      used.add(key);
    }
    if (!/^\d+$/.test(key)) throw new Error('Invalid shield tracker slot.');
    const simple = s.mode === 'simple';
    update[`${PATH}.${key}`] = {
      ...(found[0]?.[1] ?? {}),
      name: `Shield: ${s.name}`,
      alias: simple ? 'Hits' : 'HP',
      value: simple ? s.hits : s.hp,
      min: simple ? 0 : -10 * s.maxHP,
      max: simple ? 7 : s.maxHP,
      isDamageTracker: simple,
      isDamageType: false,
      isMinimumEnforced: true,
      isMaximumEnforced: true,
      points: 0,
      pdf: s.mode === 'basic' ? 'B484' : '',
      thresholds: [],
      gla: { kind: 'shield', resourceId: s.id, version: 1 },
    };
  }
  for (const [key, t] of Object.entries(root))
    if (t?.gla?.kind === 'shield' && !items.some((s) => s.id === t.gla.resourceId))
      update[`${PATH}.-=${key}`] = null;
  return update;
}
export async function changeShields(
  actor,
  expected,
  action,
  transform,
  user = globalThis.game?.user,
) {
  if (!canEdit(actor, user)) throw new Error('Choose an actor you own.');
  if (locks.has(actor.uuid)) throw new Error('Another shield action is still saving.');
  locks.set(actor.uuid, true);
  try {
    const current = readShields(actor);
    if (JSON.stringify(current) !== expected)
      throw new Error('Shield data changed. Reopen Shields before applying this action.');
    const items = (await transform(clone(current.items))).map(shieldRecord);
    if (items.length > 30) throw new Error('Use at most 30 shields.');
    if (new Set(items.map((s) => s.id)).size !== items.length)
      throw new Error('Duplicate shield ID.');
    if (!canEdit(actor, user)) throw new Error('Permission to edit this actor was lost.');
    if (JSON.stringify(readShields(actor)) !== expected)
      throw new Error('Shield data changed while resolving the action. Reopen Shields.');
    const next = {
      schema: 1,
      revision: current.revision + 1,
      items,
      history: [...(current.history ?? []), { action, before: current.items, after: items }].slice(
        -20,
      ),
    };
    await actor.update({ [`flags.${ID}.shields`]: next, ...shieldTrackerUpdate(actor, items) });
    return readShields(actor);
  } finally {
    locks.delete(actor.uuid);
  }
}
export async function undoShields(actor, expected, user = globalThis.game?.user) {
  const current = readShields(actor);
  const entry = current.history?.at(-1);
  if (!entry) throw new Error('No shield action to undo.');
  if (JSON.stringify(current.items) !== JSON.stringify(entry.after))
    throw new Error('A condition tracker changed after that action. Use manual correction.');
  // Undo is itself a recorded action; it never changes wearer injury or chat history.
  return changeShields(actor, expected, `Undo: ${entry.action}`, () => entry.before, user);
}
