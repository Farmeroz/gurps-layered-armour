# GURPS Layered Armour 0.3.0

A separate Foundry VTT module with a player-facing **Armour Layers** window. It saves ordered armour on an actor and supplies layered DR to GGA's normal Apply Damage Dialog (ADD), including the ADD opened by GURPS Manual Damage.

For **Foundry VTT 14 and GURPS Game Aid (GGA) 0.18.x**. Manual Damage is optional.

## Armour sets and equipment

Keep named sets such as **Everyday** and **Combat** on each actor. Existing armour appears as **Default**. Choose a set to edit, rename it, or use **New set** or **Duplicate**. Switching the editing selection retains draft changes. Choose **Make active**, then **Save sets to actor** to select the set used by the ADD. Cancel discards edits to all sets.

Selecting a set changes ADD protection only. It does not equip inventory items or change weight, DX or encumbrance. Each set has its own layer order, coverage and values. The active set is identified above the layers; selecting another set for editing does not activate it.

1. Expand **Add from actor equipment**. Search names and notes, and filter by **Likely armour**, **Equipped**, **Carried** or **All equipment**. The list includes container contents and available equipment items on this actor or unlinked token.
2. Tick the items to use and choose **Add selected as layers**. Each item becomes one layer; quantity does not multiply DR. Use **All equipment** if an armour item is not recognised by the suggested filter.
3. Review each layer's DR, coverage, Hardened level, flexible/rigid status and, where relevant, degradation mode. Reliable item values and complete GGA DR bonus lines are filled in where available. Unknown DR stays blank. Slash values such as `6/2` are not interpreted as separate layers.
4. Enter missing values, arrange the outermost layer first, then tick **I have reviewed this layer's armour values**. An enabled layer marked **Needs review** blocks calculated injury until reviewed or disabled.
5. Enable layered protection for the set, make it active if needed, and save.

The module does not derive individual armour from the actor's combined sheet DR. Include innate protection and other sources manually where needed. **Configured coverage replaces the sheet's total DR at that location.**

An equipment-derived layer retains its source link. Reopening the editor or using **Refresh equipment list** shows whether that item has changed. **Refresh from equipment** explicitly reloads its detected values into the draft and marks the layer for review again. If the source is missing, saved armour values remain available. Equipment changes never silently overwrite your layer edits.

## Help tooltips

Hover over a control or focus it with the keyboard for a short explanation. Press Escape to dismiss it. Help is enabled by default; turn off **Show help tooltips** under **Configure Settings → Module Settings → GURPS Layered Armour** to disable it on your client. Changing the preference takes effect immediately. This does not change other players' preference or remove labels. Tooltips close when their window closes or its controls are replaced.

## Export and import

Expand **Export / import setup** and choose **Export JSON** to download the displayed set, including unsaved edits. Exporting does not save the actor. The file preserves armour values, layer order, coverage, degradation mode and review state, but omits actor-specific equipment and Resource Tracker links. Current battle damage is actor state and is not exported.

On the destination actor, select or create a set, choose the JSON file, then **Import into editor**. Import replaces only the displayed set. Review the layers and coverage, choose **Make active** if appropriate, then **Save sets to actor**. Cancel leaves the actor unchanged.

Location names must match the destination actor exactly. Unmatched locations are retained and flagged. Select the correct destination locations, copy any overrides and untick unmatched rows. **Covers every location** applies to the destination actor's whole body plan.

Export/import also works in **Adjust for this ADD only**. **Use for this ADD** changes that dialog's temporary protection without saving actor sets. Earlier JSON exports are accepted. New exports require module 0.2.0 or later; malformed files and files over 16 MiB are rejected.

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

1. Add a layer and give it a name, default DR, kind, Hardened level (0–6), flexible/rigid status and, if needed, **Ablative** or **Semi-Ablative** degradation.
2. Expand **Coverage** and select its hit locations. New layers initially cover Torso, or the first actor location if Torso is unavailable.
3. Optionally give individual locations their own DR and damage-type values. **Covers every location** applies the default everywhere; selected rows can still override it.
4. Use the up/down arrows to put the outermost layer first. Add natural DR and force fields as their own layers where applicable. Force-field layers are treated as non-flexible.
5. Select **Enable layered protection for this set**, choose **Make active** if needed, then **Save sets to actor**. Saving automatically creates or updates a visible GGA Resource Tracker for each degrading layer.

