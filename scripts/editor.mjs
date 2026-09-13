import {ID, clone, readProfile, validateProfile, canEdit, locationsOf, newLayer, parseSplit, formatSplit, elementOf} from './core.mjs';
import {exportSetup, importSetup, unmatchedLocations, setupFilename, downloadSetup, MAX_TRANSFER_BYTES} from './transfer.mjs';

export function createEditorClass(Base) {
  return class ArmourLayersEditor extends Base {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {classes: ['gurps-layered-armour', 'armour-editor'],
        template: `modules/${ID}/templates/editor.hbs`, width: 810, height: 730, resizable: true});
    }
    constructor(actor, {profile, onSave, temporary = false} = {}) {
      super();
      this.actor = actor;
      this.temporary = temporary;
      this.onSave = onSave;
      this.original = JSON.stringify(readProfile(actor));
      this.draft = validateProfile(profile ?? readProfile(actor));
      this.locations = [...new Set([...locationsOf(actor), ...this.draft.layers.flatMap(l => l.locations.map(x => x.where))])];
      this.options.title = `Armour Layers: ${actor.name}${actor.isToken ? ' (unlinked token)' : ''}${temporary ? ' [this ADD only]' : ''}`;
    }
    get title() { return this.options.title; }
    getData() {
      return {importNotice: this.importNotice, unmatched: unmatchedLocations(this.draft, locationsOf(this.actor)), name: this.actor.name, tokenName: this.actor.isToken ? this.actor.token?.name : null,
        temporary: this.temporary, enabled: this.draft.enabled,
        sheetDR: Object.values(this.actor.system?.hitlocations ?? {}).map(loc => ({where: loc.where, dr: loc.dr, split: formatSplit(loc.split)})),
        layers: this.draft.layers.map((layer, index) => ({...layer, index, number: index + 1,
          coverageSummary: layer.allLocations ? 'Every location' : layer.locations.map(x => x.where).join(', ') || 'None',
          splitText: formatSplit(layer.split), first: index === 0, last: index === this.draft.layers.length - 1,
          kinds: ['worn', 'natural', 'forcefield'].map(value => ({value, selected: layer.kind === value})),
          coverage: this.locations.map(where => {const loc = layer.locations.find(x => x.where === where);return {
            where, checked: !!loc, dr: loc?.dr ?? '', splitText: formatSplit(loc?.split)};})}))};
    }
    readForm(root) {
      const layers = [...root.querySelectorAll('.armour-layer')].map(card => {
        const value = name => card.querySelector(`[data-field="${name}"]`).value;
        const checked = name => card.querySelector(`[data-field="${name}"]`).checked;
        return {name: value('name'), enabled: checked('enabled'), dr: value('dr'), kind: value('kind'),
          hardened: value('hardened'), flexible: checked('flexible'), allLocations: checked('allLocations'),
          split: parseSplit(value('split')),
          locations: [...card.querySelectorAll('[data-location]')].filter(row => row.querySelector('[data-cover]').checked).map(row => ({
            where: row.dataset.location, dr: row.querySelector('[data-dr]').value === '' ? null : row.querySelector('[data-dr]').value,
            split: parseSplit(row.querySelector('[data-split]').value)}))};
      });
      return validateProfile({schema: 1, enabled: root.querySelector('[data-profile-enabled]').checked, layers});
    }
    activateListeners(html) {
      super.activateListeners(html);
      const root = elementOf(html);
      const error = message => {const output = root.querySelector('[data-error]');output.textContent = message;output.hidden = false;output.scrollIntoView?.({block: 'nearest'});};
      // Update coverage in place: re-rendering here would discard unsaved text
      // and collapse the details the player is currently editing.
      const updateCoverage = card => {
        const all = card.querySelector('[data-field="allLocations"]').checked;
        const rows = [...card.querySelectorAll('[data-location]')];
        const selected = rows.filter(row => row.querySelector('[data-cover]').checked);
        card.querySelector('[data-coverage-summary]').textContent = `Coverage: ${all ? 'Every location' : selected.map(row => row.dataset.location).join(', ') || 'None'}`;
        card.querySelector('[data-coverage-heading]').textContent = all ? 'Override' : 'Covered';
        card.querySelector('[data-coverage-hint]').textContent = all
          ? 'Every location is covered. Tick a row only to enable its location-specific DR overrides.'
          : 'Tick each location this layer covers. Only ticked rows contribute DR.';
        for (const row of rows) {
          const checkbox = row.querySelector('[data-cover]');
          checkbox.setAttribute('aria-label', `${all ? 'Override' : 'Cover'} ${row.dataset.location}`);
          for (const input of row.querySelectorAll('[data-dr], [data-split]')) input.disabled = !checkbox.checked;
        }
      };
      for (const card of root.querySelectorAll('.armour-layer')) updateCoverage(card);
      root.addEventListener('change', ev => {
        if (ev.target.matches('[data-field="allLocations"], [data-cover]')) updateCoverage(ev.target.closest('.armour-layer'));
      });
      root.addEventListener('submit', ev => {ev.preventDefault();void this.save(root, error);});
      root.addEventListener('click', async ev => {
        const button = ev.target.closest('[data-action]');
        if (!button) return;
        ev.preventDefault();
        const action = button.dataset.action;
        if (this.importing) return;
        if (action === 'export') {
          try {
            if (!canEdit(this.actor, game.user)) throw new Error('You no longer have permission to export this actor’s armour.');
            downloadSetup(exportSetup(this.readForm(root)), setupFilename(this.actor.name), root.ownerDocument);
          } catch (err) {error(err.message);}
          return;
        }
        if (action === 'import') return this.importFile(root, error);
        if (action === 'cancel') return this.close();
        if (action === 'save') return this.save(root, error);
        try {
          // Retain current field values before structural changes.
          this.draft = this.readForm(root);
          const index = Number(button.closest('[data-index]')?.dataset.index);
          if (action === 'add') {this.draft.layers.push(newLayer(this.locations));this.draft.enabled = true;}
          if (action === 'delete') this.draft.layers.splice(index, 1);
          if (action === 'up' && index > 0) [this.draft.layers[index - 1], this.draft.layers[index]] = [this.draft.layers[index], this.draft.layers[index - 1]];
          if (action === 'down' && index < this.draft.layers.length - 1) [this.draft.layers[index + 1], this.draft.layers[index]] = [this.draft.layers[index], this.draft.layers[index + 1]];
          this.render(false);
        } catch (err) {error(err.message);}
      });
    }
    async importFile(root, error) {
      if (this.importing || this.saving) return;
      const file = root.querySelector('[data-import-file]').files?.[0];
      if (!file) {error('Choose an exported armour JSON file first.');return;}
      this.importing = true;
      const controls = [...root.querySelectorAll('input, select, button')].map(input => [input, input.disabled]);
      for (const [input] of controls) input.disabled = true;
      try {
        if (!canEdit(this.actor, game.user)) throw new Error('You no longer have permission to import armour for this actor.');
        if (file.size > MAX_TRANSFER_BYTES) throw new Error('Choose an armour JSON file no larger than 16 MiB.');
        const imported = importSetup(await file.text());
        if (!canEdit(this.actor, game.user)) throw new Error('You no longer have permission to import armour for this actor.');
        this.draft = imported;
        this.locations = [...new Set([...locationsOf(this.actor), ...imported.layers.flatMap(layer => layer.locations.map(loc => loc.where))])];
        this.importNotice = `Imported ${imported.layers.length} layer(s) into this editor. Review the setup, then ${this.temporary ? 'choose Use for this ADD' : 'Save to actor'} to apply it. Cancel leaves the actor unchanged.`;
        this.render(false);
      } catch (err) {error(err.message);} finally {
        for (const [input, disabled] of controls) input.disabled = disabled;
        this.importing = false;
      }
    }
    async save(root, error) {
      if (this.saving || this.importing) return;
      this.saving = true;
      try {
        if (!canEdit(this.actor, game.user)) throw new Error('You no longer have permission to edit this actor.');
        const value = this.readForm(root);
        if (!this.temporary) {
          if (JSON.stringify(readProfile(this.actor)) !== this.original) throw new Error('Armour changed since this window opened. Cancel and reopen to load the current actor data.');
          await this.actor.setFlag(ID, 'profile', value);
          this.original = JSON.stringify(readProfile(this.actor));
        }
        await this.onSave?.(clone(value));
        ui.notifications.info(this.temporary ? 'Armour changes set for this ADD only.' : `Armour Layers saved for ${this.actor.name}.`);
        await this.close();
      } catch (err) {error(err.message);} finally {this.saving = false;}
    }
  };
}
