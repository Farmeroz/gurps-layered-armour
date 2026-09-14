import { newLayer, locationsOf, clone } from './core.mjs';

const text = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .trim();
const integer = (value) =>
  /^(0|[1-9]\d*)$/.test(String(value)) && Number(value) <= 1000000 ? Number(value) : null;
const glob = (pattern) =>
  new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
export function equipmentOn(actor) {
  const items = Array.from(actor.items?.contents ?? actor.items ?? []).filter(
    (item) => item.type === 'equipment',
  );
  const seen = new Set(),
    result = [];
  const add = (eqt, key, carried, item) => {
    if (!eqt || typeof eqt !== 'object') return;
    if (item && seen.has(item.id)) return;
    if (item) seen.add(item.id);
    const data = item?.system ?? {};
    const record = {
      key: item ? `item:${item.id}` : eqt.uuid ? `eqt:${eqt.uuid}` : `path:${key}`,
      name: text(eqt.name || item?.name || 'Unnamed equipment'),
      notes: text(eqt.notes ?? data.eqt?.notes),
      bonuses: text(eqt.bonuses ?? data.bonuses ?? eqt.itemInfo?.system?.bonuses),
      carried: !!carried,
      equipped: !!carried && !!(eqt.equipped ?? data.equipped),
      categories: text(eqt.categories),
      dr: eqt.dr ?? data.eqt?.dr ?? null,
      coverage: eqt.coverage ?? data.eqt?.coverage ?? null,
      hardened: eqt.hardened ?? data.eqt?.hardened ?? null,
      flexible: eqt.flexible ?? data.eqt?.flexible ?? null,
      split: eqt.split ?? data.eqt?.split ?? null,
    };
    record.likely =
      /armou?r|mail|vest|helmet|suit|greaves|gauntlets|cuirass|breastplate|shield/i.test(
        record.name + ' ' + record.categories,
      ) ||
      /\bDR\s*[:+\d]/i.test(record.notes + ' ' + record.bonuses) ||
      record.dr !== null;
    record.fingerprint = JSON.stringify(record);
    result.push(record);
  };
  const walk = (list, path, carried, depth = 0) => {
    if (depth > 40) return;
    for (const [key, eqt] of Object.entries(list ?? {})) {
      if (!eqt || typeof eqt !== 'object') continue;
      const item =
        items.find((i) => i.id === eqt.itemid) ??
        items.find(
          (i) => eqt.uuid && (i.system?.eqt?.uuid === eqt.uuid || i.system?.importid === eqt.uuid),
        );
      add(eqt, `${path}.${key}`, carried, item);
      walk(eqt.contains, `${path}.${key}.contains`, carried, depth + 1);
      walk(eqt.collapsed, `${path}.${key}.collapsed`, carried, depth + 1);
    }
  };
  walk(actor.system?.equipment?.carried, 'carried', true);
  walk(actor.system?.equipment?.other, 'other', false);
  for (const item of items)
    if (!seen.has(item.id))
      add(
        item.system?.eqt ?? { name: item.name },
        '',
        item.system?.carried ?? item.system?.eqt?.carried,
        item,
      );
  return result;
}
export function layerFromEquipment(record, actor) {
  const names = locationsOf(actor),
    notes = record.notes;
  const layer = {
    ...newLayer(names),
    name: record.name.slice(0, 100),
    dr: integer(record.dr),
    locations: [],
    reviewRequired: true,
  };
  const issues = [];
  const drNote = notes.match(/(?:^|[;\n])\s*DR\s*:\s*(\d+)\s*(?=$|[;\n])/i);
  if (layer.dr === null && drNote) layer.dr = integer(drNote[1]);
  let coverage = record.coverage;
  if (!coverage) coverage = notes.match(/(?:^|[;\n])\s*Coverage\s*:\s*([^;\n]+)/i)?.[1];
  if (typeof coverage === 'string') coverage = coverage.split(',').map((s) => s.trim());
  if (Array.isArray(coverage)) {
    layer.allLocations = coverage.some((s) => s === '*' || /^all$/i.test(s));
    for (const where of coverage) {
      if (where === '*' || /^all$/i.test(where)) continue;
      const match = names.find((name) => name.toLowerCase() === String(where).toLowerCase());
      if (match) layer.locations.push({ where: match, dr: null, split: {} });
      else issues.push(`Unmatched coverage: ${where}`);
    }
  }
  // Only complete DR bonus lines are recognised. Do not execute OtF, macros,
  // conditional notes, or infer protection from the actor's combined DR.
  if (layer.dr === null && record.bonuses) {
    const values = new Map();
    let recognised = false,
      unknown = false,
      all = false,
      allDR = 0;
    for (let line of record.bonuses.split('\n')) {
      line = line.trim().replace(/^\[([^\]]+)\]$/, '$1');
      if (!/\bDR\b/i.test(line)) continue;
      const match = line.match(/^DR\s*\+(\d+)\s*(.*?)\s*$/i);
      if (!match) {
        unknown = true;
        continue;
      }
      const amount = integer(match[1]);
      const tail = match[2];
      const tokens = tail.match(/"[^"]+"|'[^']+'|[^\s]+/g) ?? [];
      const patterns = tokens.map((token) => token.replace(/^["']|["']$/g, ''));
      const affected = !patterns.length
        ? names
        : names.filter((name) => patterns.some((p) => glob(p).test(name)));
      if (
        amount === null ||
        !affected.length ||
        patterns.some((p) => !names.some((n) => glob(p).test(n)))
      ) {
        unknown = true;
        continue;
      }
      recognised = true;
      if (!patterns.length) {
        all = true;
        allDR += amount;
      }
      for (const where of affected) values.set(where, (values.get(where) ?? 0) + amount);
    }
    if (recognised && !unknown) {
      const unique = [...new Set(values.values())];
      layer.dr = all ? allDR : unique.length === 1 ? unique[0] : 0;
      layer.allLocations = all;
      layer.locations = [...values].map(([where, dr]) => ({
        where,
        dr: dr === layer.dr ? null : dr,
        split: {},
      }));
    } else if (unknown) issues.push('DR bonuses contain an unsupported or conditional expression.');
  }
  const hard =
    record.hardened ?? notes.match(/(?:^|[;\n])\s*Hardened\s*:\s*(\d+)\s*(?=$|[;\n])/i)?.[1];
  layer.hardened = integer(hard) ?? 0;
  if (layer.hardened > 6) {
    layer.hardened = 0;
    issues.push('Hardened level is outside 0–6.');
  } else if (hard === null || hard === undefined)
    issues.push('Confirm Hardened level (not supplied).');
  layer.flexible =
    typeof record.flexible === 'boolean'
      ? record.flexible
      : /(?:^|[;\n])\s*Flexible\s*(?=$|[;\n])/i.test(notes);
  if (
    typeof record.flexible !== 'boolean' &&
    !/(?:^|[;\n])\s*(Flexible|Rigid)\s*(?=$|[;\n])/i.test(notes)
  )
    issues.push('Confirm flexible or rigid armour (not supplied).');
  if (record.split && typeof record.split === 'object' && !Array.isArray(record.split))
    layer.split = clone(record.split);
  if (layer.dr === null) issues.unshift('DR was not identified. Enter its actual value.');
  if (!layer.allLocations && !layer.locations.length)
    issues.push('Coverage was not identified. Select the protected locations.');
  layer.source = { key: record.key, name: record.name, fingerprint: record.fingerprint, issues };
  return layer;
}
export function sourceStatus(layer, records) {
  if (!layer.source) return '';
  const current = records.find((record) => record.key === layer.source.key);
  if (!current) return 'Source unavailable in this actor. Saved values are retained.';
  return current.fingerprint === layer.source.fingerprint
    ? 'Source unchanged.'
    : 'Equipment changed. Refresh explicitly to review its current values.';
}
