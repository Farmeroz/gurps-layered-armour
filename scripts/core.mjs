export const ID = 'gurps-layered-armour';
export const TYPES = ['cr', 'cut', 'imp', 'pi-', 'pi', 'pi+', 'pi++', 'burn', 'cor', 'tox', 'fat'];
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const elementOf = (value) => (value?.nodeType ? value : (value?.[0] ?? value));
export const emptyProfile = () => ({ schema: 1, enabled: false, layers: [] });
export const canEdit = (actor, user) => !!actor && !!user && (user.isGM || actor.isOwner);
export function normaliseStore(value) {
  if (!value || value.schema === 1)
    return {
      schema: 2,
      activeId: 'default',
      sets: [{ id: 'default', name: 'Default', profile: validateProfile(value ?? emptyProfile()) }],
    };
  if (
    value.schema !== 2 ||
    !Array.isArray(value.sets) ||
    !value.sets.length ||
    value.sets.length > 30
  )
    throw new Error('Invalid armour sets. Use 1–30 sets.');
  const ids = new Set(),
    names = new Set();
  const sets = value.sets.map((set) => {
    if (typeof set.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(set.id) || ids.has(set.id))
      throw new Error('Invalid or duplicate set ID.');
    const name = String(set.name ?? '').trim();
    if (!name || name.length > 80 || names.has(name.toLowerCase()))
      throw new Error('Each armour set needs a unique name (up to 80 characters).');
    ids.add(set.id);
    names.add(name.toLowerCase());
    return { id: set.id, name, profile: validateProfile(set.profile) };
  });
  if (!ids.has(value.activeId)) throw new Error('The active armour set is missing.');
  return { schema: 2, activeId: value.activeId, sets };
}
export const readStore = (actor) =>
  normaliseStore(clone(actor.getFlag(ID, 'profile') ?? emptyProfile()));
export const readProfile = (actor) => {
  const store = readStore(actor);
  return clone(store.sets.find((set) => set.id === store.activeId).profile);
};
export function locationsOf(actor) {
  const names = [
    ...new Set(
      Object.values(actor.system?.hitlocations ?? {})
        .map((x) => x.where)
        .filter(Boolean),
    ),
  ];
  return names.length ? names : ['Torso'];
}
function number(value, label, max = 1000000) {
  if (
    value === '' ||
    value === null ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > max ||
    !Number.isInteger(Number(value))
  )
    throw new Error(`${label} must be a whole number from 0 to ${max}.`);
  return Number(value);
}
export function parseSplit(text) {
  const result = {};
  if (!text.trim()) return result;
  for (const term of text.split(';')) {
    const match = term.trim().match(/^([a-z+-]+)\s*=\s*(\d+)$/);
    if (!match || !TYPES.includes(match[1]))
      throw new Error(
        'Split DR uses entries such as cut=4; pi=6; pi+=6. Enter each damage type explicitly.',
      );
    if (Object.hasOwn(result, match[1])) throw new Error(`Duplicate split DR type: ${match[1]}.`);
    result[match[1]] = number(match[2], 'Split DR');
  }
  return result;
}
export const formatSplit = (value) =>
  Object.entries(value ?? {})
    .map(([key, dr]) => `${key}=${dr}`)
    .join('; ');
function split(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('Invalid split DR.');
  return Object.fromEntries(
    Object.entries(value).map(([key, dr]) => {
      if (!TYPES.includes(key)) throw new Error(`Unknown damage type: ${key}.`);
      return [key, number(dr, 'Split DR')];
    }),
  );
}
export function validateProfile(value) {
  if (value?.schema !== 1) throw new Error('Unsupported Armour Layers data version.');
  if (!Array.isArray(value.layers) || value.layers.length > 100)
    throw new Error('Use at most 100 layers.');
  return {
    schema: 1,
    enabled: !!value.enabled,
    layers: value.layers.map((layer) => {
      const name = String(layer.name ?? '').trim();
      if (!name || name.length > 100)
        throw new Error('Each layer needs a name of up to 100 characters.');
      if (!['worn', 'natural', 'forcefield'].includes(layer.kind))
        throw new Error('Unknown layer kind.');
      if (!Array.isArray(layer.locations) || layer.locations.length > 200)
        throw new Error('Invalid location coverage.');
      const seen = new Set();
      return {
        name,
        ...(layer.reviewRequired !== undefined ? { reviewRequired: !!layer.reviewRequired } : {}),
        ...(layer.source
          ? {
              source: {
                key: String(layer.source.key ?? '').slice(0, 300),
                name: String(layer.source.name ?? '').slice(0, 100),
                fingerprint: String(layer.source.fingerprint ?? '').slice(0, 20000),
                issues: Array.isArray(layer.source.issues)
                  ? layer.source.issues.slice(0, 20).map((issue) => String(issue).slice(0, 300))
                  : [],
              },
            }
          : {}),
        enabled: !!layer.enabled,
        kind: layer.kind,
        dr:
          layer.reviewRequired === true && layer.dr === null
            ? null
            : number(layer.dr, `${name} DR`),
        hardened: number(layer.hardened, `${name} Hardened`, 6),
        flexible: layer.kind === 'forcefield' ? false : !!layer.flexible,
        split: split(layer.split),
        allLocations: !!layer.allLocations,
        locations: layer.locations.map((loc) => {
          if (
            typeof loc.where !== 'string' ||
            !loc.where.trim() ||
            loc.where.length > 100 ||
            seen.has(loc.where)
          )
            throw new Error('Invalid or duplicate hit location.');
          seen.add(loc.where);
          return {
            where: loc.where,
            dr: loc.dr === null ? null : number(loc.dr, 'Location DR'),
            split: split(loc.split),
          };
        }),
      };
    }),
  };
}
export function newLayer(locations) {
  return {
    name: 'New armour',
    enabled: true,
    kind: 'worn',
    dr: 0,
    hardened: 0,
    flexible: false,
    split: {},
    allLocations: false,
    locations: [
      { where: locations.includes('Torso') ? 'Torso' : locations[0], dr: null, split: {} },
    ],
  };
}
export const covers = (layer, where) =>
  layer.allLocations || layer.locations.some((loc) => loc.where === where);
