#!/usr/bin/env python3
"""Turn xEdit quest dumps into a Dragonbatch pack skeleton.

    python3 dump_to_pack.py Skyrim.esm.quests.json Update.esm.quests.json > skeleton.json

Pass dumps in load order: quests are merged by editor ID (case-insensitive)
and a later plugin's override of a quest wins, exactly as it does in-game.

The output is a *skeleton*: every player-facing quest lands in one
"Uncurated" line, sorted by editor ID. Curation — grouping quests into
questlines, ordering them, marking optional branches, writing blurbs — is
deliberately a human step. The stage lists, though, are authoritative:
straight from the plugin, ascending, fail stages dropped. Internal stages
(no log entries) are kept, because their script fragments matter; when a
quest has any, its 'journal' key lists the stages that do show in the quest
log, so the GUI can dim the internal ones.

Options:
  --include-nameless   keep quests with no display name (internal machinery,
                       radiant templates, and the like; off by default)
  --id PACKID          pack id (default: derived from the plugin name)
  --title TITLE        pack title (default: plugin name)
"""
import argparse, json, re, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dumps', nargs='+', metavar='dump')
    ap.add_argument('--include-nameless', action='store_true')
    ap.add_argument('--id')
    ap.add_argument('--title')
    args = ap.parse_args()

    # Load-order merge: later dumps override earlier ones per quest, matched
    # case-insensitively because editor IDs are (Update.esm ships 'weroad08'
    # for Skyrim.esm's 'WERoad08'). The plugin that *introduced* a quest is
    # its origin; overriding it later doesn't change where it came from.
    merged = {}
    origin = {}
    plugins = []
    for dumpfile in args.dumps:
        dump = json.load(open(dumpfile, encoding='utf-8'))
        plugin_name = dump.get('plugin', 'unknown.esp')
        plugins.append(plugin_name)
        for q in dump.get('quests', []):
            key = q['edid'].lower()
            origin.setdefault(key, plugin_name)
            merged[key] = q
    plugin = plugins[0]

    # Display names for non-base origins ("dlc" on the quest entry).
    DLC_NAMES = {'HearthFires.esm': 'Hearthfire'}
    def dlc_of(q):
        o = origin[q['edid'].lower()]
        if o == plugin:
            return None
        return DLC_NAMES.get(o, o.rsplit('.', 1)[0])

    quests = []
    skipped_nameless = 0
    for q in merged.values():
        if not q.get('name') and not args.include_nameless:
            skipped_nameless += 1
            continue
        stages = sorted({s['i'] for s in q.get('stages', []) if not s.get('fail')})
        if not stages:
            continue
        entry = {
            'edid': q['edid'],
            'name': q.get('name') or q['edid'],
            'stages': stages,
        }
        if dlc_of(q):
            entry['dlc'] = dlc_of(q)
        # If the plugin marks explicit completion stages, trim past the last one:
        # stages after the final "complete" flag are usually epilogue bookkeeping.
        completes = [s['i'] for s in q.get('stages', []) if s.get('complete')]
        if completes:
            last = max(completes)
            entry['stages'] = [i for i in stages if i <= last]
        # Journal stages vs internal ones. A stage is player-visible if it has
        # log text, or if an objective shares its index (Bethesda convention
        # for stages that update objectives without a journal entry). All of
        # them get a setstage; 'journal' just lets the GUI dim internal lines.
        # Older dumps without the 'log' field: treat everything as journal.
        if any('log' in s for s in q.get('stages', [])):
            visible = {s['i'] for s in q.get('stages', []) if s.get('log')}
            visible |= set(q.get('objectives', []))
            journal = [i for i in entry['stages'] if i in visible]
            if len(journal) < len(entry['stages']):
                entry['journal'] = journal
        quests.append(entry)

    quests.sort(key=lambda q: q['edid'].lower())
    pack_id = args.id or re.sub(r'[^a-z0-9]+', '-', plugin.lower()).strip('-')
    pack = {
        'schema': 1,
        'id': pack_id,
        'title': args.title or plugin,
        'source': {
            'type': 'xedit',
            'plugin': plugin,
            'notes': f'Generated from {", ".join(plugins)} by dump_to_pack.py (load order, last override wins); uncurated.',
        },
        'lines': [{
            'id': 'uncurated',
            'title': 'Uncurated (' + plugin + ')',
            'blurb': 'Everything the exporter found, in editor-ID order. Group, order, and prune before publishing.',
            'quests': quests,
        }],
    }
    json.dump(pack, sys.stdout, indent=1)
    print(file=sys.stdout)
    print(f'{len(quests)} quests; skipped {skipped_nameless} nameless', file=sys.stderr)


if __name__ == '__main__':
    main()
