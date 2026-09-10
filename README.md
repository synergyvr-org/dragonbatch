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
- `journal` (optional) lists the subset of `stages` that appear in the quest log. The rest are internal machinery: they still get a `setstage` — their script fragments are half the reason this tool exists — but the preview dims them. No `journal` key means every stage is a journal stage.

The vanilla pack currently covers the **main quest line**, compiled from UESP's quest-stage tables and verified 2026-09-10. Guild lines, Daedric quests, and the DLC lines come in via the xEdit pipeline below, which is also the road to list-specific packs (MGO, Synergy VR, Nordic Adventures each ship different quest mods).

## The xEdit pipeline

1. Load the plugin(s) in SSEEdit/TES5VREdit — `Skyrim.esm`, the DLC masters, or any quest mod's plugin.
2. Right-click → **Apply Script** → `tools/ExportQuestsJSON.pas`. One `<Plugin>.quests.json` lands next to the xEdit executable per plugin.
3. `python3 tools/dump_to_pack.py Skyrim.esm.quests.json > skeleton.json` — turns the dump into an uncurated pack skeleton.
4. Curate in `data/curation/<pack>.json`: group quests into ordered lines, mark optional branches, add blurbs and notes, and list prune patterns for the radiant/internal quests the name filter didn't catch. Curation lives in the overlay, not the pack, so re-dumping a plugin never loses it.
5. `python3 tools/curate_pack.py skeleton.json data/curation/skyrim.json > data/packs/skyrim.json` — applies the overlay; anything unplaced and unpruned lands in a trailing "Uncurated" line, and a quest named in the overlay but missing from the skeleton fails the run loudly.
6. Add the pack to `data/manifest.json`.

The dump keeps each stage's `complete`/`fail` flags, whether it has log text, and the quest's objective indices. The converter drops fail stages, trims anything after the last completion stage, and records in `journal` the stages that are player-visible (log text, or an objective sharing the stage index) so the GUI can dim the internal ones. Editor IDs and stage indices are never hand-typed anywhere in this pipeline; that's the point of it.

## Roadmap

- [ ] Full vanilla + DLC coverage from an xEdit dump (guilds, Daedric, civil war, Dawnguard, Dragonborn, Hearthfire)
- [ ] Handling for mutually exclusive branches (civil war sides, Paarthurnax) beyond the `optional` flag
- [ ] Per-list packs layered on top of vanilla (MGO / Synergy VR / Nordic)
- [ ] Pack picker UI once there's more than one pack
- [ ] Hosting (likely a synergyvr-org repo → synergyvr.org/&lt;path&gt;)