export function layerDR(layer, where, type) {
  const loc = layer.locations.find((x) => x.where === where);
  // Location DR supplies its own base; type overrides are inherited unless replaced.
  return loc?.split?.[type] ?? layer.split[type] ?? loc?.dr ?? layer.dr;
}
export function hardenedDivisor(divisor, level) {
  if (divisor <= 1 && divisor !== -1) return divisor;
  if (!level) return divisor;
  // GGA's survivable-guns convention treats divisor 4 as 3 for Hardened.
  const steps = [-1, 100, 10, 5, 3, 2, 1];
  const index = steps.indexOf(divisor === 4 ? 3 : divisor);
  if (index < 0)
    throw new Error(
      `Divisor ${divisor} is outside the Hardened progression. Review this hit with native DR.`,
    );
  return steps[Math.min(index + level, steps.length - 1)];
}
export function stackFor(profile, where, type, divisor = 1, multiplier = 1) {
  profile = validateProfile(profile);
  const managed = profile.enabled && profile.layers.some((layer) => covers(layer, where));
  if (profile.enabled && profile.layers.some((layer) => layer.enabled && layer.reviewRequired))
    throw new Error(
      'An active armour layer needs review. Open Armour Layers and confirm its DR, coverage and modifiers before applying injury.',
    );
  if (!managed) return null;
  if (!(divisor > 0 || divisor === -1) || !Number.isFinite(divisor))
    throw new Error('Invalid armour divisor.');
  if (!Number.isFinite(multiplier) || multiplier < 1)
    throw new Error('Invalid shotgun multiplier.');
  let exactTotal = 0,
    rawTotal = 0;
  const rows = profile.layers
    .filter((layer) => layer.enabled && covers(layer, where))
    .map((layer) => {
      const dr = layerDR(layer, where, type);
      const effectiveDivisor = hardenedDivisor(divisor, layer.hardened);
      const exact = effectiveDivisor === -1 ? 0 : (dr * multiplier) / effectiveDivisor;
      const before = Math.floor(exactTotal + 1e-9);
      exactTotal += exact;
      rawTotal += dr;
      // Round the combined protection once. Cumulative differences allocate the
      // rounded points in outside-to-inside order without losing DR per layer.
      return {
        name: layer.name,
        kind: layer.kind,
        flexible: layer.flexible,
        hardened: layer.hardened,
        dr,
        divisor: effectiveDivisor,
        exact,
        effective: Math.floor(exactTotal + 1e-9) - before,
      };
    });
  let effectiveDR = Math.floor(exactTotal + 1e-9);
  // B379: bare DR 0 is treated as DR 1 against fractional divisors, then divided.
  if (rawTotal === 0 && divisor < 1 && divisor > 0) {
    effectiveDR = Math.floor(1 / divisor);
    rows.push({
      name: 'DR 0 vs fractional divisor (B379)',
      kind: 'natural',
      flexible: false,
      hardened: 0,
      dr: 0,
      divisor,
      exact: effectiveDR,
      effective: effectiveDR,
    });
  }
  return { rows, rawDR: rawTotal, effectiveDR };
}
export function traceDamage(stack, damage, type) {
  let remaining = damage,
    flexIncoming = null,
    stopped = null;
  const rows = stack.rows.map((row) => {
    const incoming = remaining;
    if (!row.flexible) flexIncoming = null;
    else if (flexIncoming === null) flexIncoming = remaining;
    remaining = Math.max(0, remaining - row.effective);
    if (incoming > 0 && remaining === 0 && !stopped) stopped = { row, flexIncoming };
    return { ...row, incoming, outgoing: remaining };
  });
  const threshold =
    type === 'cr' ? 5 : ['cut', 'imp', 'pi-', 'pi', 'pi+', 'pi++'].includes(type) ? 10 : 0;
  let bluntTrauma = 0,
    review = '';
  if (stopped?.row.flexible && threshold) {
    bluntTrauma = Math.floor(stopped.flexIncoming / threshold);
    const index = stack.rows.indexOf(stopped.row);
    if (bluntTrauma && stack.rows.slice(index + 1).some((r) => !r.flexible && r.effective > 0)) {
      review =
        'Flexible armour stopped the attack before an inner rigid layer. Enter a reviewed blunt-trauma value in the ADD before applying.';
    }
  }
  return { ...stack, rows, penetrating: remaining, bluntTrauma, review };
}
