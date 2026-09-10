{
  Dragonbatch quest exporter for xEdit (SSEEdit / TES5VREdit).

  Dumps every quest (QUST) record from the selected plugin(s) to JSON:
  editor ID, form ID, display name, and the quest's stage indices with their
  "complete quest" / "fail quest" flags. Feed the output to
  tools/dump_to_pack.py to start a Dragonbatch data pack.

  Usage:
    1. Load the plugin(s) you care about in xEdit (e.g. Skyrim.esm, or a
       quest mod's .esp).
    2. Select the plugin (or any subset of its records) in the tree.
    3. Apply Script -> pick this script.
    4. It writes one <PluginName>.quests.json per plugin, next to xEdit.

  Notes:
    - Quests with no display name (FULL) are exported too; the converter
      filters them by default, since nameless quests are almost always
      internal machinery, but the data is there if a mod does something odd.
    - "Start Game Enabled" and priority are included to help curation.
}
unit ExportQuestsJSON;

var
  slOut: TStringList;
  sPlugin: string;
  bFirst: boolean;

function JsonStr(s: string): string;
begin
  s := StringReplace(s, '\', '\\', [rfReplaceAll]);
  s := StringReplace(s, '"', '\"', [rfReplaceAll]);
  s := StringReplace(s, #13#10, '\n', [rfReplaceAll]);
  s := StringReplace(s, #13, '\n', [rfReplaceAll]);
  s := StringReplace(s, #10, '\n', [rfReplaceAll]);
  s := StringReplace(s, #9, '\t', [rfReplaceAll]);
  Result := '"' + s + '"';
end;

// JvInterpreter (xEdit's script engine) has no BoolToStr.
function JsonBool(b: boolean): string;
begin
  if b then Result := 'true' else Result := 'false';
end;

function Initialize: integer;
begin
  slOut := TStringList.Create;
  sPlugin := '';
  bFirst := true;
  Result := 0;
end;

procedure FlushPlugin;
var
  fname: string;
begin
  if (sPlugin = '') or (slOut.Count = 0) then Exit;
  slOut.Add(']}');
  fname := ProgramPath + sPlugin + '.quests.json';
  slOut.SaveToFile(fname);
  AddMessage('Dragonbatch: wrote ' + fname);
  slOut.Clear;
end;

function Process(e: IInterface): integer;
var
  plugin, edid, full, line: string;
  stages, stage, entries, entry, el, objs: IInterface;
  i, j, k: integer;
  idx, nFlags: integer;
  bComplete, bFail, bLog: boolean;
  sStages, sObjs: string;
begin
  Result := 0;
  if Signature(e) <> 'QUST' then Exit;

  plugin := GetFileName(GetFile(e));
  if plugin <> sPlugin then begin
    FlushPlugin;
    sPlugin := plugin;
    slOut.Add('{"schema":1,"plugin":' + JsonStr(plugin) + ',"quests":[');
    bFirst := true;
  end;

  edid := GetElementEditValues(e, 'EDID');
  full := GetElementEditValues(e, 'FULL');

  sStages := '';
  stages := ElementByPath(e, 'Stages');
  if Assigned(stages) then
    for i := 0 to ElementCount(stages) - 1 do begin
      stage := ElementByIndex(stages, i);
      idx := GetElementNativeValues(stage, 'INDX\Stage Index');
      // Complete/Fail live in each log entry's QSDT flags byte (bit 0 =
      // Complete Quest, bit 1 = Fail Quest). A stage is a *journal* stage
      // only if an entry has actual log text (CNAM); internal stages carry
      // textless entries too. Children are matched by name and the flags
      // read as native bits, because path/edit-value lookups have already
      // failed us twice here.
      bComplete := false;
      bFail := false;
      bLog := false;
      entries := ElementByPath(stage, 'Log Entries');
      if Assigned(entries) then
        for j := 0 to ElementCount(entries) - 1 do begin
          entry := ElementByIndex(entries, j);
          for k := 0 to ElementCount(entry) - 1 do begin
            el := ElementByIndex(entry, k);
            if Pos('QSDT', Name(el)) > 0 then begin
              nFlags := GetNativeValue(el);
              if (nFlags and 1) <> 0 then bComplete := true;
              if (nFlags and 2) <> 0 then bFail := true;
            end;
            if (Pos('CNAM', Name(el)) > 0) and (GetEditValue(el) <> '') then
              bLog := true;
          end;
        end;
      if sStages <> '' then sStages := sStages + ',';
      // "log": stage shows in the quest log (has an entry with text).
      sStages := sStages + '{"i":' + IntToStr(idx)
        + ',"complete":' + JsonBool(bComplete)
        + ',"fail":' + JsonBool(bFail)
        + ',"log":' + JsonBool(bLog) + '}';
    end;

  // Objective indices: by Bethesda convention these usually match the stage
  // index that displays them, so the converter can treat objective stages as
  // journal-visible even when they carry no log text.
  sObjs := '';
  objs := ElementByPath(e, 'Objectives');
  if Assigned(objs) then
    for i := 0 to ElementCount(objs) - 1 do begin
      entry := ElementByIndex(objs, i);
      for k := 0 to ElementCount(entry) - 1 do begin
        el := ElementByIndex(entry, k);
        if Pos('QOBJ', Name(el)) > 0 then begin
          if sObjs <> '' then sObjs := sObjs + ',';
          sObjs := sObjs + IntToStr(GetNativeValue(el));
        end;
      end;
    end;

  line := '{"edid":' + JsonStr(edid)
    + ',"formid":' + JsonStr(IntToHex(FixedFormID(e), 8))
    + ',"name":' + JsonStr(full)
    + ',"startGameEnabled":' + JsonBool(Pos('Start Game Enabled', GetElementEditValues(e, 'DNAM\Flags')) > 0)
    + ',"objectives":[' + sObjs + ']'
    + ',"stages":[' + sStages + ']}';

  if not bFirst then line := ',' + line;
  bFirst := false;
  slOut.Add(line);
end;

function Finalize: integer;
begin
  FlushPlugin;
  slOut.Free;
  Result := 0;
end;

end.
