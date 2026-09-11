// Dragonbatch: pick quests, get a console batch file that completes them.
//
// Data lives in JSON packs (data/manifest.json lists them). A pack holds
// ordered questlines; each quest carries its editor ID and the ascending list
// of stage indices (an optional `journal` subset marks the ones that show in
// the quest log; the rest are internal, dimmed in the preview but still
// generated). Generation replays every stage in order with
// `setstage`, because completing a quest properly means running the script
// fragments its stages carry: `completequest` alone marks the journal and
// leaves the world none the wiser.
//
// Selection state lives in a Set of editor IDs. Output order always follows
// pack order (line by line, quest by quest), never click order, because the
// stages of a later quest often assume the earlier ones have run.

const state = {
  pack: null,
  selected: new Set(),
  filter: '',
  dlcHues: new Map(),
};

// Every plugin gets its own pill color: hues handed out in order of first
// appearance in the pack, from a palette tuned for the dark theme (and
// steering clear of the gold accent). Packs with more plugins than palette
// entries continue around the wheel at the golden angle.
const DLC_HUES = [210, 145, 280, 15, 330, 180, 80, 250];

function assignDlcHues() {
  state.dlcHues.clear();
  for (const line of state.pack.lines) {
    for (const quest of line.quests) {
      if (quest.dlc && !state.dlcHues.has(quest.dlc)) {
        const i = state.dlcHues.size;
        const hue = i < DLC_HUES.length
          ? DLC_HUES[i]
          : Math.round((DLC_HUES[DLC_HUES.length - 1] + 137.508 * (i - DLC_HUES.length + 1)) % 360);
        state.dlcHues.set(quest.dlc, hue);
      }
    }
  }
}

function dlcPill(dlc, q) {
  const hue = state.dlcHues.get(dlc) ?? 210;
  return '<span class="tag dlc" style="color:hsl(' + hue + ' 65% 75%);border-color:hsl(' + hue + ' 65% 75% / 0.35)">' +
    highlight(dlc, q) + '</span>';
}

// Pills travel as one unit: either they all fit on the current line, or the
// line wraps before the whole group.
function pillGroup(pills) {
  return pills.length ? ' <span class="tags">' + pills.join(' ') + '</span>' : '';
}

const $ = (sel) => document.querySelector(sel);

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Escaped HTML with <mark> around each case-insensitive occurrence of q.
function highlight(s, q) {
  if (!q) return esc(s);
  const lower = s.toLowerCase();
  let out = '', i = 0;
  for (let idx = lower.indexOf(q); idx !== -1; idx = lower.indexOf(q, i)) {
    out += esc(s.slice(i, idx)) + '<mark>' + esc(s.slice(idx, idx + q.length)) + '</mark>';
    i = idx + q.length;
  }
  return out + esc(s.slice(i));
}

// A line whose quests all come from the same DLC wears that DLC's badge on
// its title, so collapsed lines are spottable too. Mixed or base lines don't.
function lineDlc(line) {
  const dlcs = new Set(line.quests.map((quest) => quest.dlc || ''));
  return dlcs.size === 1 ? [...dlcs][0] || null : null;
}

function lineLabel(line, q) {
  const pills = [];
  const dlc = lineDlc(line);
  if (dlc) pills.push(dlcPill(dlc, q));
  if (line.nsfw) pills.push('<span class="tag nsfw">NSFW</span>');
  return highlight(line.title, q) + pillGroup(pills);
}

function questLabel(quest, q, lineBadge) {
  // The name is one unbreakable unit (it must never wrap away from its
  // checkbox); the edid and the pill group may flow to the next line.
  // A quest's plugin pill is omitted when the line's title already wears the
  // same badge — it only appears where it adds information (mixed lines).
  const pills = [];
  if (quest.dlc && quest.dlc !== lineBadge) pills.push(dlcPill(quest.dlc, q));
  if (quest.optional) pills.push('<span class="tag">optional</span>');
  return '<span class="qname">' + highlight(quest.name, q) + '</span> <span class="edid">' + highlight(quest.edid, q) + '</span>' +
    pillGroup(pills);
}

let manifest = null;

