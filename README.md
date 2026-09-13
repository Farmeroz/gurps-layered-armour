# GURPS Layered Armour 0.1.3

A separate Foundry VTT module with a player-facing **Armour Layers** window. It saves ordered armour on an actor and supplies layered DR to GGA's normal Apply Damage Dialog (ADD), including the ADD opened by GURPS Manual Damage.

Target: **Foundry VTT 14 and GURPS Game Aid (GGA) 0.18.x**. Tested in live Foundry worlds with GGA 0.18.23 and Manual Damage 0.1.1.

## Export and import

Armour setups can now be shared between actors and game worlds as portable JSON files. Install this module version (or a compatible newer version) in the destination world.

1. Open the source actor's **Armour Layers** window and expand **Export / import setup**.
2. Click **Export JSON**. Your browser downloads an `actor-name-armour-layers.json` file containing the current editor values, including unsaved changes. Exporting does not save or change the actor.
3. Open the destination actor's Armour Layers window, expand **Export / import setup**, and choose that JSON file.
4. Click **Import into editor**. This replaces the complete setup currently shown in that editor, including unsaved edits; it does not append layers. The destination actor's saved armour stays unchanged.
5. Review the imported layers and coverage, then **Save to actor**. Cancel instead to leave the actor's saved setup unchanged. Export any unsaved setup you want to keep before loading a different one.

The file includes layer order, names, kinds, active state, profile enablement, DR, Hardened levels, flexible/rigid status, damage-type values, coverage, and per-location overrides. It contains no actor/world IDs, permissions, HP, equipment records, or other character data. Sharing the file does share the armour names and values it contains.

Location names must match the destination actor exactly. Unmatched names are flagged and retained in the Coverage tables so no values are silently discarded or guessed. Tick the appropriate destination rows, copy any per-location overrides across, and untick the unmatched rows. **Covers every location** applies to the destination actor's entire body plan, which may differ from the source. Locations without configured coverage still use the destination actor's normal sheet DR.

Export/import also works in the temporary **Adjust for this ADD only** editor. Its final **Use for this ADD** action changes that ADD's temporary stack, not the actor's saved profile. Unlinked tokens retain the existing separate-actor behaviour.

Files are validated before replacing the editor contents. Malformed JSON, unrelated exports, unsupported versions, invalid armour values, and files over 16 MiB are rejected. Importing never changes ownership or bypasses the existing save/conflict checks. The transfer format is version 1; existing actor profile schema 1 is unchanged, so no migration is needed.

To update the module, overwrite the existing module folder with this ZIP and reload Foundry.

## GUI fixes in 0.1.1

The editor now uses a consistent light surface and matching button/input colours, preventing the dark footer and unreadable button labels caused by mixed Foundry AppV1/global theme colours. Footer actions can wrap when the window is narrowed.

Coverage summaries update immediately when locations are ticked or **Covers every location** is changed. In that mode the table column is labelled **Override**: every location is covered already, and ticks enable only the location-specific overrides. Unticked rows have inactive DR inputs, keeping the displayed controls consistent with what is saved. Changes update in place without discarding unsaved fields or collapsing the coverage section.

To update, overwrite the existing module folder with this ZIP and reload Foundry. Existing actor profiles use the same schema and need no migration.

## Install or update

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Paste `https://github.com/Farmeroz/gurps-layered-armour/releases/latest/download/module.json` into **Manifest URL** and select **Install**.
3. Open your GURPS world, enable **GURPS Layered Armour** in **Manage Modules**, and reload the world.

