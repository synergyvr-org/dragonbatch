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
};

const $ = (sel) => document.querySelector(sel);

async function load() {
  const manifest = await (await fetch('data/manifest.json')).json();
  const entry = manifest.packs.find(p => p.default) || manifest.packs[0];
  state.pack = await (await fetch('data/' + entry.file)).json();
  $('#pack-title').textContent = state.pack.title;
  $('#source-note').textContent = state.pack.source.notes;
  render();
  update();
}

function questsOf(line) { return line.quests; }

function render() {
  const root = $('#lines');
  root.innerHTML = '';
  for (const line of state.pack.lines) {
    const details = document.createElement('details');
    details.className = 'line';
    details.addEventListener('toggle', updateToggleLines);

    const summary = document.createElement('summary');
    const lineBox = document.createElement('input');
    lineBox.type = 'checkbox';
    lineBox.setAttribute('aria-label', 'Select all of ' + line.title);
    lineBox.addEventListener('click', (e) => {
      e.stopPropagation();
      const targets = questsOf(line).filter(q => !q.optional);
      const allOn = targets.every(q => state.selected.has(q.edid));
      for (const q of targets) allOn ? state.selected.delete(q.edid) : state.selected.add(q.edid);
      update();
    });
    summary.appendChild(lineBox);
    const title = document.createElement('span');
    title.className = 'line-title';
    title.textContent = line.title;
    summary.appendChild(title);
    details.appendChild(summary);

    if (line.blurb) {
      const blurb = document.createElement('p');
      blurb.className = 'blurb';
      blurb.textContent = line.blurb;
      details.appendChild(blurb);
    }

    const list = document.createElement('ul');
    for (const quest of questsOf(line)) {
      const li = document.createElement('li');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'q-' + quest.edid;
      box.addEventListener('change', () => {
        box.checked ? state.selected.add(quest.edid) : state.selected.delete(quest.edid);
        update();
      });
      li.appendChild(box);

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'quest-name';
      name.title = 'Complete ' + line.title + ' through here';
      name.innerHTML = quest.name + ' <span class="edid">' + quest.edid + '</span>' +
        (quest.optional ? ' <span class="tag">optional</span>' : '');
      name.addEventListener('click', () => {
        // Through-here: this quest plus every earlier non-optional quest in
        // the line. Never touches optional quests other than this one, and
        // never *unchecks* anything, so fine-tuning survives.
        for (const q of questsOf(line)) {
          if (!q.optional) state.selected.add(q.edid);
          if (q.edid === quest.edid) { state.selected.add(q.edid); break; }
        }
        update();
      });
      li.appendChild(name);

      if (quest.note) {
        const note = document.createElement('p');
        note.className = 'note';
        note.textContent = quest.note;
        li.appendChild(note);
      }
      list.appendChild(li);
    }
    details.appendChild(list);
    root.appendChild(details);
  }
  updateToggleLines();
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
    let on = 0, required = 0, requiredOn = 0;
    for (const quest of questsOf(line)) {
      const box = document.getElementById('q-' + quest.edid);
      const has = state.selected.has(quest.edid);
      if (box) box.checked = has;
      if (has) on++;
      if (!quest.optional) { required++; if (has) requiredOn++; }
    }
    const lineBox = document.querySelector('#lines details:nth-child(' + (state.pack.lines.indexOf(line) + 1) + ') summary input');
    if (lineBox) {
      lineBox.checked = required > 0 && requiredOn === required;
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
