{
  Dragonbatch reference exporter for xEdit (SSEEdit / TES5VREdit).

  Dumps shouts, words of power, spells, and item records from the selected
  plugin(s) to JSON: editor ID, file-local form ID, display name, and for
  shouts the three word-of-power form IDs. This is the lookup table that lets
  pack curation express grants as editor IDs, e.g. teachShout =
  "UnrelentingForceShout", while the converter resolves the console-command
  form IDs. Nothing is ever hand-typed.
  (No curly braces may appear in this comment: Pascal brace comments do not
  nest, so a brace in a JSON example ends the comment mid-sentence.)

  Usage:
    1. Load the plugin(s) in xEdit (e.g. Skyrim.esm and the DLC masters).
    2. Select the plugin(s) in the tree.
    3. Apply Script -> pick this script.
    4. It writes one <PluginName>.refs.json per plugin, next to xEdit.

  Notes:
    - Form IDs are exported file-local (low six digits). The consumer maps
      each plugin to its load-order slot (Skyrim 00, Update 01, Dawnguard 02,
      HearthFires 03, Dragonborn 04 in the standard order) when emitting
      console commands.
    - Everything with a matching signature is exported, named or not; the
      converter only resolves what a curation overlay actually references.
}
unit ExportRefsJSON;

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

function WantedSig(sig: string): boolean;
begin
  Result := (sig = 'SHOU') or (sig = 'WOOP') or (sig = 'SPEL')
    or (sig = 'WEAP') or (sig = 'ARMO') or (sig = 'AMMO')
    or (sig = 'MISC') or (sig = 'BOOK') or (sig = 'KEYM');
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
  fname := ProgramPath + sPlugin + '.refs.json';
  slOut.SaveToFile(fname);
  AddMessage('Dragonbatch: wrote ' + fname);
  slOut.Clear;
end;

function Process(e: IInterface): integer;
var
  plugin, sig, line, sWords: string;
  words, entry, el: IInterface;
  i, k: integer;
begin
  Result := 0;
  sig := Signature(e);
  if not WantedSig(sig) then Exit;

  plugin := GetFileName(GetFile(e));
  if plugin <> sPlugin then begin
    FlushPlugin;
    sPlugin := plugin;
    slOut.Add('{"schema":1,"plugin":' + JsonStr(plugin) + ',"refs":[');
    bFirst := true;
  end;

  line := '{"sig":"' + sig + '"'
    + ',"edid":' + JsonStr(GetElementEditValues(e, 'EDID'))
    + ',"formid":"' + IntToHex(FixedFormID(e) and $FFFFFF, 6) + '"'
    + ',"name":' + JsonStr(GetElementEditValues(e, 'FULL'));

  // A shout carries its three words of power; export their form IDs so the
  // converter can emit one player.teachword per word. Children are matched
  // by name and read as native values; path lookups have burned us before.
  if sig = 'SHOU' then begin
    sWords := '';
    words := ElementByPath(e, 'Words of Power');
    if Assigned(words) then
      for i := 0 to ElementCount(words) - 1 do begin
        entry := ElementByIndex(words, i);
        for k := 0 to ElementCount(entry) - 1 do begin
          el := ElementByIndex(entry, k);
          if Pos('Word', Name(el)) = 1 then begin
            if sWords <> '' then sWords := sWords + ',';
            sWords := sWords + '"' + IntToHex(GetNativeValue(el) and $FFFFFF, 6) + '"';
          end;
        end;
      end;
    line := line + ',"words":[' + sWords + ']';
  end;

  line := line + '}';
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
