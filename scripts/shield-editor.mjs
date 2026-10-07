import { ID, canEdit, elementOf, escapeHTML as esc } from './core.mjs';
import {
  shieldRecord,
  capabilities,
  resolveShieldHit,
  repairShield,
  applyHTResult,
  coverAdvice,
  MODES,
  DAMAGE_TYPES,
  CONDITIONS,
} from './shields.mjs';
import { readShields, changeShields, undoShields } from './shield-store.mjs';

let Editor;
const windows = new Map();
export async function openShields(actor) {
  actor ??= globalThis.canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!canEdit(actor, game.user)) {
    ui.notifications.warn('Select a token you own to open Shields.');
    return null;
  }
  if (windows.get(actor.uuid)?.rendered) {
    windows.get(actor.uuid).bringToTop();
    return windows.get(actor.uuid);
  }
  Editor ??= createShieldEditor(
    globalThis.foundry?.appv1?.api?.Application ?? globalThis.Application,
  );
  const app = new Editor(actor);
  windows.set(actor.uuid, app);
  app.render(true);
  return app;
}
export async function reportShield(actor, label, message) {
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<section><h3>${esc(label)}</h3><p>${esc(message)}</p></section>`,
  };
  ChatMessage.applyRollMode(data, game.settings.get('core', 'rollMode'));
  await ChatMessage.create(data);
}
export async function openResidual(actor, result) {
  if (!canEdit(actor, game.user))
    throw new Error('You no longer have permission to edit this actor.');
  if (!result?.residual) throw new Error('No residual damage to review.');
  const NativeADD =
    globalThis.GURPS?.ApplyDamageDialog ??
    (await import(foundry.utils.getRoute('systems/gurps/module/damage/applydamage.js'))).default;
  const app = new NativeADD(actor, {
    damage: result.residual,
    damageType: result.type,
    armorDivisor: result.divisor === 0 ? -1 : result.divisor,
    dice: String(result.residual),
    attacker: actor.id,
  });
  app.render(true);
  return app;
}
export function createShieldEditor(Base) {
  return class ShieldEditor extends Base {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ['gurps-layered-armour', 'shield-editor'],
        template: `modules/${ID}/templates/shields.hbs`,
        width: 760,
        height: 780,
        resizable: true,
      });
    }
    constructor(actor) {
      super();
      this.actor = actor;
      this.refresh();
      this.selected = this.store.items[0]?.id ?? '';
      this.options.title = `Shields: ${actor.name}${actor.isToken ? ' (unlinked token)' : ''}`;
    }
    get title() {
      return this.options.title;
    }
    refresh() {
      this.store = readShields(this.actor);
      this.expected = JSON.stringify(this.store);
    }
    getData() {
      const s = this.store.items.find((x) => x.id === this.selected);
      const choices = (values, selected) =>
        values.map((value) => ({ value, selected: value === selected }));
      return {
        items: this.store.items.map((x) => ({ ...x, selected: x.id === this.selected })),
        shield: s,
        capability: s ? capabilities(s) : null,
        modes: choices(MODES, s?.mode),
        constructions: choices(['homogeneous', 'unliving', 'normal'], s?.construction),
        conditions: choices(CONDITIONS, s?.condition),
        types: choices(DAMAGE_TYPES, 'cr'),
        message: this.message,
        result: this.result,
        advice: this.advice,
        canUndo: !!this.store.history?.length,
      };
    }
    readForm(root) {
      const old = this.store.items.find((s) => s.id === this.selected);
      if (!old) throw new Error('Add a shield first.');
      const next = { ...old };
      for (const input of root.querySelectorAll('[data-shield]'))
        next[input.dataset.shield] = input.type === 'checkbox' ? input.checked : input.value;
      return shieldRecord(next);
    }
    activateListeners(html) {
      super.activateListeners(html);
      const root = elementOf(html);
      root.querySelector('[data-select]')?.addEventListener('change', (ev) => {
        this.selected = ev.target.value;
        this.result = null;
        this.message = '';
        this.advice = '';
        this.render(false);
      });
      root.addEventListener('submit', (ev) => ev.preventDefault());
      root.addEventListener('click', async (ev) => {
        const button = ev.target.closest('[data-shield-action]');
        if (!button || this.busy) return;
        ev.preventDefault();
        this.busy = true;
        const action = button.dataset.shieldAction;
        const value = (key) => root.querySelector(`[data-${key}]`)?.value;
        const checked = (key) => root.querySelector(`[data-${key}]`)?.checked === true;
        try {
          if (!canEdit(this.actor, game.user))
            throw new Error('Permission to edit this actor was lost.');
          if (action === 'reload') {
            this.refresh();
            this.result = null;
            this.message = 'Current shield data loaded.';
          } else if (action === 'residual') {
            if (JSON.stringify(readShields(this.actor)) !== this.expected)
              throw new Error('Shield data changed. Review the latest hit before opening damage.');
            await openResidual(this.actor, this.result);
            this.result = { ...this.result, opened: true };
            this.message =
              'Residual damage opened for review. Choose the correct hit location in ADD.';
          } else if (action === 'advice') {
            const advice = coverAdvice(this.readForm(root), {
              use: value('cover-use'),
              legal: checked('legal'),
              miss: value('miss'),
              posture: value('posture'),
              sm: value('sm'),
            });
            this.advice = `Attack penalty: −${advice.penalty}. Total cover: ${advice.total ? 'yes' : 'no'}. Shield intercepted: ${advice.shieldHit ? 'yes' : 'no'}. Take Cover Block bonus: +${advice.blockBonus}. Area option: ${advice.areaAllowed ? 'available' : 'unavailable'}. Penetration barrier: ${advice.coverDR}.`;
            root.querySelector('[data-advice]').textContent = this.advice;
            return;
          } else {
            let description = '';
            let result = null;
            if (action === 'undo') {
              await undoShields(this.actor, this.expected);
              description =
                'Last shield change undone. Wearer injury and existing chat reports are unchanged.';
            } else {
              await changeShields(this.actor, this.expected, action, async (items) => {
                if (action === 'add') {
                  const s = shieldRecord({
                    id: foundry.utils.randomID(),
                    name: `Shield ${items.length + 1}`,
                  });
                  this.selected = s.id;
                  description = 'Added shield. Review its values and enable tracking when ready.';
                  return [...items, s];
                }
                const index = items.findIndex((s) => s.id === this.selected);
                if (index < 0) throw new Error('Select a saved shield.');
                if (action === 'delete') {
                  description = `Removed ${items[index].name}; Undo can restore it.`;
                  return items.filter((s) => s.id !== this.selected);
                }
                let s = this.readForm(root);
                if (action === 'damage') {
                  if (JSON.stringify(s) !== JSON.stringify(items[index]))
                    throw new Error(
                      'Save configuration or manual corrections before applying damage.',
                    );
                  result = resolveShieldHit(s, {
                    damage: value('damage'),
                    type: value('type'),
                    divisor: value('divisor'),
                    reason: value('reason'),
                    margin: value('margin'),
                    critical: checked('critical'),
                  });
                  s = result.shield;
                  for (const check of result.checks) {
                    const roll = await new Roll('3d6').evaluate();
                    s = applyHTResult(s, 'destruction', roll.total);
                    result.notes.push(
                      `Destruction HT ${check.target} at ${check.threshold} HP: rolled ${roll.total}; ${s.condition}.`,
                    );
                    if (s.condition === 'destroyed') break;
                  }
                  result.shield = s;
                  result.type = value('type');
                  result.divisor = Number(value('divisor'));
                  description = `${s.name}: ${result.loss} HP injury; ${result.hits} simple hits; ${capabilities(s).condition}, DB ${capabilities(s).db}. Residual basic damage: ${result.residual} ${result.type}. ${result.notes.join(' ')}`;
                } else if (action === 'repair') {
                  if (JSON.stringify(s) !== JSON.stringify(items[index]))
                    throw new Error('Save configuration before recording repairs.');
                  if (!String(value('note') ?? '').trim())
                    throw new Error('Record how the repair was completed.');
                  const repaired = repairShield(s, value('repair'), value('repair-die'));
                  s = repaired.shield;
                  description = `${s.name}: repair recorded. ${value('note')}${repaired.cost === null ? '' : ` Full in-town repair quote: $${repaired.cost}.`} Lost enchantments remain lost.`;
                } else if (action === 'ht') {
                  if (JSON.stringify(s) !== JSON.stringify(items[index]))
                    throw new Error('Save configuration before checking HT.');
                  if (!s.enabled || s.mode !== 'basic' || s.hp > 0 || s.condition !== 'functional')
                    throw new Error(
                      'Use checks apply to functional Basic Set shields at 0 HP or below.',
                    );
                  const roll = await new Roll('3d6').evaluate();
                  s = applyHTResult(s, 'use', roll.total);
                  description = `${s.name}: use check HT ${s.ht}, rolled ${roll.total}; ${s.condition}.`;
                } else if (action === 'save') {
                  description = `${s.name}: configuration / manual correction saved. ${value('note') ?? ''}`;
                } else throw new Error('Unknown shield action.');
                items[index] = s;
                return items;
              });
            }
            this.refresh();
            if (!this.store.items.some((s) => s.id === this.selected))
              this.selected = this.store.items[0]?.id ?? '';
            this.result = result;
            this.message = description;
            try {
              await reportShield(this.actor, 'Shield tracking', description);
            } catch {
              this.message += ' Saved successfully, but the chat report failed.';
            }
          }
          this.render(false);
        } catch (error) {
          const output = root.querySelector('[data-error]');
          output.textContent = error.message;
          output.hidden = false;
        } finally {
          this.busy = false;
        }
      });
    }
  };
}