**Configured coverage replaces the sheet's total DR at that location.** Include all protection there, including innate DR, skull protection where applicable, padding not already included in an armour entry, and other sources. Imported total DR is not added on top. Locations with no configured coverage retain GGA's normal sheet DR.

**Worn / active** temporarily enables or disables a saved layer. Disabled layers keep their configured coverage: taking armour off gives zero contribution rather than bringing back the old imported armour. Deleting the last layer covering a location removes that coverage and restores native sheet DR there. To switch the entire actor back to native DR, disable the profile.

Damage-type overrides use explicit entries, for example:

```text
cr=2; cut=4; pi=6; pi+=6; pi++=6
```

List each piercing size separately. Zero is valid. An unspecified type uses that layer's default DR. A location-specific type entry takes precedence over the layer's type entry; otherwise the layer's type entry remains in effect. An ordinary location DR override changes the default for types without an explicit type entry.

The editor shows imported DR as a reference, including slash strings and structured damage-type values. It does **not** guess layers from `x/y/z`. Slash values in GURPS can represent protection by damage type or location (Basic Set, p. 282). Use the equipment picker to create reviewable layers, or add layers manually.

### Ablative armour condition

A degrading layer keeps its configured DR unchanged and stores its current condition in a normal, visible GGA Resource Tracker named **Armour: _layer name_**. Players and GMs can therefore see armour condition on the actor outside the ADD and can restore the tracker when armour is repaired, replenished or replaced.

- **Ablative** DR loses one point of condition per point of basic damage that the layer actually stops.
- **Semi-Ablative** DR loses one point per full 10 points of basic damage that actually reach that layer.
- An inner degrading layer loses nothing when an outer layer stops the attack.
- Armour divisors and Hardened affect how much Ablative DR actually stops; they do not directly change the Semi-Ablative one-per-10 rate.
- Multiple hits in one ADD are resolved in sequence, so later hits see condition left by earlier hits.
- Condition changes shown in the ADD are previews. The tracker changes only when calculated injury is applied.

This follows Damage Resistance, **Ablative** and **Semi-Ablative** (Basic Set: Characters, p. 46). The module uses one shared condition pool per configured layer rather than per-hit-location damage. Model separately degradable physical components as separate layers.

## Use it in the ADD

Open a normal damage ADD, or use `/add` if Manual Damage is installed. The **Armour Layers** panel shows the active source and effective DR. Expand its breakdown to see each layer's DR, Hardened level, effective divisor, rounded DR contribution and damage reaching/leaving it.

- The normal ADD still handles damage entry, location, damage type, wound modifiers, Injury Tolerance, crippling limits, shock, major-wound and knockdown/stunning advice, HP/FP application and public/quiet result cards.
- Global DR, Hardened and Flexible Armour controls are disabled when a saved stack covers the location. Edit the layers instead. The attack divisor and other damage controls remain available.
- **Adjust for this ADD only** opens a separate editor. Its changes remain only in this ADD, including Apply Multiple, and do not update actor flags or carry to another token in a Manual Damage queue.
- **Reload saved layers** discards the temporary stack and uses the actor's current saved profile.
- Turn off **Use layered DR in this ADD** to use the native controls for a reviewed exception.
- For eligible piercing, impaling and tight-beam burning attacks, **Chinks / weak point** appears only when it is relevant. Tick it only after the attack successfully targeted a chink under B400.
- For **Large-Area** or explosion damage, expand **Large-area exposure** only if the default exposed-location list needs adjustment. The module averages Torso DR with the least-protected exposed location as B400 directs.
- Explosion collateral damage automatically uses Large-Area protection and ignores the attack's armour divisor under B414.
- Use the lower **Apply Injury** controls to apply the calculated result. Native **Direct Apply** deliberately bypasses armour.

The armour breakdown is included in the same native damage result card, with the same public or quiet visibility. Merely opening or saving the armour editor does not roll dice, apply injury or send a chat message.

## Calculation rules and explicit boundaries

