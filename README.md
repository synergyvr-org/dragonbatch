# Dragonbatch

A web GUI for building Skyrim console batch files. Pick the quests or questlines you'd rather not replay, download a `.txt`, drop it in the game's `Data` folder (or an empty MO2 mod), and run `bat <name>` from the console on a new game: you start with those quests already completed.

Plain HTML/JS/CSS, no build step. Serve the directory and it works:

    python3 -m http.server 8080

## Why setstage, not completequest

`completequest` marks a quest done in the journal but skips the script fragments its stages carry, which is how you end up with a "finished" quest whose doors never unlocked and whose follow-up never started. Dragonbatch instead replays every journal stage of each selected quest in ascending order with `setstage`, which is the community-proven way to advance world state by console. It's still a shortcut through content the game expects you to play, so the UI tells people to save first, and so does this README: save first.

## Data model

`data/manifest.json` lists the available packs. A pack:

```json
{
  "schema": 1,
  "id": "skyrim-vanilla",
  "title": "Skyrim + official DLC",
  "source": { "type": "uesp|xedit", "notes": "provenance, verification date" },
  "lines": [
    {
      "id": "main-quest",
      "title": "Main Quest",
      "blurb": "Shown under the line heading.",
      "quests": [
        { "edid": "MQ101", "name": "Unbound", "stages": [150, 160, 180],
          "optional": false, "note": "Shown under the quest row." }
      ]
    }
  ]
}
```

Rules the app relies on:

- **Line and quest order is meaningful.** Output is generated in pack order, never click order, because later quests assume earlier ones ran.
- `stages` is ascending and complete: every index gets a `setstage`.
- `optional: true` keeps a quest out of the "through here" sweep and the line-level select-all; the reader opts in per quest (used for branches with consequences, like the quest that decides Paarthurnax's fate).
- `journal` (optional) lists the subset of `stages` that appear in the quest log, and it is what the batch emits: the community-proven skip set. The remaining stages are internal scene plumbing (teleports, actor spawns); replaying them back-to-back can hard-crash the game, so they stay in the pack strictly as reference. No `journal` key means the quest's visibility is unknown and every stage is emitted. Some journal stages still misbehave by starting scenes (Alduin's Bane teleports you into the Alduin fight); for those, the overlay can set `emitStages` on the quest to pin exactly what gets emitted, validated against the quest's real stage list.
- `fixups` (optional) is a list of raw console commands always emitted after the quest's stages: world-state repairs for what no stage can do. Skjor's death is scene-scripted, so the Companions line kills him by RefID after The Silver Hand completes. This is the one place form IDs are hand-sourced; take them from UESP or xEdit and cite the source in the commit.
- `commands` (optional) is a list of console commands emitted after the quest's stages when the reader leaves "Catch-up rewards" checked: the things setstage can't grant, like word-wall shouts and dragon souls. It's generated, never hand-written: the overlay expresses `grants` in editor IDs (`teachShout`, `teachWord`, `addSpell`, `addItem`, `dragonSouls`), and `curate_pack.py --refs <Plugin>.refs.json` (from `tools/ExportRefsJSON.pas`) resolves them to load-order form IDs, failing loudly on any editor ID it can't find.
- `branch` (optional) names the mutually exclusive alternative a quest belongs to (civil war sides, joining vs. destroying the Dark Brotherhood). Consecutive quests sharing a label render as one group under it, and adjacent groups get an "or" divider. The exclusivity is enforced: selecting a quest from one alternative (by checkbox, sweep, or line select-all) clears any selection in the line's other alternatives, and the through-here sweep never crosses into a rival branch. Select-all can't pick a side either: when more than one alternative has required quests, branched quests drop out of it, and a line that is nothing but such a choice (the civil war) loses its select-all checkbox entirely.

The vanilla pack currently covers the **main quest line**, compiled from UESP's quest-stage tables and verified 2026-09-10. Guild lines, Daedric quests, and the DLC lines come in via the xEdit pipeline below, which is also the road to list-specific packs (MGO, Synergy VR, Nordic Adventures each ship different quest mods).

## The xEdit pipeline

1. Load the plugin(s) in SSEEdit/TES5VREdit: `Skyrim.esm`, the DLC masters, or any quest mod's plugin.
2. Right-click → **Apply Script** → `tools/ExportQuestsJSON.pas`. One `<Plugin>.quests.json` lands next to the xEdit executable per plugin.
3. `python3 tools/dump_to_pack.py Skyrim.esm.quests.json Update.esm.quests.json Dawnguard.esm.quests.json HearthFires.esm.quests.json Dragonborn.esm.quests.json > skeleton.json` turns the dumps into an uncurated pack skeleton. Pass dumps in load order: quests merge by editor ID and a later plugin's override wins, exactly as in-game. The plugin that introduced a quest becomes its origin, and non-base origins land on the entry as `dlc`, which the GUI shows as a badge and the filter searches.
4. Curate in `data/curation/<pack>.json`: group quests into ordered lines, mark optional branches, add blurbs and notes, and list prune patterns for the radiant/internal quests the name filter didn't catch. Curation lives in the overlay, not the pack, so re-dumping a plugin never loses it.
5. `python3 tools/curate_pack.py skeleton.json data/curation/skyrim.json > data/packs/skyrim.json` applies the overlay: anything unplaced and unpruned lands in a trailing "Uncurated" line, and a quest named in the overlay but missing from the skeleton fails the run loudly.
6. Add the pack to `data/manifest.json`.

A mod-list pack builds on the same steps: dump the list's quest mods, feed all the dumps to `dump_to_pack.py` in load order, and give the list its own overlay that `"extends"` the vanilla one. The base overlay's lines and prunes come along, the child adds the mods' lines and its own prunes, and id/title/notes are the child's. Mod-list overlays should also set `"mo2Only": true`, which makes the GUI show only the MO2 file instructions. Players on a curated list must never touch the game's own folders. `data/curation/mgo.json` is the template.

The dump keeps each stage's `complete`/`fail` flags, whether it has log text, and the quest's objective indices. The converter drops fail stages, trims anything after the last completion stage, and records in `journal` the stages that are player-visible (log text, or an objective sharing the stage index); that is the set the batch actually emits, and it always includes the final completion stage even when that stage carries no journal text. Editor IDs and stage indices are never hand-typed anywhere in this pipeline; that's the point of it.

## Roadmap

- [x] Full vanilla + DLC coverage from an xEdit dump (guilds, Daedric, civil war, Dawnguard, Dragonborn, Hearthfire)
- [x] Handling for mutually exclusive branches (civil war sides, join-vs-destroy, Dawnguard sides) via `branch` groups with enforced pick-one
- [x] Per-list packs layered on top of vanilla: MGO shipped (Vigilant + Wyrmstooth); Synergy VR and Nordic Adventures still to come
- [x] Pack picker UI (`?pack=<key>` deep links, e.g. `?pack=mgo`)
- [x] Hosting: synergyvr.org/dragonbatch
- [ ] Verify Vigilant/Wyrmstooth quest order against a playthrough
- [ ] Synergy VR and Nordic Adventures packs
