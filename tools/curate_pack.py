#!/usr/bin/env python3
"""Apply a curation overlay to a dump_to_pack skeleton.

    python3 curate_pack.py skeleton.json curation.json > pack.json

The skeleton's quest entries (names, stages, journal) are authoritative and
come from the plugin via the xEdit dump; the overlay holds the human
decisions: grouping into lines, order, optional flags, notes, blurbs, and
what to prune. Re-dumping a plugin never loses curation; just re-run this.

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
    ap.add_argument('--refs', action='append', default=[],
                    help='ExportRefsJSON dump; repeatable. Needed when the overlay uses "grants".')
    ap.add_argument('--uesp', help='edid-to-UESP-page-title mapping (data/uesp-links.json)')
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

    # Reference records (shouts/words/spells/items) for resolving "grants".
    # Console commands need load-order form IDs; the standard slots for the
    # five masters hold for vanilla and for mod lists that keep them first.
    SLOTS = {'skyrim.esm': '00', 'update.esm': '01', 'dawnguard.esm': '02',
             'hearthfires.esm': '03', 'dragonborn.esm': '04'}
    refs = {}
    for path in args.refs:
        dump = json.load(open(path, encoding='utf-8'))
        slot = SLOTS.get(dump.get('plugin', '').lower())
        if slot is None:
            print(f"--refs {path}: no load-order slot known for {dump.get('plugin')}", file=sys.stderr)
            sys.exit(1)
        for r in dump.get('refs', []):
            r['full'] = slot + r['formid']
            r['fullwords'] = [slot + w for w in r.get('words', [])]
            # First dump wins: a form ID belongs to the plugin that introduced
            # the record, and a later plugin's override must not restamp it
            # with the wrong load-order slot (Update.esm overrides the
            # Arch-Mage robes, but the form lives in Skyrim.esm's 00 slot).
            refs.setdefault(r['edid'].lower(), r)

    # UESP page titles, verified against the wiki's API and checked in as
    # data/uesp-links.json. An overlay quest may set "uesp" to a page title
    # to override, or to false to suppress the link.
    uesp = {}
    if args.uesp:
        uesp = {k.lower(): v for k, v in json.load(open(args.uesp, encoding='utf-8')).items()}

    unresolved = []

    def resolve_grants(grants):
        commands = []
        for g in grants:
            if 'dragonSouls' in g:
                commands.append('player.modav dragonsouls ' + str(g['dragonSouls']))
                continue
            kind = next(k for k in ('teachShout', 'teachWord', 'addSpell', 'addItem') if k in g)
            r = refs.get(g[kind].lower())
            if r is None:
                unresolved.append(g[kind])
                continue
            # Story-taught words are unlocked for free in-game, so teaching
            # pairs each word with an unlock instead of depending on the
            # player having dragon souls to spend.
            if kind == 'teachShout':
                for w in r['fullwords']:
                    commands += ['player.teachword ' + w, 'player.unlockword ' + w]
            elif kind == 'teachWord':
                commands += ['player.teachword ' + r['full'], 'player.unlockword ' + r['full']]
            elif kind == 'addSpell':
                commands.append('player.addspell ' + r['full'])
            else:
                commands.append('player.additem ' + r['full'] + ' ' + str(g.get('count', 1)))
        return commands

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
            if cq.get('grants'):
                q['commands'] = resolve_grants(cq['grants'])
            # Fixups are raw console commands emitted unconditionally after
            # the quest's stages: world-state repairs for what no stage can do
            # (Skjor's death is scene-scripted, so the batch must kill him).
            # Unlike grants these carry hand-sourced form IDs; cite UESP or
            # xEdit in the commit that adds one.
            if cq.get('fixups'):
                q['fixups'] = list(cq['fixups'])
            if 'uesp' in cq:
                if cq['uesp']:
                    q['uesp'] = cq['uesp']
            elif cq['edid'].lower() in uesp:
                q['uesp'] = uesp[cq['edid'].lower()]
            # Curation override for cinematic quests: emit exactly these
            # stages instead of the derived journal set. Journal-visible
            # stages can still start scenes (teleports, boss spawns); this
            # is how a quest like Alduin's Bane gets trimmed to its
            # completion stage after rig testing shows the scenes firing.
            if cq.get('emitStages'):
                known = set(q['stages']) | set(q.get('trimmed', []))
                bad = [s for s in cq['emitStages'] if s not in known]
                if bad:
                    print(f"emitStages for {cq['edid']} not in its stage list: {bad}", file=sys.stderr)
                    sys.exit(1)
                q['journal'] = cq['emitStages']
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
    # Mod-list packs: players must never touch the game's own folders, so the
    # GUI shows only the MO2 file instructions.
    if cur.get('mo2Only'):
        pack['mo2Only'] = True
    json.dump(pack, sys.stdout, indent=1)
    print()

    total = sum(len(l['quests']) for l in lines)
    print(f'{total} quests in {len(lines)} lines; pruned {pruned}; uncurated {len(pool)}', file=sys.stderr)
    if missing:
        print('MISSING from skeleton: ' + ', '.join(missing), file=sys.stderr)
        sys.exit(1)
    if unresolved:
        print('UNRESOLVED grants (not in any --refs dump): ' + ', '.join(unresolved), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
