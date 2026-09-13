import { ID, validateProfile } from './core.mjs';

export const MAX_TRANSFER_BYTES = 16 * 1024 * 1024;
const size = (text) => new TextEncoder().encode(text).byteLength;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function strictProfile(profile) {
  if (!isRecord(profile) || typeof profile.enabled !== 'boolean' || !Array.isArray(profile.layers))
    throw new Error('Invalid armour profile.');
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
  const split = (value) => isRecord(value) && Object.values(value).every(numeric);
  for (const layer of profile.layers) {
    if (
      !isRecord(layer) ||
      typeof layer.name !== 'string' ||
      !numeric(layer.dr) ||
      !numeric(layer.hardened) ||
      !['enabled', 'flexible', 'allLocations'].every((key) => typeof layer[key] === 'boolean') ||
      !split(layer.split) ||
      !Array.isArray(layer.locations)
    )
      throw new Error(
        'Invalid layer: DR and Hardened must be numbers, and toggles must be true or false.',
      );
    for (const loc of layer.locations) {
      if (!isRecord(loc) || !(loc.dr === null || numeric(loc.dr)) || !split(loc.split))
        throw new Error('Invalid location DR override.');
    }
  }
  // Rebuild known fields only; never merge imported objects into an actor.
  return validateProfile(profile);
}
export function exportSetup(profile) {
  const text =
    JSON.stringify({ format: ID, version: 1, profile: strictProfile(profile) }, null, 2) + '\n';
  if (size(text) > MAX_TRANSFER_BYTES)
    throw new Error('Armour setup exceeds the 16 MiB transfer limit.');
  return text;
}
export function importSetup(text) {
  if (typeof text !== 'string' || size(text) > MAX_TRANSFER_BYTES)
    throw new Error('Choose an armour JSON file no larger than 16 MiB.');
  let file;
  try {
    file = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (!isRecord(file) || file.format !== ID)
    throw new Error('Choose a JSON setup exported by GURPS Layered Armour.');
  if (file.version !== 1)
    throw new Error('Unsupported armour export version. A newer module may be required.');
  return strictProfile(file.profile);
}
export function unmatchedLocations(profile, destinations) {
  const known = new Set(destinations);
  return [
    ...new Set(profile.layers.flatMap((layer) => layer.locations.map((loc) => loc.where))),
  ].filter((where) => !known.has(where));
}
export function setupFilename(name) {
  const safe = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .toLowerCase();
  return `${safe || 'actor'}-armour-layers.json`;
}
export function downloadSetup(text, filename, document) {
  const view = document.defaultView ?? globalThis;
  const url = view.URL.createObjectURL(
    new view.Blob([text], { type: 'application/json;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 10000);
  }
}
