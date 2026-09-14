import {
  ID,
  clone,
  readProfile,
  readStore,
  normaliseStore,
  validateProfile,
  canEdit,
  locationsOf,
  newLayer,
  parseSplit,
  formatSplit,
  elementOf,
} from './core.mjs';
import {
  exportSetup,
  importSetup,
  unmatchedLocations,
  setupFilename,
  downloadSetup,
  MAX_TRANSFER_BYTES,
} from './transfer.mjs';

import { equipmentOn, layerFromEquipment, sourceStatus } from './equipment.mjs';
import { attachHelp } from './help.mjs';

export function createEditorClass(Base) {
  return class ArmourLayersEditor extends Base {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ['gurps-layered-armour', 'armour-editor'],
        template: `modules/${ID}/templates/editor.hbs`,
        width: 810,
        height: 730,
        resizable: true,
      });
    }
    constructor(actor, { profile, onSave, temporary = false } = {}) {
      super();
      this.actor = actor;
      this.temporary = temporary;
      this.onSave = onSave;
      this.original = JSON.stringify(readStore(actor));
      this.store = readStore(actor);
      this.selectedId = this.store.activeId;
      this.draft = validateProfile(
        profile ?? this.store.sets.find((set) => set.id === this.selectedId).profile,
      );
      this.equipment = equipmentOn(actor);
      this.pickerSelection = new Set();
      this.filter = 'likely';
      this.search = '';
      this.locations = [
        ...new Set([
          ...locationsOf(actor),
          ...this.draft.layers.flatMap((l) => l.locations.map((x) => x.where)),
        ]),
      ];
      this.options.title = `Armour Layers: ${actor.name}${actor.isToken ? ' (unlinked token)' : ''}${temporary ? ' [this ADD only]' : ''}`;
    }
    get title() {
      return this.options.title;
    }
    getData() {
      return {
        importNotice: this.importNotice,
        setName: this.store.sets.find((set) => set.id === this.selectedId).name,
        activeName: this.store.sets.find((set) => set.id === this.store.activeId).name,
        sets: this.store.sets.map((set) => ({
          id: set.id,
          name: set.name,
          selected: set.id === this.selectedId,
        })),
        onlySet: this.store.sets.length === 1,
        selectedIsActive: this.selectedId === this.store.activeId,
        equipment: this.equipment.map((record) => ({
          ...record,
          selected: this.pickerSelection.has(record.key),
        })),
        unmatched: unmatchedLocations(this.draft, locationsOf(this.actor)),
        name: this.actor.name,
        tokenName: this.actor.isToken ? this.actor.token?.name : null,
        temporary: this.temporary,
        enabled: this.draft.enabled,
        sheetDR: Object.values(this.actor.system?.hitlocations ?? {}).map((loc) => ({
          where: loc.where,
          dr: loc.dr,
          split: formatSplit(loc.split),
        })),
        layers: this.draft.layers.map((layer, index) => ({
          ...layer,
          reviewed: !layer.reviewRequired,
          sourceStatus: sourceStatus(layer, this.equipment),
          index,
          number: index + 1,
          coverageSummary: layer.allLocations
            ? 'Every location'
            : layer.locations.map((x) => x.where).join(', ') || 'None',
          splitText: formatSplit(layer.split),
          first: index === 0,
          last: index === this.draft.layers.length - 1,
          kinds: ['worn', 'natural', 'forcefield'].map((value) => ({
            value,
            selected: layer.kind === value,
          })),
          coverage: this.locations.map((where) => {
            const loc = layer.locations.find((x) => x.where === where);
            return {
              where,
              checked: !!loc,
              dr: loc?.dr ?? '',
              splitText: formatSplit(loc?.split),
            };
          }),
        })),
      };
    }
    readForm(root) {
      const layers = [...root.querySelectorAll('.armour-layer')].map((card) => {
        const value = (name) => card.querySelector(`[data-field="${name}"]`).value;
        const checked = (name) => card.querySelector(`[data-field="${name}"]`).checked;
        const previous = this.draft.layers[Number(card.dataset.index)];
        const reviewInput = card.querySelector('[data-field="review"]');
        const reviewRequired = reviewInput ? !reviewInput.checked : previous?.reviewRequired;
        if (
          reviewInput?.checked &&
          !checked('allLocations') &&
          ![...card.querySelectorAll('[data-cover]')].some((input) => input.checked)
        )
          throw new Error(
            'Select at least one protected location before marking this layer reviewed.',
          );
        return {
          ...(previous?.source ? { source: clone(previous.source) } : {}),
          ...(reviewRequired !== undefined ? { reviewRequired } : {}),
          name: value('name'),
          enabled: checked('enabled'),
          dr: value('dr') === '' && reviewRequired ? null : value('dr'),
          kind: value('kind'),
          hardened: value('hardened'),
          flexible: checked('flexible'),
          allLocations: checked('allLocations'),
          split: parseSplit(value('split')),
          locations: [...card.querySelectorAll('[data-location]')]
            .filter((row) => row.querySelector('[data-cover]').checked)
            .map((row) => ({
              where: row.dataset.location,
              dr:
                row.querySelector('[data-dr]').value === ''
                  ? null
                  : row.querySelector('[data-dr]').value,
              split: parseSplit(row.querySelector('[data-split]').value),
            })),
        };
      });
      return validateProfile({
        schema: 1,
        enabled: root.querySelector('[data-profile-enabled]').checked,
        layers,
      });
    }
    activateListeners(html) {
      super.activateListeners(html);
      const root = elementOf(html);
      this.hideHelp?.();
      this.hideHelp = attachHelp(root);
      const error = (message) => {
        const output = root.querySelector('[data-error]');
        output.textContent = message;
        output.hidden = false;
        output.scrollIntoView?.({ block: 'nearest' });
      };
      // Update coverage in place: re-rendering here would discard unsaved text
      // and collapse the details the player is currently editing.
      const updateCoverage = (card) => {
        const all = card.querySelector('[data-field="allLocations"]').checked;
        const rows = [...card.querySelectorAll('[data-location]')];
        const selected = rows.filter((row) => row.querySelector('[data-cover]').checked);
        card.querySelector('[data-coverage-summary]').textContent =
          `Coverage: ${all ? 'Every location' : selected.map((row) => row.dataset.location).join(', ') || 'None'}`;
        card.querySelector('[data-coverage-heading]').textContent = all ? 'Override' : 'Covered';
        card.querySelector('[data-coverage-hint]').textContent = all
          ? 'Every location is covered. Tick a row only to enable its location-specific DR overrides.'
          : 'Tick each location this layer covers. Only ticked rows contribute DR.';
        for (const row of rows) {
          const checkbox = row.querySelector('[data-cover]');
          checkbox.setAttribute(
            'aria-label',
            `${all ? 'Override' : 'Cover'} ${row.dataset.location}`,
          );
          for (const input of row.querySelectorAll('[data-dr], [data-split]'))
            input.disabled = !checkbox.checked;
        }
      };
      for (const card of root.querySelectorAll('.armour-layer')) updateCoverage(card);
      const capture = () => {
        this.draft = this.readForm(root);
        const set = this.store.sets.find((set) => set.id === this.selectedId);
        set.profile = clone(this.draft);
        set.name = root.querySelector('[data-set-name]').value.trim();
        normaliseStore(this.store);
      };
      const filterEquipment = () => {
        this.search = root.querySelector('[data-equipment-search]').value;
        this.filter = root.querySelector('[data-equipment-filter]').value;
        for (const row of root.querySelectorAll('[data-equipment-row]')) {
          const record = this.equipment.find((record) => record.key === row.dataset.equipmentRow);
          row.hidden = !(
            record &&
            (!this.search ||
              (record.name + ' ' + record.notes)
                .toLowerCase()
                .includes(this.search.toLowerCase())) &&
            (this.filter === 'all' ||
              (this.filter === 'likely' && record.likely) ||
              (this.filter === 'carried' && record.carried) ||
              (this.filter === 'equipped' && record.equipped))
          );
        }
      };
      root.querySelector('[data-equipment-search]').value = this.search;
      for (const option of root.querySelectorAll('[data-equipment-filter] option'))
        option.selected = option.value === this.filter;
      root.querySelector('[data-equipment-search]').addEventListener('input', filterEquipment);
      root.querySelector('[data-equipment-filter]').addEventListener('change', filterEquipment);
      filterEquipment();
      root.querySelector('[data-set-select]').addEventListener('change', (ev) => {
        try {
          capture();
          this.selectedId = ev.target.value;
          this.draft = clone(this.store.sets.find((set) => set.id === this.selectedId).profile);
          this.updateLocations();
          this.render(false);
        } catch (err) {
          ev.target.value = this.selectedId;
          error(err.message);
        }
      });
      root.addEventListener('change', (ev) => {
        if (ev.target.matches('[data-equipment-choice]')) {
          if (ev.target.checked) this.pickerSelection.add(ev.target.value);
          else this.pickerSelection.delete(ev.target.value);
        }
        if (ev.target.matches('[data-field="allLocations"], [data-cover]'))
          updateCoverage(ev.target.closest('.armour-layer'));
      });
      root.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void this.save(root, error);
      });
      root.addEventListener('click', async (ev) => {
        const button = ev.target.closest('[data-action]');
        if (!button) return;
        ev.preventDefault();
        const action = button.dataset.action;
        if (this.importing) return;
        if (action === 'export') {
          try {
            if (!canEdit(this.actor, game.user))
              throw new Error('You no longer have permission to export this actor’s armour.');
            downloadSetup(
              exportSetup(this.readForm(root)),
              setupFilename(`${this.actor.name}-${root.querySelector('[data-set-name]').value}`),
              root.ownerDocument,
            );
          } catch (err) {
            error(err.message);
          }
          return;
        }
        if (action === 'import') return this.importFile(root, error);
        if (action === 'cancel') return this.close();
        if (action === 'save') return this.save(root, error);
        try {
          // Retain current field values before structural changes.
          capture();
          if (action.startsWith('set-')) {
            if (action === 'set-active') this.store.activeId = this.selectedId;
            if (action === 'set-new' || action === 'set-copy') {
              if (this.store.sets.length >= 30) throw new Error('Use at most 30 armour sets.');
              let n = 1,
                name;
              do {
                name = `${action === 'set-copy' ? 'Copy' : 'New set'} ${n++}`;
              } while (
                this.store.sets.some((set) => set.name.toLowerCase() === name.toLowerCase())
              );
              const id = foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2);
              const profile =
                action === 'set-copy'
                  ? clone(this.draft)
                  : { schema: 1, enabled: false, layers: [] };
              this.store.sets.push({ id, name, profile });
              this.selectedId = id;
              this.draft = clone(profile);
            }
            if (action === 'set-delete' && this.store.sets.length > 1) {
              this.store.sets = this.store.sets.filter((set) => set.id !== this.selectedId);
              if (this.store.activeId === this.selectedId)
                this.store.activeId = this.store.sets[0].id;
              this.selectedId = this.store.activeId;
              this.draft = clone(this.store.sets.find((set) => set.id === this.selectedId).profile);
            }
            this.updateLocations();
            this.render(false);
            return;
          }
          if (action === 'equipment-refresh') {
            this.equipment = equipmentOn(this.actor);
            this.render(false);
            return;
          }
          if (action === 'equipment-add') {
            if (!this.pickerSelection.size) throw new Error('Tick equipment to add first.');
            const current = equipmentOn(this.actor);
            const records = [...this.pickerSelection].map((key) =>
              current.find((record) => record.key === key),
            );
            if (records.some((record) => !record))
              throw new Error(
                'Selected equipment is no longer available. Refresh the equipment list.',
              );
            const additions = records
              .filter(
                (record) => !this.draft.layers.some((layer) => layer.source?.key === record.key),
              )
              .map((record) => layerFromEquipment(record, this.actor));
            if (!additions.length)
              throw new Error('Those equipment items are already in this set.');
            const next = validateProfile({
              ...this.draft,
              enabled: true,
              layers: [...this.draft.layers, ...additions],
            });
            this.draft = next;
            this.equipment = current;
            this.pickerSelection.clear();
            this.updateLocations();
            this.render(false);
            return;
          }
          const index = Number(button.closest('[data-index]')?.dataset.index);
          if (action === 'source-refresh') {
            const current = equipmentOn(this.actor);
            const record = current.find(
              (record) => record.key === this.draft.layers[index]?.source?.key,
            );
            if (!record)
              throw new Error(
                'The source equipment is unavailable. Your saved values are retained.',
              );
            const replacement = layerFromEquipment(record, this.actor);
            replacement.enabled = this.draft.layers[index].enabled;
            const next = clone(this.draft);
            next.layers[index] = replacement;
            this.draft = validateProfile(next);
            this.equipment = current;
            this.updateLocations();
          }
          if (action === 'add') {
            this.draft.layers.push(newLayer(this.locations));
            this.draft.enabled = true;
          }
          if (action === 'delete') this.draft.layers.splice(index, 1);
          if (action === 'up' && index > 0)
            [this.draft.layers[index - 1], this.draft.layers[index]] = [
              this.draft.layers[index],
              this.draft.layers[index - 1],
            ];
          if (action === 'down' && index < this.draft.layers.length - 1)
            [this.draft.layers[index + 1], this.draft.layers[index]] = [
              this.draft.layers[index],
              this.draft.layers[index + 1],
            ];
          this.render(false);
        } catch (err) {
          error(err.message);
        }
      });
    }
    updateLocations() {
      this.locations = [
        ...new Set([
          ...locationsOf(this.actor),
          ...this.draft.layers.flatMap((layer) => layer.locations.map((loc) => loc.where)),
        ]),
      ];
    }
    async close(...args) {
      this.hideHelp?.();
      this.closed = true;
      return super.close(...args);
    }
    async importFile(root, error) {
      if (this.importing || this.saving) return;
      const file = root.querySelector('[data-import-file]').files?.[0];
      if (!file) {
        error('Choose an exported armour JSON file first.');
        return;
      }
      this.importing = true;
      const controls = [...root.querySelectorAll('input, select, button')].map((input) => [
        input,
        input.disabled,
      ]);
      for (const [input] of controls) input.disabled = true;
      try {
        if (!canEdit(this.actor, game.user))
          throw new Error('You no longer have permission to import armour for this actor.');
        if (file.size > MAX_TRANSFER_BYTES)
          throw new Error('Choose an armour JSON file no larger than 16 MiB.');
        const imported = importSetup(await file.text());
        if (!canEdit(this.actor, game.user))
          throw new Error('You no longer have permission to import armour for this actor.');
        if (this.closed) return;
        this.draft = imported;
        this.locations = [
          ...new Set([
            ...locationsOf(this.actor),
            ...imported.layers.flatMap((layer) => layer.locations.map((loc) => loc.where)),
          ]),
        ];
        this.importNotice = `Imported ${imported.layers.length} layer(s) into this editor. Review the setup, then ${this.temporary ? 'choose Use for this ADD' : 'Save to actor'} to apply it. Cancel leaves the actor unchanged.`;
        this.render(false);
      } catch (err) {
        error(err.message);
      } finally {
        for (const [input, disabled] of controls) input.disabled = disabled;
        this.importing = false;
      }
    }
    async save(root, error) {
      if (this.saving || this.importing) return;
      this.saving = true;
      try {
        if (!canEdit(this.actor, game.user))
          throw new Error('You no longer have permission to edit this actor.');
        const value = this.readForm(root);
        if (!this.temporary) {
          if (JSON.stringify(readStore(this.actor)) !== this.original)
            throw new Error(
              'Armour changed since this window opened. Cancel and reopen to load the current actor data.',
            );
          const selected = this.store.sets.find((set) => set.id === this.selectedId);
          selected.profile = value;
          selected.name = root.querySelector('[data-set-name]').value.trim();
          const store = normaliseStore(this.store);
          await this.actor.setFlag(ID, 'profile', store);
          this.original = JSON.stringify(readStore(this.actor));
        }
        await this.onSave?.(this.temporary ? clone(value) : readProfile(this.actor));
        ui.notifications.info(
          this.temporary
            ? 'Armour changes set for this ADD only.'
            : `Armour Layers saved for ${this.actor.name}.`,
        );
        await this.close();
      } catch (err) {
        error(err.message);
      } finally {
        this.saving = false;
      }
    }
  };
}
