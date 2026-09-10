#!/usr/bin/env python3
"""Turn an xEdit quest dump into a Dragonbatch pack skeleton.

    python3 dump_to_pack.py Skyrim.esm.quests.json > ../data/packs/new-pack.json

The output is a *skeleton*: every player-facing quest lands in one
"Uncurated" line, sorted by editor ID. Curation — grouping quests into
questlines, ordering them, marking optional branches, writing blurbs — is
deliberately a human step. The stage lists, though, are authoritative:
straight from the plugin, ascending, fail stages dropped.

Options:
  --include-nameless   keep quests with no display name (internal machinery,
                       radiant templates, and the like; off by default)
  --id PACKID          pack id (default: derived from the plugin name)
  --title TITLE        pack title (default: plugin name)
"""
import argparse, json, re, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dump')
    ap.add_argument('--include-nameless', action='store_true')
    ap.add_argument('--id')
    ap.add_argument('--title')
    args = ap.parse_args()

    dump = json.load(open(args.dump, encoding='utf-8'))
    plugin = dump.get('plugin', 'unknown.esp')

    quests = []
    skipped_nameless = 0
    for q in dump.get('quests', []):
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
        # If the plugin marks explicit completion stages, trim past the last one:
        # stages after the final "complete" flag are usually epilogue bookkeeping.
        completes = [s['i'] for s in q.get('stages', []) if s.get('complete')]
        if completes:
            last = max(completes)
            entry['stages'] = [i for i in stages if i <= last]
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
            'notes': f'Generated from {plugin} by dump_to_pack.py; uncurated.',
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