Rules references are to GURPS Basic Set, Fourth Edition: Characters pp. 46–47 (Ablative, Semi-Ablative and Hardened), pp. 282 and 286 (split DR and armour layering), and Campaigns pp. 378–380 (DR, divisors, blunt trauma and injury), pp. 398–400 (hit locations, large-area injury and chinks), and pp. 414–415 (explosions and fragmentation).

- Hardened changes the divisor **for its own layer**, using ignores DR → 100 → 10 → 5 → 3 → 2 → 1. The attack retains its original divisor for the next layer. GGA's divisor-4 convention treats it as 3 when Hardened applies. An unsupported Hardened divisor requires manual review.
- Fractional protection is retained while layer contributions are combined; the total is rounded down once. The breakdown allocates the rounded points cumulatively in outer-to-inner order. This preserves ordinary additive DR when layers share a divisor. Extending the total-rounding rule to mixed divisors is this module's explicit calculation convention, not a separate quoted rule about mixed Hardened layers.
- For DR 0 against a fractional divisor, the engine uses the Basic Set p. 379 DR-1 rule before dividing. For example, divisor 0.5 gives effective DR 2. This differs from GGA 0.18.23's native effective-DR-1 shortcut for that case.
- Wounding is applied after final penetration, once. Merely swapping simple DR layers with different Hardened levels need not change final penetration. Example: 20 damage, divisor 3, DR 12/Hardened 1 and DR 6/Hardened 0 gives effective DR 8 and 12 penetrating damage in either order.
- Rigid outer DR reduces the damage eligible for blunt trauma from flexible inner armour (p. 379). Consecutive flexible layers combine. An attack that penetrates the stack inflicts no additional blunt trauma. GGA's blunt-trauma setting and explicit override remain in use.
- If flexible armour stops the attack before an inner rigid layer and would inflict blunt trauma, application requires a reviewed native **Blunt Trauma** override. Enter 0 if the adjudicated injury is zero. The module does not silently decide that interaction.
- **Chinks in armour** halve the applicable layered DR and remain cumulative with an armour divisor, as on B400. The checkbox is intentionally contextual; the module does not make the attack roll or decide whether a chink was successfully targeted.
- **Large-area injury** uses the B400 average of Torso DR and the least-protected exposed location, rounded up. The user may untick locations that are not exposed. If only one body part is exposed, select that specific hit location instead, as B400 directs.
- **Explosion collateral damage** uses the large-area calculation and does not receive the attack's armour divisor (B414). The ADD remains responsible for distance-based explosion damage.
- Ablative and Semi-Ablative condition is automated as described above. For large-area attacks, the module applies the B400 averaged protection to the shared layer condition; the Basic Set does not give a separate per-location Ablative procedure for this case.
- Corrosion damage to armour, partial-coverage rolls, special penetration modifiers beyond those described above, force-field effects beyond DR, and equipment weight/DX/encumbrance changes are not automated. Adjust those cases manually. Layer kinds document the source; they do not implement every modifier associated with it. Innate-layer order and lawful worn combinations remain player/GM rules decisions.

## Persistence and actor identity

Data is stored under `flags.gurps-layered-armour.profile` on the edited actor, separately from imported sheet fields. Existing single profiles become a Default set in memory and are saved in the new set format only when you save. A linked token uses its world actor. An unlinked token uses its synthetic actor and is explicitly labelled in the editor; changing it does not edit the original world actor.

Saving retains the order, enabled state, locations and overrides. The editor rejects a save if it sees a different profile than the one it opened, reducing accidental overwrites from two editor windows. This is a client-side conflict check, not a transactional multi-user lock.

Updates confined to actor system data do not alter these module flags. A character reimport that updates the existing actor and preserves unrelated flags should therefore retain the profile. Recreating an actor, restoring a full actor export or an importer that replaces/removes flags may not preserve it. Saved profiles do not automatically follow later equipment edits or renamed hit locations. Check coverage after a reimport or body-plan change.

## Support and licence

Report problems through [GitHub Issues](https://github.com/Farmeroz/gurps-layered-armour/issues). Released under the [MIT licence](LICENSE).

GURPS is a trademark of Steve Jackson Games. This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers.

## Vitality Reserve compatibility

Version 0.3.0 uses libWrapper for ADD integration. Enable libWrapper alongside this module. Use GGA Vitality Reserve 0.1.1 or later when combining them: armour review runs before VR routing, and the VR result retains the armour audit.
