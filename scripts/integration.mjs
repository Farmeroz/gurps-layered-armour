import { attachHelp, helpEnabled } from './help.mjs';
import {
  readProfile,
  validateProfile,
  stackFor,
  scalarStackFor,
  largeAreaStackFor,
  traceDamage,
  canEdit,
  escapeHTML as esc,
  elementOf,
} from './core.mjs';
import { requireConditions, depletionPlan, applyDepletion } from './resources.mjs';

const states = new WeakMap();
const patched = Symbol.for('gurps-layered-armour.addPatched');
function chinksEligible(calc) {
  return (
    !calc.isExplosion &&
    calc.hitLocation !== 'Large-Area' &&
    (['imp', 'pi-', 'pi', 'pi+', 'pi++'].includes(calc.damageType) ||
      (calc.damageType === 'burn' && calc.damageModifier === 'tbb'))
  );
}
function largeAreaLocations(actor) {
  const entries = actor.hitLocationsWithDR ?? [];
  const filtered = entries.filter((entry) => !Array.isArray(entry.roll) || entry.roll.length > 0);
  return [
    ...new Set((filtered.length ? filtered : entries).map((entry) => entry.where).filter(Boolean)),
  ];
}
function sheetDR(actor, where, type) {
  const entries = actor.hitLocationsWithDR ?? [];
  let entry = entries.find((item) => item.where === where);
  if (!entry) {
    const localised = globalThis.game?.i18n?.localize?.(`GURPS.hitLocation${where}`);
    if (localised) entry = entries.find((item) => item.where === localised);
  }
  const value = entry?.getDR?.(type) ?? entry?.dr;
  const dr = Number(value);
  return Number.isFinite(dr) && dr >= 0 ? Math.floor(dr) : 0;
}
export function stateFor(dialog) {
  let state = states.get(dialog);
  if (state) return state;
  state = { dialog, useLayers: true, override: null, chinks: false, exposed: null };
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
  for (const [index, child] of calc._calculators.entries()) {
    wrap(child, 'penetratingDamage', (native) => {
      const item = report(state).sequence?.[index];
      return item ? item.trace.penetrating : native();
    });
    wrap(child, 'calculatedBluntTrauma', (native) => {
      const item = report(state).sequence?.[index];
      return item ? item.trace.bluntTrauma : native();
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
    if (['Random', 'User Entered'].includes(calc.hitLocation)) {
      return {
        error:
          'Choose a specific hit location, or turn off layered DR for this ADD and enter reviewed native DR.',
      };
    }
    const largeArea = calc.isExplosion || calc.hitLocation === 'Large-Area';
    let location = largeArea ? 'Torso' : calc.hitLocation;
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
    const protectionFactor = state.chinks && chinksEligible(calc) ? 0.5 : 1;
    const initialConditions = requireConditions(state.dialog.actor, profile);
    const conditions = { ...initialConditions };
    const allExposed = largeAreaLocations(state.dialog.actor);
    const exposed = largeArea
      ? state.exposed
        ? allExposed.filter((where) => state.exposed.has(where))
        : allExposed
      : [];
    if (largeArea && exposed.length < 2) {
      return {
        error:
          'Large-area injury needs at least two exposed hit locations here. If only one body part is exposed, choose that specific hit location in the ADD (B400).',
      };
    }
    const managedLargeArea =
      largeArea &&
      ['Torso', ...exposed].some((where) =>
        profile.layers.some(
          (layer) => layer.allLocations || layer.locations.some((item) => item.where === where),
        ),
      );
    const makeLocationStack = (where, currentConditions) =>
      stackFor(
        profile,
        where,
        calc.damageType,
        divisor,
        multiplier,
        currentConditions,
        protectionFactor,
      ) ??
      scalarStackFor(
        sheetDR(state.dialog.actor, where, calc.damageType),
        divisor,
        multiplier,
        `Sheet DR: ${where}`,
      );
    const makeStack = (currentConditions) => {
      if (!largeArea) {
        return stackFor(
          profile,
          location,
          calc.damageType,
          divisor,
          multiplier,
          currentConditions,
          protectionFactor,
        );
      }
      if (!managedLargeArea) return null;
      const torso = makeLocationStack('Torso', currentConditions);
      const candidates = exposed.map((where) => ({
        where,
        stack: makeLocationStack(where, currentConditions),
      }));
      candidates.sort((a, b) => a.stack.rawDR - b.stack.rawDR);
      const weakest = candidates[0];
      return largeAreaStackFor(torso, weakest.stack, weakest.where);
    };
    const sequence = [];
    for (const [index, child] of calc._calculators.entries()) {
      const stack = makeStack(conditions);
      if (!stack) {
        if (!sequence.length)
          return { status: `No layers cover ${calc.hitLocation}. The ADD uses normal sheet DR.` };
        break;
      }
      const trace = traceDamage(stack, child.effectiveDamage, calc.damageType);
      const before = { ...conditions };
      for (const row of trace.rows) {
        if (!row.resourceId || !row.depletionLoss) continue;
        if (!Object.hasOwn(conditions, row.resourceId))
          throw new Error(`${row.name} is missing its armour condition tracker.`);
        conditions[row.resourceId] = Math.max(0, conditions[row.resourceId] - row.depletionLoss);
      }
      sequence.push({
        index,
        stack,
        trace,
        conditionsBefore: before,
        conditionsAfter: { ...conditions },
      });
    }
    const selected =
      calc.viewId === 'all' ? sequence[0] : (sequence[Number(calc.viewId)] ?? sequence[0]);
    return selected
      ? {
          stack: selected.stack,
          sequence,
          initialConditions,
          finalConditions: conditions,
          chinks: protectionFactor === 0.5,
          largeArea,
          exposed,
          status: largeArea
            ? `Large-area DR uses Torso and least-protected exposed location ${selected.stack.weakestLocation} (B400).`
            : `${state.override ? 'This ADD’s temporary' : 'Actor’s saved'} layers replace sheet DR at ${calc.hitLocation}.`,
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
  const items =
    calc.viewId === 'all'
      ? result.sequence
      : [result.sequence?.[Number(calc.viewId)]].filter(Boolean);
  for (const item of items ?? []) {
    const child = calc._calculators[item.index];
    if (calc.useBluntTrauma && item.trace.review && child?._bluntTrauma === null)
      return item.trace.review;
  }
  return '';
}
export function reportHTML(state) {
  const result = report(state),
    calc = state.dialog._calculator;
  if (!result.stack) return `<p>${esc(result.error ?? result.status)}</p>`;
  const items =
    calc.viewId === 'all'
      ? result.sequence
      : [result.sequence?.[Number(calc.viewId)]].filter(Boolean);
  return (
    `<div class="armour-report"><p>${esc(result.status)}</p><p><strong>DR ${result.stack.rawDR}; effective DR ${result.stack.effectiveDR}</strong>. Hardened applies per layer.${result.chinks ? ' Chinks/weak point halves DR (B400).' : ''} Wounding follows penetration.</p>` +
    (items ?? [])
      .map((item) => {
        const child = calc._calculators[item.index],
          trace = item.trace;
        return (
          `<p>Hit ${item.index + 1}: ${child.effectiveDamage} ${esc(calc.damageType)} → ${trace.penetrating} penetrating; calculated blunt trauma ${trace.bluntTrauma}${child._bluntTrauma !== null ? ` (override ${child._bluntTrauma})` : ''}.</p>
      <table><thead><tr><th>Outer → inner</th><th>DR</th><th>Hard.</th><th>Divisor</th><th>Effective DR*</th><th>Damage in → out</th><th>Condition</th></tr></thead><tbody>` +
          trace.rows
            .map((row) => {
              const condition =
                row.depletion === 'none'
                  ? '—'
                  : row.condition == null
                    ? row.depletion
                    : `${row.condition} → ${Math.max(0, row.condition - row.depletionLoss)} (-${row.depletionLoss})`;
              return `<tr><td>${esc(row.name)}${row.flexible ? ' (flexible)' : ''}${row.depletion !== 'none' ? ` (${esc(row.depletion)})` : ''}</td><td>${row.dr}</td><td>${row.hardened}</td><td>${row.divisor === -1 ? '∞' : row.divisor}</td><td>${row.effective}</td><td>${row.incoming} → ${row.outgoing}</td><td>${esc(condition)}</td></tr>`;
            })
            .join('') +
          `</tbody></table>${trace.review ? `<p>${esc(trace.review)}</p>` : ''}`
        );
      })
      .join('') +
    '<p>*Fractional protection is retained across layers and the total is rounded down once. Rows allocate the rounded protection in layer order. Armour condition changes are previews until injury is applied.</p></div>'
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
  if (!globalThis.libWrapper?.register)
    throw new Error('Armour Layers ADD integration requires libWrapper.');
  const register = (method, fn) =>
    libWrapper.register(
      'gurps-layered-armour',
      `GURPS.ApplyDamageDialog.prototype.${method}`,
      fn,
      'WRAPPER',
    );
  register('getData', async function (wrapped, ...args) {
    const state = stateFor(this);
    const calc = this._calculator;
    if (calc.isExplosion && calc.hitLocation !== 'Large-Area') {
      state.preExplosionLocation ??= calc.hitLocation;
      calc.hitLocation = 'Large-Area';
    } else if (
      !calc.isExplosion &&
      state.preExplosionLocation &&
      calc.hitLocation === 'Large-Area'
    ) {
      calc.hitLocation = state.preExplosionLocation;
      state.preExplosionLocation = null;
    }
    if (report(state).stack || report(state).error) {
      this.isSimpleDialog = false;
      if (!state.expanded) {
        this.options.height = 'auto';
        if (this.position) this.position.height = 'auto';
        state.expanded = true;
      }
    }
    return wrapped(...args);
  });
  register('activateListeners', function (wrapped, html) {
    const result = wrapped(html);
    const state = stateFor(this),
      root = elementOf(html);
    root.querySelector('.armour-add-panel')?.remove();
    const panel = root.ownerDocument.createElement('section');
    panel.className = 'armour-add-panel';
    const current = report(state),
      review = reviewError(state);
    const canUseChinks = chinksEligible(this._calculator),
      isLargeArea = this._calculator.isExplosion || this._calculator.hitLocation === 'Large-Area',
      exposureChoices = isLargeArea ? largeAreaLocations(this.actor) : [],
      selectedExposure = state.exposed ?? new Set(exposureChoices);
    panel.innerHTML = `<strong>Armour Layers</strong>
      <label><input type="checkbox" data-use-layers ${state.useLayers ? 'checked' : ''}> Use layered DR in this ADD</label>
      ${canUseChinks ? `<label><input type="checkbox" data-armour-chinks ${state.chinks ? 'checked' : ''} data-help="Use only when this attack successfully targeted a chink or weak point under B400. Layered DR is halved, cumulative with armour divisors."> Chinks / weak point (DR ×½)</label>` : ''}
      ${isLargeArea ? `<details class="armour-exposure"><summary>Large-area exposure: ${selectedExposure.size} location${selectedExposure.size === 1 ? '' : 's'}</summary><p>B400 uses Torso DR averaged with the least-protected exposed location. For explosions or cones, untick locations not facing or exposed to the attack.</p><div>${exposureChoices.map((where) => `<label><input type="checkbox" data-armour-exposed value="${esc(where)}" ${selectedExposure.has(where) ? 'checked' : ''}> ${esc(where)}</label>`).join('')}</div></details>` : ''}
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
    panel.querySelector('[data-armour-chinks]')?.addEventListener('change', (ev) => {
      state.chinks = ev.currentTarget.checked;
      this.render(false);
    });
    for (const input of panel.querySelectorAll('[data-armour-exposed]')) {
      input.addEventListener('change', () => {
        state.exposed = new Set(
          [...panel.querySelectorAll('[data-armour-exposed]:checked')].map((item) => item.value),
        );
        this.render(false);
      });
    }
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
      const conditions = requireConditions(this.actor, validateProfile(profile));
      for (const input of root.querySelectorAll('input[name="hitlocation"]')) {
        const row = input.closest('label')?.parentElement;
        const value = stackFor(profile, input.value, this._calculator.damageType, 1, 1, conditions);
        if (value && row?.nextElementSibling?.nextElementSibling)
          row.nextElementSibling.nextElementSibling.textContent = String(value.rawDR);
      }
      fixResults(root, state);
    }
    this._armourHideHelp?.();
    this._armourHideHelp = attachHelp(panel);
    return result;
  });
  register('resolveInjury', async function (wrapped, keepOpen, injury, publicly, results = null) {
    const state = stateFor(this);
    let depletion = null,
      expected = null;
    if (results !== null) {
      const error = reviewError(state);
      if (error) {
        ui.notifications.error(`Armour Layers: ${error}`);
        throw new Error(error);
      }
      if (!canEdit(this.actor, game.user))
        throw new Error('You no longer have permission to apply damage to this actor.');
      const calculated = report(state);
      if (calculated.stack) {
        // Recalculate here so repeated Apply Multiple operations see armour
        // condition left by the previous application.
        injury = this._calculator.pointsToApply;
        depletion = depletionPlan(calculated.sequence.map((item) => item.trace));
        expected = { ...calculated.initialConditions };
        const holder = document.createElement('div');
        holder.innerHTML = results;
        fixResults(holder, state);
        results = holder.innerHTML + reportHTML(state);
      }
    }
    const outcome = await wrapped(keepOpen, injury, publicly, results);
    if (depletion && Object.values(depletion).some(Boolean)) {
      try {
        await applyDepletion(this.actor, depletion, expected);
      } catch (error) {
        console.error(
          'gurps-layered-armour | Injury applied but armour condition update failed.',
          error,
        );
        ui.notifications.error(
          `Injury was applied, but armour condition could not be updated: ${error.message} Adjust the armour Resource Tracker manually; do not reapply injury.`,
        );
      }
    }
    return outcome;
  });
  // Manual Damage renders a fresh native results table immediately before apply.
  // resolveInjury above attaches its matching armour audit inside the same chat
  // message, inheriting native public/quiet recipient permissions.
  Object.defineProperty(proto, patched, { value: true });
}
