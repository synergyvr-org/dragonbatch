#!/usr/bin/env python3
"""Apply a curation overlay to a dump_to_pack skeleton.

    python3 curate_pack.py skeleton.json curation.json > pack.json

The skeleton's quest entries (names, stages, journal) are authoritative and
come from the plugin via the xEdit dump; the overlay holds the human
decisions: grouping into lines, order, optional flags, notes, blurbs, and
what to prune. Re-dumping a plugin never loses curation — just re-run this.

Quests the overlay doesn't place land in a trailing "Uncurated" line unless
they match a prune pattern (fnmatch globs against the editor ID,
case-insensitive). Overlay edids missing from the skeleton are reported on
stderr and the exit code is nonzero, so a renamed or removed quest can't
vanish silently.
"""
import argparse, fnmatch, json, os, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('skeleton')
    ap.add_argument('curation')
    args = ap.parse_args()

    skel = json.load(open(args.skeleton, encoding='utf-8'))
    cur = json.load(open(args.curation, encoding='utf-8'))

    # An overlay may extend another (path relative to itself): the base's
    # lines come first and prune lists concatenate, while id/title/notes stay
    # the child's. This is how a mod-list pack reuses the vanilla curation.
    if cur.get('extends'):
        base_path = os.path.join(os.path.dirname(args.curation), cur['extends'])
        base = json.load(open(base_path, encoding='utf-8'))
        cur['lines'] = base.get('lines', []) + cur.get('lines', [])
        cur['prune'] = base.get('prune', []) + cur.get('prune', [])

    pool = {}
    for line in skel['lines']:
        for q in line['quests']:
            pool[q['edid']] = q

    missing = []
    lines = []
    for cl in cur['lines']:
        quests = []
        for cq in cl['quests']:
            q = pool.pop(cq['edid'], None)
            if q is None:
                missing.append(cq['edid'])
                continue
            q = dict(q)
            if cq.get('optional'):
                q['optional'] = True
            if cq.get('note'):
                q['note'] = cq['note']
            if cq.get('branch'):
                q['branch'] = cq['branch']
            quests.append(q)
        line = {'id': cl['id'], 'title': cl['title'], 'quests': quests}
        if cl.get('blurb'):
            line['blurb'] = cl['blurb']
        if cl.get('nsfw'):
            line['nsfw'] = True
        lines.append(line)

    pruned = 0
    for pat in cur.get('prune', []):
        for edid in [e for e in pool if fnmatch.fnmatch(e.lower(), pat.lower())]:
            pool.pop(edid)
            pruned += 1

    if cur.get('keepUncurated', True) and pool:
        lines.append({
            'id': 'uncurated',
            'title': 'Uncurated',
            'blurb': 'Not yet placed in a questline. Group, order, and prune these before relying on them.',
            'quests': sorted(pool.values(), key=lambda q: q['edid'].lower()),
        })

    source = dict(skel.get('source', {}))
    if cur.get('notes'):
        source['notes'] = cur['notes']
    pack = {
        'schema': 1,
        'id': cur['id'],
        'title': cur['title'],
        'source': source,
        'lines': lines,
    }
    json.dump(pack, sys.stdout, indent=1)
    print()

    total = sum(len(l['quests']) for l in lines)
    print(f'{total} quests in {len(lines)} lines; pruned {pruned}; uncurated {len(pool)}', file=sys.stderr)
    if missing:
        print('MISSING from skeleton: ' + ', '.join(missing), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
