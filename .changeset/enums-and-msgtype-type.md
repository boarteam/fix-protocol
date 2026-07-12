---
'@boarteam/fix-dict-fix44': minor
'@boarteam/fix-dict-fix42': minor
---

New enum exports: per-field consts/types, an `Enums` aggregate, and a same-name `MsgType` value-union type.

Every enumerated field is now a top-level export: a const map of spec value name → on-the-wire string plus a same-name value-union type (`Side.BUY === '1'` in FIX 4.4; `side: Side` works in type positions). Values are wire-verbatim strings even for int-typed fields, so they compare directly against tokenizer and parser output.

`Enums` aggregates the same maps by field name (`Enums.MDEntryType.BID === '0'` in FIX 4.4, `Enums.MDEntryType.Bid` in FIX 4.2), each entry referencing the top-level const — no data duplication; `EnumFieldName` is the union of enumerated field names. The one exception is the field `MsgType` (tag 35): its name belongs to the message-type map, so it gets no top-level const and stays reachable as `Enums.MsgType`. (The generator's reserved-name policy also defensively skips any field name that isn't a valid TS identifier.)

`MsgType` (the message-type map) is now also exported as a same-name type (const/type declaration merge): the union of wire values (`'A' | '0' | ...`), the value-side counterpart of `MsgTypeName`. Consumers can write `msgType: MsgType` in type positions, and a bare `export { MsgType }` re-export carries both the const and the type — the same holds for every per-field const.
