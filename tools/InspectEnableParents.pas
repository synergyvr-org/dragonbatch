{
  Dragonbatch enable-parent inspector for xEdit (SSEEdit / TES5VREdit).

  For each target reference, prints the record, whether it is persistent,
  and its XESP enable-parent chain with each parent's persistence. Use it to
  decide whether a batch-file "prid + disable" fixup can work from anywhere
  (persistent target) or only with the cell loaded (non-persistent).

  Usage:
    1. Load ONLY Skyrim.esm, so that load-order IDs equal file-local IDs.
       For DLC targets, load that plugin alone instead and adjust the IDs.
    2. Edit the targets list in Initialize below.
    3. Apply Script to anything; output lands in the messages pane.
       The script does its work in Initialize and touches no records.
}
unit InspectEnableParents;

function YesNo(b: boolean): string;
begin
  if b then Result := 'YES' else Result := 'no';
end;

procedure Inspect(f: IInterface; id: cardinal);
var
  rec, xesp, refEl, parent: IInterface;
  depth: integer;
begin
  rec := RecordByFormID(f, id, true);
  if not Assigned(rec) then begin
    AddMessage('  NOT FOUND: ' + IntToHex(id, 8));
    Exit;
  end;
  AddMessage('target: ' + Name(rec));
  AddMessage('  persistent: ' + YesNo(GetIsPersistent(rec)));
  depth := 0;
  while depth < 10 do begin
    xesp := ElementByPath(rec, 'XESP');
    if not Assigned(xesp) then begin
      AddMessage('  no enable parent above this point');
      Exit;
    end;
    refEl := ElementByPath(xesp, 'Reference');
    parent := LinksTo(refEl);
    if not Assigned(parent) then begin
      AddMessage('  XESP present but parent did not resolve');
      Exit;
    end;
    AddMessage('  enable parent: ' + Name(parent));
    AddMessage('    persistent: ' + YesNo(GetIsPersistent(parent)));
    rec := parent;
    depth := depth + 1;
  end;
  AddMessage('  stopped: parent chain deeper than 10');
end;

function Initialize: integer;
var
  f: IInterface;
  i: integer;
begin
  f := nil;
  for i := 0 to FileCount - 1 do
    if GetFileName(FileByIndex(i)) = 'Skyrim.esm' then
      f := FileByIndex(i);
  if not Assigned(f) then begin
    AddMessage('Skyrim.esm is not loaded.');
    Result := 1;
    Exit;
  end;

  // Targets: file-local form IDs in Skyrim.esm. Edit freely.
  Inspect(f, $000E1533); // MGEyeBarrierLarge (College outer barrier)
  Inspect(f, $000F0EA9); // MGEyeBarrierSmall (inner barrier)

  Result := 1; // nonzero: skip Process entirely, work is done
end;

end.
