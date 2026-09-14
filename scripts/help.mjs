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
export function helpEnabled() {
  try {
    return globalThis.game?.settings?.get(ID, 'helpTooltips') !== false;
  } catch {
    return true;
  }
}
export function attachHelp(root) {
  if (!root?.querySelectorAll) return;
  let bubble, timer;
  const hide = () => {
    clearTimeout(timer);
    if (bubble) {
      const target = root.querySelector('[data-armour-described]');
      if (target) {
        const ids = (target.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .filter((id) => id !== bubble.id);
        if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
        else target.removeAttribute('aria-describedby');
        target.removeAttribute('data-armour-described');
      }
      bubble.remove();
      bubble = null;
    }
  };
  for (const node of root.querySelectorAll('button, input, select, summary, [data-help]')) {
    const action = node.dataset.action ?? node.dataset.edit;
    const field = node.dataset.field;
    const message =
      node.dataset.help ??
      (action === 'save' && root.dataset.temporary === 'true'
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
    if (!message) continue;
    node.dataset.help = message;
    node.removeAttribute('title');
    node.removeAttribute('data-tooltip');
    if (node.dataset.armourHelpBound) continue;
    node.dataset.armourHelpBound = 'true';
    const show = () => {
      hide();
      if (!helpEnabled()) return;
      timer = setTimeout(() => {
        if (!node.isConnected || !helpEnabled()) return;
        const doc = root.ownerDocument;
        bubble = doc.createElement('div');
        bubble.className = 'armour-help-tooltip';
        bubble.setAttribute('role', 'tooltip');
        bubble.id = `armour-help-${Math.random().toString(36).slice(2)}`;
        bubble.textContent = node.dataset.help;
        doc.body.append(bubble);
        const rect = node.getBoundingClientRect();
        bubble.style.left = `${Math.max(8, Math.min(rect.left, doc.documentElement.clientWidth - 320))}px`;
        bubble.style.top = `${Math.max(8, Math.min(rect.bottom + 6, doc.documentElement.clientHeight - bubble.offsetHeight - 8))}px`;
        node.setAttribute(
          'aria-describedby',
          [node.getAttribute('aria-describedby'), bubble.id].filter(Boolean).join(' '),
        );
        node.dataset.armourDescribed = 'true';
      }, 450);
    };
    node.addEventListener('mouseenter', show);
    node.addEventListener('focus', show);
    node.addEventListener('mouseleave', hide);
    node.addEventListener('blur', hide);
  }
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  root.addEventListener('click', hide);
  root.addEventListener('scroll', hide, true);
  return hide;
}
export function registerHelpSetting() {
  game.settings.register(ID, 'helpTooltips', {
    name: 'Show help tooltips',
    hint: 'Show short explanations on Armour Layers controls. This preference applies only to this client.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
}
