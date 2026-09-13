import {ID, canEdit, readProfile} from './core.mjs';
import {createEditorClass} from './editor.mjs';
import {patchADD} from './integration.mjs';
import {registerMenus} from './menus.mjs';

let Editor;
const editors = new Map();
export async function openEditor(actor, options = {}) {
  try {
    if (!canEdit(actor, game.user)) throw new Error('Choose an actor you own. GMs can edit any actor.');
    if (!Editor) throw new Error('The Armour Layers editor is not available yet.');
    const key = `${actor.uuid}:${options.temporary ? 'temporary' : 'saved'}`;
    // Temporary editors belong to individual ADDs; do not reuse one for another hit.
    if (!options.temporary && editors.get(key)?.rendered) {editors.get(key).bringToTop();return editors.get(key);}
    const editor = new Editor(actor, options);
    if (!options.temporary) editors.set(key, editor);
    editor.render(true);
    return editor;
  } catch (error) {console.error(ID, error);ui.notifications.error(`Armour Layers: ${error.message}`);return null;}
}
export async function open(options = {}) {
  if (Object.hasOwn(options, 'actor') || Object.hasOwn(options, 'token')) return openEditor(options.actor ?? options.token?.actor);
  if (options.uuid) return openEditor(await fromUuid(options.uuid));
  const tokens = globalThis.canvas?.tokens?.controlled ?? [];
  const actors = [...new Map(tokens.filter(t => t.actor).map(t => [t.actor.uuid, t.actor])).values()];
  if (!actors.length && game.user.character) actors.push(game.user.character);
  if (!actors.length) {ui.notifications.warn('Armour Layers: select a token, use an actor’s directory menu, or use /armour "Actor Name".');return null;}
  const results = [];
  for (const actor of actors) results.push(await openEditor(actor));
  return results;
}
export async function command(line) {
  const match = line.trim().match(/^\/(?:armour|armor)(?:\s+(.*))?$/i);
  if (!match) return false;
  let name = (match[1] ?? '').trim();
  if (/^(?:help|\?)$/i.test(name)) {
    ui.notifications.info('/armour ["Actor Name"]: opens Armour Layers for selected tokens, your assigned character, or a named world actor. /armor is an alias.', {permanent: true});return true;
  }
  if (!name) {await open();return true;}
  if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
  const actors = game.actors.filter(actor => actor.name === name && canEdit(actor, game.user));
  if (actors.length !== 1) {ui.notifications.warn(actors.length ? 'More than one owned actor has that name. Use its directory menu.' : 'No owned actor has that exact name.');return true;}
  await openEditor(actors[0]);return true;
}
Hooks.once('ready', async () => {
  if (game.system.id !== 'gurps') return;
  const Base = globalThis.foundry?.appv1?.api?.Application ?? globalThis.Application;
  Editor = createEditorClass(Base);
  game.modules.get(ID).api = Object.freeze({open, command, getProfile: readProfile});
  registerMenus(open);
  const registry = globalThis.GURPS?.ChatProcessors;
  if (registry?.registerProcessor) {
    const existing = [...registry.processorsForAll(), ...registry.processorsForGMOnly()];
    const aliases = ['armour', 'armor'].filter(alias => {
      const conflict = existing.some(processor => processor.matches(`/${alias}`));
      if (conflict) ui.notifications.warn(`Armour Layers: /${alias} is already registered. Use the directory menu or module API.`);
      return !conflict;
    });
    if (aliases.length) registry.registerProcessor({registry: null,
      matches: line => aliases.some(alias => new RegExp(`^/${alias}(?:\\s|$)`, 'i').test(line.trim())),
      usagematches: () => false, help: () => `/${aliases[0]} ["Actor Name"]: edit Armour Layers`, isGMOnly: () => false, process: command});
  } else ui.notifications.warn('Armour Layers: chat integration is unavailable. Use the actor menu or token HUD.');
  try {
    if (!/^0\.18\./.test(game.system.version)) throw new Error('ADD integration requires GGA 0.18.x. The editor remains available.');
    const NativeADD = globalThis.GURPS?.ApplyDamageDialog ?? (await import(foundry.utils.getRoute('systems/gurps/module/damage/applydamage.js'))).default;
    patchADD(NativeADD, openEditor);
  } catch (error) {console.error(ID, error);ui.notifications.error(`Armour Layers: ${error.message}`);}
  Hooks.on('updateActor', (actor, changes) => {
    if (!changes.flags?.[ID] && !Object.keys(changes).some(key => key.startsWith(`flags.${ID}`))) return;
    for (const app of Object.values(ui.windows ?? {})) {
      if (app._calculator && app.actor?.uuid === actor.uuid && app.rendered) app.render(false);
    }
  });
});