// Packs are addressable as ?pack=<key>, where the key is the pack file's
// basename — so the MGO docs can link straight to the MGO pack.
function packKey(entry) { return entry.file.replace(/^.*\//, '').replace(/\.json$/, ''); }

async function load() {
  manifest = await (await fetch('data/manifest.json')).json();
  const want = new URLSearchParams(location.search).get('pack');
  const entry = manifest.packs.find(p => packKey(p) === want) ||
    manifest.packs.find(p => p.default) || manifest.packs[0];
  if (manifest.packs.length > 1) {
    const sel = $('#pack-select');
    sel.innerHTML = '';
    for (const p of manifest.packs) {
      const opt = document.createElement('option');
      opt.value = packKey(p);
      opt.textContent = p.title || packKey(p);
      sel.appendChild(opt);
    }
    sel.value = packKey(entry);
    sel.hidden = false;
    $('#pack-title').hidden = true;
  }
  await loadPack(entry);
}

async function loadPack(entry) {
  state.pack = await (await fetch('data/' + entry.file)).json();
  state.selected.clear();
  openBeforeFilter = null;
  assignDlcHues();
  $('#pack-title').textContent = state.pack.title;
  $('#source-note').textContent = state.pack.source.notes;
  // Mod-list packs get MO2-only file instructions: their installs are
  // sacrosanct, so the Data-folder route isn't offered at all.
  $('#howto-file-vanilla').hidden = !!state.pack.mo2Only;
  $('#howto-file-mo2').hidden = !state.pack.mo2Only;
  $('#launch-vanilla').hidden = !!state.pack.mo2Only;
  $('#launch-mo2').hidden = !state.pack.mo2Only;
  render();
  update();
}

function questsOf(line) { return line.quests; }

// Selecting a quest that belongs to a mutually exclusive branch clears the
// line's other branches — the "pick one" rule the branch labels advertise.
// Unbranched quests in the same line are never touched.
function selectQuest(line, quest) {
  if (quest.branch) {
    for (const q of questsOf(line)) {
      if (q.branch && q.branch !== quest.branch) state.selected.delete(q.edid);
    }
  }
  state.selected.add(quest.edid);
}

// What the line's select-all checkbox covers: every non-optional quest —
// except that when two or more branches have non-optional quests, the choice
// between them is the reader's, so all branched quests drop out. A line that
// is nothing but such a choice has no targets, and no select-all checkbox.
function selectAllTargets(line) {
  const required = questsOf(line).filter(q => !q.optional);
  const branches = new Set(required.filter(q => q.branch).map(q => q.branch));
  return branches.size > 1 ? required.filter(q => !q.branch) : required;
}

function render() {
  const root = $('#lines');
  root.innerHTML = '';
  for (const line of state.pack.lines) {
    const details = document.createElement('details');
    details.className = 'line';
    details.addEventListener('toggle', updateToggleLines);

    const summary = document.createElement('summary');
    if (selectAllTargets(line).length) {
      const lineBox = document.createElement('input');
      lineBox.type = 'checkbox';
      lineBox.setAttribute('aria-label', 'Select all of ' + line.title);
      lineBox.addEventListener('click', (e) => {
        e.stopPropagation();
        const targets = selectAllTargets(line);
        const allOn = targets.every(q => state.selected.has(q.edid));
        for (const q of targets) allOn ? state.selected.delete(q.edid) : selectQuest(line, q);
        update();
      });
      summary.appendChild(lineBox);
    }
    const title = document.createElement('span');
    title.className = 'line-title';
    title.innerHTML = lineLabel(line, '');
    summary.appendChild(title);
    details.appendChild(summary);

    if (line.blurb) {
      const blurb = document.createElement('p');
      blurb.className = 'blurb';
      blurb.textContent = line.blurb;
      details.appendChild(blurb);
    }

    // Chunk the line's quests into runs sharing a `branch` label. Adjacent
    // branch groups are mutually exclusive alternatives: each renders under
    // its label, with an "or" divider between them. Purely presentational —
    // sweep and select-all semantics come from `optional` alone.
    const groups = [];
    for (const quest of questsOf(line)) {
      const branch = quest.branch || null;
      if (!groups.length || groups[groups.length - 1].branch !== branch) groups.push({ branch, quests: [] });
      groups[groups.length - 1].quests.push(quest);
    }

    groups.forEach((group, gi) => {
      if (gi > 0 && groups[gi - 1].branch && group.branch) {
        const or = document.createElement('p');
        or.className = 'branch-or';
        or.textContent = 'or';
        details.appendChild(or);
      }
      const list = document.createElement('ul');
      for (const quest of group.quests) {
        const li = document.createElement('li');
        li.dataset.search = (quest.name + ' ' + quest.edid + ' ' + (quest.note || '') + ' ' + (quest.dlc || '') + ' ' + line.title + (line.nsfw ? ' nsfw' : '')).toLowerCase();
        li._quest = quest; // for the filter's match highlighting
        // The row is a nowrap flexbox so the button can never drop below the
        // checkbox — it shrinks and wraps its own inline content instead.
        const row = document.createElement('div');
        row.className = 'qrow';
        li.appendChild(row);

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = 'q-' + quest.edid;
        box.addEventListener('change', () => {
          box.checked ? selectQuest(line, quest) : state.selected.delete(quest.edid);
          update();
        });
        row.appendChild(box);

        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'quest-name';
        name.title = 'Complete ' + line.title + ' through here (click again to undo)';
        name.innerHTML = questLabel(quest, '', lineDlc(line));
        name.addEventListener('click', () => {
          // Through-here, as a toggle. Selecting sweeps in this quest plus
          // every earlier non-optional quest in the line; clicking a quest
          // that's already selected removes exactly that same set. Optional
          // quests other than the clicked one are never touched either way,
          // so fine-tuning survives. Rival branches are skipped on the way
          // (and cleared by selectQuest when selecting), so sweeping
          // "through" an alternative can't select both sides.
          const removing = state.selected.has(quest.edid);
          const apply = (q) => removing ? state.selected.delete(q.edid) : selectQuest(line, q);
          for (const q of questsOf(line)) {
            const sameSide = !q.branch || q.branch === quest.branch;
            if (sameSide && !q.optional) apply(q);
            if (q.edid === quest.edid) { apply(q); break; }
          }
          update();
        });
        row.appendChild(name);

        if (quest.note) {
          const note = document.createElement('p');
          note.className = 'note';
          note.textContent = quest.note;
          li.appendChild(note);
        }
        list.appendChild(li);
      }
      if (group.branch) {
        const wrap = document.createElement('div');
        wrap.className = 'branch';
        const label = document.createElement('p');
        label.className = 'branch-label';
        label.textContent = group.branch;
        wrap.appendChild(label);
        wrap.appendChild(list);
        details.appendChild(wrap);
      } else {
        details.appendChild(list);
      }
    });
    root.appendChild(details);
  }
  updateToggleLines();
  applyFilter();
}

// Live filter. Matches against each quest's name, editor ID, note, and line
// title (so "brotherhood" surfaces the whole line, and "Azura" finds The
// Black Star via its note). While a filter is active, lines with hits are
// forced open showing only the hits and everything else hides; blurbs and
// "or" dividers get out of the way. Clearing the filter restores whatever
// open/closed state the reader had before.
let openBeforeFilter = null;

function applyFilter() {
  const q = state.filter.trim().toLowerCase();
  const filtering = q !== '';
  const details = Array.from(document.querySelectorAll('#lines details.line'));
  if (filtering && openBeforeFilter === null) openBeforeFilter = details.map(d => d.open);
  if (!filtering && openBeforeFilter !== null) {
    details.forEach((d, i) => { d.open = openBeforeFilter[i]; });
    openBeforeFilter = null;
  }
  let anyHit = false;
  for (const [i, d] of details.entries()) {
    const line = state.pack.lines[i];
    const badge = lineDlc(line);
    const lineTitle = d.querySelector('.line-title');
    lineTitle.innerHTML = lineLabel(line, filtering ? q : '');
    let lineHit = false;
    for (const li of d.querySelectorAll('li')) {
      const hit = !filtering || li.dataset.search.includes(q);
      li.hidden = !hit;
      if (hit) lineHit = true;
      // Re-render the row's text with (or without) match highlighting.
      const mq = hit && filtering ? q : '';
      li.querySelector('.quest-name').innerHTML = questLabel(li._quest, mq, badge);
      const note = li.querySelector('.note');
      if (note) note.innerHTML = highlight(li._quest.note, mq);
    }
    for (const branch of d.querySelectorAll('.branch')) {
      branch.hidden = filtering && !Array.from(branch.querySelectorAll('li')).some(li => !li.hidden);
    }
    for (const el of d.querySelectorAll('.branch-or, .blurb')) el.hidden = filtering;
    d.hidden = filtering && !lineHit;
    if (filtering && lineHit) d.open = true;
    if (lineHit) anyHit = true;
  }
  $('#no-matches').hidden = !filtering || anyHit;
}

// The button expands when everything is collapsed, collapses otherwise, and
// its label always names the action it will take.
function updateToggleLines() {
  const anyOpen = Array.from(document.querySelectorAll('#lines details.line')).some(d => d.open);
  $('#toggle-lines').textContent = anyOpen ? 'Collapse all' : 'Expand all';
}

function generate() {
  const withComments = $('#comments').checked;
  const rows = [];
  let quests = 0, commands = 0;
  for (const line of state.pack.lines) {
    for (const quest of questsOf(line)) {
      if (!state.selected.has(quest.edid)) continue;
      quests++;
      if (withComments) rows.push({ text: '; ' + quest.name + ' (' + quest.edid + ')', internal: false });
      // quest.journal, when present, lists the stages that show in the quest
      // log; the rest are internal. All of them get a setstage either way —
      // the split only affects how the preview displays them.
      const journal = quest.journal ? new Set(quest.journal) : null;
      for (const stage of quest.stages) {
        rows.push({ text: 'setstage ' + quest.edid + ' ' + stage, internal: journal !== null && !journal.has(stage) });
        commands++;
      }
    }
  }
  return { rows, text: rows.map(r => r.text).join('\n') + (rows.length ? '\n' : ''), quests, commands };
}

function update() {
  // Reflect selection into the checkboxes and line tri-states.
  for (const line of state.pack.lines) {
    let on = 0;
    for (const quest of questsOf(line)) {
      const box = document.getElementById('q-' + quest.edid);
      const has = state.selected.has(quest.edid);
      if (box) box.checked = has;
      if (has) on++;
    }
    const lineBox = document.querySelector('#lines details:nth-child(' + (state.pack.lines.indexOf(line) + 1) + ') summary input');
    if (lineBox) {
      const targets = selectAllTargets(line);
      lineBox.checked = targets.length > 0 && targets.every(q => state.selected.has(q.edid));
      lineBox.indeterminate = on > 0 && !lineBox.checked;
    }
  }
  const { rows, quests, commands } = generate();
  const pre = $('#preview');
  pre.textContent = '';
  let internal = 0;
  for (const row of rows) {
    const span = document.createElement('span');
    span.textContent = row.text + '\n';
    if (row.internal) { span.className = 'internal'; internal++; }
    pre.appendChild(span);
  }
  if (!rows.length) pre.textContent = '(no quests selected)';
  $('#internal-note').hidden = internal === 0;
  $('#count').textContent = quests + ' quest' + (quests === 1 ? '' : 's') + ' · ' + commands + ' command' + (commands === 1 ? '' : 's');
  $('#download').disabled = $('#copy').disabled = commands === 0;
}

function filename() {
  const raw = $('#filename').value.trim() || 'startquests';
  // The console's `bat` argument is happiest with plain names.
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'startquests';
}

function download() {
  const { text } = generate();
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename() + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

document.addEventListener('DOMContentLoaded', () => {
  $('#select-none').addEventListener('click', () => { state.selected.clear(); update(); });
  $('#toggle-lines').addEventListener('click', () => {
    const details = document.querySelectorAll('#lines details.line');
    const anyOpen = Array.from(details).some(d => d.open);
    details.forEach(d => { d.open = !anyOpen; });
    updateToggleLines();
  });
  $('#pack-select').addEventListener('change', (e) => {
    const entry = manifest.packs.find(p => packKey(p) === e.target.value);
    if (!entry) return;
    history.replaceState(null, '', '?pack=' + packKey(entry));
    loadPack(entry);
  });
  $('#filter').addEventListener('input', (e) => { state.filter = e.target.value; applyFilter(); });
  $('#filter').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; state.filter = ''; applyFilter(); }
  });
  $('#comments').addEventListener('change', update);
  $('#download').addEventListener('click', download);
  $('#copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(generate().text);
    const btn = $('#copy');
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
  load();
});
