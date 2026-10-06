# Testing

Start with the setup commands in [CONTRIBUTING.md](CONTRIBUTING.md).

## Automated coverage

Tests cover layer ordering, armour divisors and Hardened, flexible armour and blunt trauma, Ablative/Semi-Ablative condition and Resource Trackers, sequential multi-hit depletion, chinks, large-area/explosion protection, shotgun interaction, profile validation/import/export, editor controls, commands, equipment integration, and native GGA damage resolution together with Manual Damage. The injury audit confirms GGA remains authoritative for Injury Tolerance, shock, major wounds, crippling, and B420 knockdown/stunning advice. Foundry documents and UI are mocked.

The suite exercises these behaviours but does not claim complete coverage or reproduce a connected Foundry world. All automated cases should run; the standard test command treats skipped Node tests as a failure. Test output is saved under `test-output/`.

## Source fixtures

- `crnormand/gurps` 0.18.23, commit `4fb95f7ed8e114993c65ef77dc912a7b77957b02`, cached in `.cache/gga/`; optional installed-source override: `GGA_SOURCE`.
- `Farmeroz/gurps-manual-add` 0.3.0-rc4, commit `ddeb6ac80946f59d327d97167c2a335811edc28f`, cached in `.cache/manual-add/`; optional installed-source override: `MANUAL_ADD_SOURCE`.

`npm run test:setup` downloads only the listed files from fixed revisions, records their hashes, and leaves them under the ignored `.cache/` directory. The test runner checks the revision and hashes before use. Run setup again if the cache is missing or changed. The cache is excluded from git and all user releases. An explicit source override is read directly; quote paths containing spaces. No installed source or world is modified.

## Live check

Open an owned test actor from the directory, save outer DR 12/Hardened 1 and inner DR 6 at Torso, then use 20 cutting damage with divisor 3 in the ADD. Expect DR 18, effective DR 8, penetration 12 and ordinary torso injury 18 before other modifiers. Reopen the editor and confirm persistence; use an unlinked token copy to confirm its separate identity. Check a normal damage roll and `/add` independently.

Open a saved armour setup, reorder layers, export/import it, and apply damage with an armour divisor and Hardened. Also test it together with the Manual Damage candidate.

Create DR 12 Ablative and Semi-Ablative test layers. Confirm a visible **Armour: _layer_** Resource Tracker appears on save, can be edited/reset from the actor sheet, and changes only after **Apply Injury**. Test an outer rigid layer stopping a hit before an inner degrading layer, multiple hits in one ADD, and an armour divisor against Ablative DR.

For B400, test an eligible chinks attack and confirm DR is halved cumulatively with any armour divisor. Test **Large-Area** with different Torso and limb protection, untick an unexposed location, and confirm the displayed weakest exposed location and averaged DR. Toggle Explosion and confirm it uses Large-Area DR and ignores the attack armour divisor.

Use your normal Foundry/GGA versions and module combination, and refresh connected clients after updating. Record unexpected notifications, visibility changes, or changed resource totals, together with the module versions and steps to reproduce them.

Create Everyday and Combat sets from inventory items. Verify both retain their own edits, only the active set supplies ADD DR, and switching sets does not change equipment. Change an equipment item, reopen the editor and explicitly refresh its layer. Review missing DR and coverage before applying injury. Check tooltip hover and keyboard focus, then disable the client preference and confirm the labels remain usable.

## Package verification

The build checks module/package versions, install URLs, declared assets, local imports, the allowed archive file list, and every archived file's bytes. The release ZIP contains only runtime files, the licence, and user documentation.

## Final candidate live checks (not verified by automated CI)

Use the release candidates together in your normal Foundry world with one GM and one connected player. Record the Foundry, GGA and module versions and each result.

- Open ordinary /add, expand Attack options, and confirm Fragmentation, Large-Area, Explosion and the explained Chinks control are discoverable.
- Apply explosion damage separately before fragment review. Confirm the replacement acknowledgement cannot accidentally apply the original basic/blast damage.
- Resolve fragments, try changing damage, range, centre, posture and visibility, and try Roll again. Keep hits must preserve results and original inputs; confirm discard must clear them. Test Close and window X too.
- Reset centre & distances; nominate a different zero-range or Direct hit recipient. Confirm distances recalculate and prior overrides/direct-hit ticks clear.
- Send multiple fragments into Ablative/Semi-Ablative armour. Confirm trackers and HP change only for applied hits, and later hits use the remaining protection.
- Skip a fragment whose rolled location is behind cover. Cancel midway through a multi-hit queue. Applied hits must remain applied; skipped and remaining hits must not change HP or armour.
- With the player connected, test ownership/GM-only permissions and public, GM, self and blind visibility. Blind results must remain hidden from players; this helper does not automatically transfer a player's pending queue to another client's GM. Use GM-led review for blind fragmentation.
- Reload the world and confirm armour configuration and remaining tracker values persist.

Passing automated tests does not establish these connected-world results. Record any failure before promoting to stable.
