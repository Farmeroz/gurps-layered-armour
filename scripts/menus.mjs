import { canEdit, elementOf } from './core.mjs';

export function actorForRow(target) {
  const row = elementOf(target)?.closest?.('[data-document-id], [data-entry-id], [data-entity-id]');
  if (!row) return null;
  return (
    game.actors.get(row.dataset.documentId ?? row.dataset.entryId ?? row.dataset.entityId) ?? null
  );
}
export function tokenFor(application, target) {
  const row = elementOf(target)?.closest?.('[data-token-id], [data-document-id], [data-entry-id]');
  if (row)
    return (
      globalThis.canvas?.tokens?.get(
        row.dataset.tokenId ?? row.dataset.documentId ?? row.dataset.entryId,
      ) ?? null
    );
  if (application?.object?.actor) return application.object;
  const doc = application?.document;
  return doc?.documentName === 'Token' ? doc.object : null;
}
export function createMenus(open) {
  const permitted = (actor) => canEdit(actor, game.user);
  function actorContext(application, menu) {
    if (!Array.isArray(menu) || menu.some((x) => x.armourLayersEntry)) return;
    menu.push({
      name: 'Armour Layers',
      icon: '<i class="fa-solid fa-layer-group"></i>',
      armourLayersEntry: true,
      condition: (target) => permitted(actorForRow(target)),
      callback: (target) => {
        void open({ actor: actorForRow(target) });
      },
    });
  }
  function tokenContext(application, menu) {
    if (!Array.isArray(menu) || menu.some((x) => x.armourLayersEntry)) return;
    menu.push({
      name: 'Armour Layers',
      icon: '<i class="fa-solid fa-layer-group"></i>',
      armourLayersEntry: true,
      condition: (target) => permitted(tokenFor(application, target)?.actor),
      callback: (target) => {
        void open({ token: tokenFor(application, target) });
      },
    });
  }
  function hud(application, html) {
    const root = elementOf(html) ?? elementOf(application.element);
    if (!root?.querySelector) return;
    if (!permitted(tokenFor(application)?.actor)) {
      root.querySelector('.armour-layer-hud')?.remove();
      root.querySelector('.armour-layer-hud-group')?.remove();
      return;
    }
    if (root.querySelector('.armour-layer-hud')) return;
    let host = root.querySelector('.col.right') ?? root.querySelector('.right');
    if (!host) {
      host = root.ownerDocument.createElement('div');
      host.className = 'armour-layer-hud-group';
      root.append(host);
    }
    const button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'control-icon armour-layer-hud';
    button.title = 'Armour Layers';
    button.dataset.tooltip = 'Armour Layers';
    button.setAttribute('aria-label', 'Armour Layers');
    button.innerHTML = '<i class="fa-solid fa-layer-group" aria-hidden="true"></i>';
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void open({ token: tokenFor(application) });
    });
    host.append(button);
  }
  return { actorContext, tokenContext, hud };
}
export function registerMenus(open) {
  const menu = createMenus(open);
  Hooks.on('getActorContextOptions', menu.actorContext); // Foundry 14 directory hook.
  Hooks.on('getActorDirectoryEntryContext', menu.actorContext); // Legacy/custom directory.
  Hooks.on('getTokenPlaceableContextOptions', menu.tokenContext);
  const hooks = new Set(['renderTokenHUD', 'renderBasePlaceableHUD']);
  if (globalThis.CONFIG?.Token?.hudClass?.name) hooks.add(`render${CONFIG.Token.hudClass.name}`);
  for (const hook of hooks) Hooks.on(hook, menu.hud);
}