Manual Damage is optional. If you already use it, keep it enabled alongside this module. No character sheet files or system files need editing. For a manual installation, download the versioned ZIP from [GitHub Releases](https://github.com/Farmeroz/gurps-layered-armour/releases).

## Open the Armour Layers window

- In the **Actors directory**, right-click an actor and choose **Armour Layers**. No scene or token is needed.
- Right-click a token to open its HUD, then click the **layer-group icon** labelled Armour Layers. A menu entry is also supplied for token context menus that use Foundry's token context hook.
- In chat, use `/armour` or `/armor`. Selected token actors open in separate windows. Duplicate linked tokens open one window for their shared actor. Without selected tokens, your assigned character is used.
- `/armour "Actor Name"` opens an owned world actor with that exact name. If names are duplicated, use the directory menu.
- In an ADD, choose **Edit actor's Armour Layers**.

Players can edit actors they own; GMs can edit any actor. This editor does not depend on GGA's separate GM-only permission for opening the ADD. The module does not grant players additional damage-application permissions.

A JavaScript macro can use:

```js
await game.modules.get('gurps-layered-armour').api.open();
```

For a specific world actor:

```js
await game.modules.get('gurps-layered-armour').api.open({
  actor: game.actors.get('ACTOR_ID')
});
```

The command registers with GGA's chat processor, so GGA chat macros and OtF command execution can invoke `/armour`. For example, a GGA OtF containing `[/armour]` opens the selected actors. `/armour help` displays the command help. If another module owns an alias, the module reports the conflict and leaves it alone; the menu and API remain available.

## Enter armour

1. Add a layer and give it a name, default DR, kind, Hardened level (0–6), and flexible/rigid status.
2. Expand **Coverage** and select its hit locations. New layers initially cover Torso, or the first actor location if Torso is unavailable.
3. Optionally give individual locations their own DR and damage-type values. **Covers every location** applies the default everywhere; selected rows can still override it.
4. Use the up/down arrows to put the outermost layer first. Add natural DR and force fields as their own layers where applicable. Force-field layers are treated as non-flexible.
5. Select **Use this armour profile in the ADD** and **Save to actor**.

**Configured coverage replaces the sheet's total DR at that location.** Include all protection there, including innate DR, skull protection where applicable, padding not already included in an armour entry, and other sources. Imported total DR is not added on top. Locations with no configured coverage retain GGA's normal sheet DR.

**Worn / active** temporarily enables or disables a saved layer. Disabled layers keep their configured coverage: taking armour off gives zero contribution rather than bringing back the old imported armour. Deleting the last layer covering a location removes that coverage and restores native sheet DR there. To switch the entire actor back to native DR, disable the profile.

Damage-type overrides use explicit entries, for example:

```text
cr=2; cut=4; pi=6; pi+=6; pi++=6
```

List each piercing size separately. Zero is valid. An unspecified type uses that layer's default DR. A location-specific type entry takes precedence over the layer's type entry; otherwise the layer's type entry remains in effect. An ordinary location DR override changes the default for types without an explicit type entry.

The editor shows imported DR as a reference, including slash strings and structured damage-type values. It does **not** guess layers from `x/y/z`. Slash values in GURPS can represent protection by damage type or location (Basic Set, p. 282). This release uses manually entered layer records rather than automatic equipment reconstruction.

## Use it in the ADD

Open a normal damage ADD, or use `/add` if Manual Damage is installed. The **Armour Layers** panel shows the active source and effective DR. Expand its breakdown to see each layer's DR, Hardened level, effective divisor, rounded DR contribution and damage reaching/leaving it.

- The normal ADD still handles damage entry, location, damage type, wound modifiers, injury tolerance, crippling limits, HP/FP application and public/quiet result cards.
- Global DR, Hardened and Flexible Armour controls are disabled when a saved stack covers the location. Edit the layers instead. The attack divisor and other damage controls remain available.
- **Adjust for this ADD only** opens a separate editor. Its changes remain only in this ADD, including Apply Multiple, and do not update actor flags or carry to another token in a Manual Damage queue.
- **Reload saved layers** discards the temporary stack and uses the actor's current saved profile.
- Turn off **Use layered DR in this ADD** to use the native controls for a reviewed exception.
- Use the lower **Apply Injury** controls to apply the calculated result. Native **Direct Apply** deliberately bypasses armour.

The armour breakdown is included in the same native damage result card, with the same public or quiet visibility. Merely opening or saving the armour editor does not roll dice, apply injury or send a chat message.

## Calculation rules and explicit boundaries

Rules references are to the supplied GURPS Basic Set: Characters p. 47 (Hardened), pp. 282 and 286 (split DR and armour layering), and Campaigns pp. 378–379 (DR, divisors and blunt trauma).

- Hardened changes the divisor **for its own layer**, using ignores DR → 100 → 10 → 5 → 3 → 2 → 1. The attack retains its original divisor for the next layer. GGA's divisor-4 convention treats it as 3 when Hardened applies. An unsupported Hardened divisor requires manual review.
- Fractional protection is retained while layer contributions are combined; the total is rounded down once. The breakdown allocates the rounded points cumulatively in outer-to-inner order. This preserves ordinary additive DR when layers share a divisor. Extending the total-rounding rule to mixed divisors is this module's explicit calculation convention, not a separate quoted rule about mixed Hardened layers.
- For DR 0 against a fractional divisor, the engine uses the Basic Set p. 379 DR-1 rule before dividing. For example, divisor 0.5 gives effective DR 2. This differs from GGA 0.18.23's native effective-DR-1 shortcut for that case.
- Wounding is applied after final penetration, once. Merely swapping simple DR layers with different Hardened levels need not change final penetration. Example: 20 damage, divisor 3, DR 12/Hardened 1 and DR 6/Hardened 0 gives effective DR 8 and 12 penetrating damage in either order.
- Rigid outer DR reduces the damage eligible for blunt trauma from flexible inner armour (p. 379). Consecutive flexible layers combine. An attack that penetrates the stack inflicts no additional blunt trauma. GGA's blunt-trauma setting and explicit override remain in use.
- If flexible armour stops the attack before an inner rigid layer and would inflict blunt trauma, application requires a reviewed native **Blunt Trauma** override. Enter 0 if the adjudicated injury is zero. The module does not silently decide that interaction.
- **Large-area and explosion armour calculation is not automated.** Choose a specific location for an ordinary hit, or turn off layered DR in that ADD and enter reviewed native DR/options. Calculated injury is blocked while the unresolved layered case remains active.
- Corrosion and ablative/semi-ablative depletion, armour damage, gaps/chinks, partial coverage rolls, special penetration modifiers, force-field effects beyond DR, and equipment weight/DX/encumbrance changes are not automated. Adjust the relevant values manually. Layer kinds document the source; they do not implement every modifier associated with it. Innate-layer order and lawful worn combinations remain player/GM rules decisions.

## Persistence and actor identity

Data is stored under `flags.gurps-layered-armour.profile` on the edited actor, separately from imported sheet fields. A linked token uses its world actor. An unlinked token uses its synthetic actor and is explicitly labelled in the editor; changing it does not edit the original world actor.

Saving retains the order, enabled state, locations and overrides. The editor rejects a save if it sees a different profile than the one it opened, reducing accidental overwrites from two editor windows. This is a client-side conflict check, not a transactional multi-user lock.

Updates confined to actor system data do not alter these module flags. A character reimport that updates the existing actor and preserves unrelated flags should therefore retain the profile. Recreating an actor, restoring a full actor export or an importer that replaces/removes flags may not preserve it. Saved profiles do not automatically follow later equipment edits or renamed hit locations. Check coverage after a reimport or body-plan change.

## Support and licence

Report problems through [GitHub Issues](https://github.com/Farmeroz/gurps-layered-armour/issues). Released under the [MIT licence](LICENSE).

GURPS is a trademark of Steve Jackson Games. This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers.
