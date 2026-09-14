import { createHelpController, helpResolver } from './tooltip-engine.mjs';
import { ID } from './core.mjs';
const help = {
  saved: 'Edit and save the actor’s armour sets.',
  temporary: 'Adjust a copy of the current armour for this ADD only.',
  reset: 'Discard temporary armour and reload the saved active set.',
  add: 'Add a manually configured layer to this set.',
  delete: 'Remove this layer from the set. Changes apply when saved.',
  up: 'Move this layer outward, so damage reaches it earlier.',
  down: 'Move this layer inward, behind the preceding layer.',
  save: 'Save all edited sets and the active-set choice to this actor.',
  cancel: 'Close without saving your edits.',
  export:
    'Download the set shown in this editor, including unsaved edits. Equipment links are omitted.',
  import: 'Replace the displayed set with the chosen JSON file. Review before saving.',
  'set-new': 'Create an empty named set. The current set remains in the list.',
  'set-copy': 'Duplicate the displayed set under a new name.',
  'set-delete': 'Delete the displayed set from this draft. The last set cannot be deleted.',
  'set-active': 'Use the displayed set for ADD calculations after saving.',
  'equipment-add': 'Add the ticked equipment as separate layers. Every added layer needs review.',
  'source-refresh':
    'Reload this item’s detected armour values. Your current values are replaced in the draft and require review.',
  'equipment-refresh': 'Rescan this actor’s equipment without changing existing layers.',
  name: 'A descriptive label for this armour layer.',
  enabled: 'Include this layer in protection. Switching it off retains its coverage.',
  dr: 'Basic DR before the attack’s armour divisor. Blank means the equipment did not supply a value.',
  kind: 'Record whether this is worn armour, natural DR, or a force field.',
  hardened: 'Hardened level for this layer only: 0 means no Hardened enhancement.',
  flexible: 'Whether this layer can transmit blunt trauma when it stops an attack.',
  split: 'Explicit DR by damage type, for example cr=2; cut=4. Other types use the default.',
  allLocations:
    'Apply this layer to the actor’s whole body. Ticked rows can override individual locations.',
  review:
    'Confirm you have checked the DR, locations, Hardened level and flexible/rigid status. Unreviewed active layers block injury calculation.',
};

const fallback = helpResolver({ id: ID });
function resolve(node, original) {
  if (node.matches('.context-item:has(.armour-menu-icon)'))
    return 'Open this actor’s saved armour sets and layer editor.';
  const action = node.dataset.action ?? node.dataset.edit;
  const field = node.dataset.field;
  const message =
    node.dataset.help ??
    (action === 'save' && node.closest('[data-temporary]')?.dataset.temporary === 'true'
      ? 'Use the displayed set for this ADD only. Saved actor sets remain unchanged.'
      : help[action]) ??
    help[field] ??
    (node.matches('[data-use-layers]')
      ? 'Use saved layered DR, or switch off to review the hit using native ADD armour controls.'
      : node.matches('[data-cover]')
        ? 'Tick to include this location, or enable its override when every location is covered.'
        : node.matches('[data-dr]')
          ? 'DR for this location. Blank inherits the layer default.'
          : node.matches('[data-split]')
            ? help.split
            : node.matches('[data-profile-enabled]')
              ? 'Enable this set’s layered protection. Covered locations replace sheet DR.'
              : node.matches('[data-import-file]')
                ? 'Choose a JSON file exported by Armour Layers.'
                : node.matches('summary')
                  ? 'Expand or collapse this section.'
                  : '');

  return message || fallback(node, original);
}
export const helpController = createHelpController({
  id: ID,
  scope:
    '#context-menu .context-item:has(.armour-menu-icon), .armour-layer-hud, .gurps-layered-armour, .armour-add-panel, .armour-add, [name^="gurps-layered-armour."]',
  resolve,
});
export const helpEnabled = helpController.enabled;
export function attachHelp(root) {
  root = root?.nodeType ? root : root?.[0];
  for (const node of root?.querySelectorAll?.('button, input, select, summary, [data-help]') ??
    []) {
    const message = resolve(node, node.getAttribute('title') || '');
    if (message) node.dataset.help = message;
  }
  return helpController.attach(root);
}
export function registerHelpSetting() {
  helpController.register();
  globalThis.Hooks?.once('ready', () => helpController.start());
}
