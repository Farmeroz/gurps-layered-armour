import { attachHelp, helpEnabled } from './help.mjs';
import {
  readProfile,
  validateProfile,
  stackFor,
  traceDamage,
  canEdit,
  escapeHTML as esc,
  elementOf,
} from './core.mjs';

const states = new WeakMap();
const patched = Symbol.for('gurps-layered-armour.addPatched');
export function stateFor(dialog) {
  let state = states.get(dialog);
  if (state) return state;
  state = { dialog, useLayers: true, override: null };
  states.set(dialog, state);
  const calc = dialog._calculator;
  if (!calc || !Array.isArray(calc._calculators))
    throw new Error('Unsupported GGA damage calculator.');
  function wrap(object, key, replacement) {
    let proto = object,
      descriptor;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, key);
      proto = Object.getPrototypeOf(proto);
    }
    if (!descriptor?.get) throw new Error(`GGA calculator is missing ${key}.`);
    Object.defineProperty(object, key, {
      configurable: true,
      get() {
        return replacement.call(this, () => descriptor.get.call(this));
      },
      ...(descriptor.set
        ? {
            set(value) {
              descriptor.set.call(this, value);
            },
          }
        : {}),
    });
  }
  wrap(calc, 'DR', (native) => report(state).stack?.rawDR ?? native());
  wrap(calc, 'effectiveDR', (native) => report(state).stack?.effectiveDR ?? native());
  wrap(calc, 'isFlexibleArmor', (native) => {
    const { stack } = report(state);
    return stack ? stack.rows.some((row) => row.flexible) : native();
  });
  for (const child of calc._calculators) {
    wrap(child, 'calculatedBluntTrauma', (native) => {
      const { stack } = report(state);
      return stack
        ? traceDamage(stack, child.effectiveDamage, calc.damageType).bluntTrauma
        : native();
    });
  }
  return state;
}
export function report(state) {
  if (!state.useLayers)
    return {
      status: 'Native DR selected for this ADD. Review the DR override and native armour options.',
    };
  try {
    const profile = validateProfile(state.override ?? readProfile(state.dialog.actor));
    if (!profile.enabled)
      return { status: 'No active armour profile. The ADD uses normal sheet DR.' };
    const calc = state.dialog._calculator;
    if (['Large-Area', 'Random', 'User Entered'].includes(calc.hitLocation)) {
      return {
        error:
          'Choose a specific hit location, or turn off layered DR for this ADD and enter reviewed native DR. Automatic large-area and explosion armour calculations are not included in this release.',
      };
    }
    let location = calc.hitLocation;
    const localised = globalThis.game?.i18n?.localize?.(`GURPS.hitLocation${location}`);
    if (
      !profile.layers.some(
        (l) => l.allLocations || l.locations.some((x) => x.where === location),
      ) &&
      localised
    )
      location = localised;
    const divisor = !calc.useArmorDivisor || calc.isExplosion ? 1 : calc.armorDivisor || 1;
    const multiplier =
      calc.isShotgun && calc.shotgunRofMultiplier > 1 ? calc.shotgunDamageMultiplier : 1;
    const stack = stackFor(profile, location, calc.damageType, divisor, multiplier);
    return stack
      ? {
          stack,
          status: `${state.override ? 'This ADD’s temporary' : 'Actor’s saved'} layers replace sheet DR at ${calc.hitLocation}.`,
        }
      : { status: `No layers cover ${calc.hitLocation}. The ADD uses normal sheet DR.` };
  } catch (error) {
    return { error: error.message };
  }
}
export function reviewError(state) {
  const result = report(state);
  if (result.error) return result.error;
  if (!result.stack) return '';
  const calc = state.dialog._calculator;
  const children =
    calc.viewId === 'all' ? calc._calculators : [calc._calculators[Number(calc.viewId)]];
  for (const child of children.filter(Boolean)) {
    const trace = traceDamage(result.stack, child.effectiveDamage, calc.damageType);
    if (calc.useBluntTrauma && trace.review && child._bluntTrauma === null) return trace.review;
  }
  return '';
}
export function reportHTML(state) {
  const result = report(state),
    calc = state.dialog._calculator;
  if (!result.stack) return `<p>${esc(result.error ?? result.status)}</p>`;
  const children =
    calc.viewId === 'all' ? calc._calculators : [calc._calculators[Number(calc.viewId)]];
  return (
    `<div class="armour-report"><p>${esc(result.status)}</p><p><strong>DR ${result.stack.rawDR}; effective DR ${result.stack.effectiveDR}</strong>. Hardened applies per layer. Wounding follows penetration.</p>` +
    children
      .filter(Boolean)
      .map((child, index) => {
        const trace = traceDamage(result.stack, child.effectiveDamage, calc.damageType);
        return (
          `<p>Hit ${calc.viewId === 'all' ? index + 1 : Number(calc.viewId) + 1}: ${child.effectiveDamage} ${esc(calc.damageType)} → ${trace.penetrating} penetrating; calculated blunt trauma ${trace.bluntTrauma}${child._bluntTrauma !== null ? ` (override ${child._bluntTrauma})` : ''}.</p>
      <table><thead><tr><th>Outer → inner</th><th>DR</th><th>Hard.</th><th>Divisor</th><th>Effective DR*</th><th>Damage in → out</th></tr></thead><tbody>` +
          trace.rows
            .map(
              (row) =>
                `<tr><td>${esc(row.name)}${row.flexible ? ' (flexible)' : ''}</td><td>${row.dr}</td><td>${row.hardened}</td><td>${row.divisor === -1 ? '∞' : row.divisor}</td><td>${row.effective}</td><td>${row.incoming} → ${row.outgoing}</td></tr>`,
            )
            .join('') +
          `</tbody></table>${trace.review ? `<p>${esc(trace.review)}</p>` : ''}`
        );
      })
      .join('') +
    '<p>*Fractional protection is retained across layers and the total is rounded down once. Rows allocate the rounded protection in layer order.</p></div>'
  );
}
// Remove the native single-divisor explanatory formula when showing a layered
// total, including the fresh results table rendered by Manual Damage.
function fixResults(root, state) {
  const { stack } = report(state);
  if (!stack) return;
  const calc = state.dialog._calculator;
  const raw = root.querySelector('#result-dr');
  if (raw?.nextElementSibling?.nextElementSibling)
    raw.nextElementSibling.nextElementSibling.textContent = `${calc.hitLocation}: configured armour layers`;
  if ((calc.useArmorDivisor && calc.armorDivisor) || calc.isShotgun) {
    const formula = root.querySelector('#result-penetrating')?.previousElementSibling;
    if (formula)
      formula.textContent = '= sum of layer DR after each layer’s divisor; round total down';
  }
}
export function patchADD(NativeADD, openEditor) {
  const proto = NativeADD.prototype;
  if (proto[patched]) return;
  for (const method of ['getData', 'activateListeners', 'resolveInjury', '_renderTemplate']) {
    if (typeof proto[method] !== 'function') throw new Error(`GGA ADD is missing ${method}.`);
  }
  const nativeGetData = proto.getData,
    nativeListeners = proto.activateListeners;
  const nativeResolve = proto.resolveInjury;
  proto.getData = async function (...args) {
    const state = stateFor(this);
    if (report(state).stack || report(state).error) {
      this.isSimpleDialog = false;
      if (!state.expanded) {
        this.options.height = 'auto';
        if (this.position) this.position.height = 'auto';
        state.expanded = true;
      }
    }
    return nativeGetData.apply(this, args);
  };
  proto.activateListeners = function (html) {
    const result = nativeListeners.call(this, html);
    const state = stateFor(this),
      root = elementOf(html);
    root.querySelector('.armour-add-panel')?.remove();
    const panel = root.ownerDocument.createElement('section');
    panel.className = 'armour-add-panel';
    const current = report(state),
      review = reviewError(state);
    panel.innerHTML = `<strong>Armour Layers</strong>
      <label><input type="checkbox" data-use-layers ${state.useLayers ? 'checked' : ''}> Use layered DR in this ADD</label>
      ${review ? `<p role="alert" class="armour-error">${esc(review)}</p>` : ''}
      ${current.stack ? `<p>${esc(current.status)}</p><details><summary>Layer breakdown: DR ${current.stack.rawDR} → effective DR ${current.stack.effectiveDR}</summary>${reportHTML(state)}</details>` : reportHTML(state)}
      <div class="armour-add-actions"><button type="button" data-edit="saved">Edit actor’s Armour Layers</button><button type="button" data-edit="temporary">Adjust for this ADD only</button>${state.override ? '<button type="button" data-edit="reset">Reload saved layers</button>' : ''}</div>
      <p>Direct Apply bypasses armour. Use the calculated Apply Injury controls below.</p>
      ${this._calculator.damageType === 'cor' ? '<p>Corrosion: update damaged layer DR manually after applying this hit.</p>' : ''}`;
    (root.querySelector('.gga-app') ?? root).prepend(panel);
    panel.querySelector('[data-use-layers]').addEventListener('change', (ev) => {
      state.useLayers = ev.currentTarget.checked;
      this.render(false);
    });
    for (const button of panel.querySelectorAll('[data-edit]')) {
      button.disabled = !canEdit(this.actor, game.user);
      button.addEventListener('click', () => {
        if (button.dataset.edit === 'reset') {
          state.override = null;
          state.useLayers = true;
          this.render(false);
          return;
        }
        const temporary = button.dataset.edit === 'temporary';
        void openEditor(this.actor, {
          temporary,
          ...(temporary ? { profile: state.override ?? readProfile(this.actor) } : {}),
          onSave: (value) => {
            if (temporary) state.override = value;
            state.useLayers = true;
            this.render(false);
          },
        });
      });
    }
    if (current.stack) {
      for (const input of root.querySelectorAll(
        '#override-dr input, #override-dr button, #hardened, [name="hardened"], #flexible-armor',
      )) {
        input.disabled = true;
        input.title = helpEnabled()
          ? 'Controlled by Armour Layers. Turn off layered DR above to use native controls.'
          : '';
      }
      // Keep the location chooser's DR consistent with the configured profile.
      const profile = state.override ?? readProfile(this.actor);
      for (const input of root.querySelectorAll('input[name="hitlocation"]')) {
        const row = input.closest('label')?.parentElement;
        const value = stackFor(profile, input.value, this._calculator.damageType, 1);
        if (value && row?.nextElementSibling?.nextElementSibling)
          row.nextElementSibling.nextElementSibling.textContent = String(value.rawDR);
      }
      fixResults(root, state);
    }
    this._armourHideHelp?.();
    this._armourHideHelp = attachHelp(panel);
    return result;
  };
  proto.resolveInjury = async function (keepOpen, injury, publicly, results = null) {
    const state = stateFor(this);
    if (results !== null) {
      const error = reviewError(state);
      if (error) {
        ui.notifications.error(`Armour Layers: ${error}`);
        throw new Error(error);
      }
      if (!canEdit(this.actor, game.user))
        throw new Error('You no longer have permission to apply damage to this actor.');
      if (report(state).stack) {
        const holder = document.createElement('div');
        holder.innerHTML = results;
        fixResults(holder, state);
        results = holder.innerHTML + reportHTML(state);
      }
    }
    return nativeResolve.call(this, keepOpen, injury, publicly, results);
  };
  // Manual Damage renders a fresh native results table immediately before apply.
  // resolveInjury above attaches its matching armour audit inside the same chat
  // message, inheriting native public/quiet recipient permissions.
  Object.defineProperty(proto, patched, { value: true });
}
