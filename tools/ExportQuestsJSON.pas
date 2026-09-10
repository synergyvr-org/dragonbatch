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
  stages, stage, entries: IInterface;
  i, j: integer;
  idx: integer;
  flags: string;
  bComplete, bFail: boolean;
  sStages: string;
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
      flags := GetElementEditValues(stage, 'INDX\Flags');
      bComplete := Pos('Complete Quest', flags) > 0;
      bFail := Pos('Fail Quest', flags) > 0;
      if sStages <> '' then sStages := sStages + ',';
      sStages := sStages + '{"i":' + IntToStr(idx)
        + ',"complete":' + LowerCase(BoolToStr(bComplete, true))
        + ',"fail":' + LowerCase(BoolToStr(bFail, true)) + '}';
    end;

  line := '{"edid":' + JsonStr(edid)
    + ',"formid":' + JsonStr(IntToHex(FixedFormID(e), 8))
    + ',"name":' + JsonStr(full)
    + ',"startGameEnabled":' + LowerCase(BoolToStr(GetElementEditValues(e, 'DNAM\Flags') <> '', true))
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
