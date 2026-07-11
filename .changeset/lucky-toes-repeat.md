---
'@boarteam/fix-dict-fix44': minor
'@boarteam/fix-dict-fix42': minor
---

Add `TagNames` and `MsgTypeNames` reverse lookup maps: tag number → field name and MsgType value → message name, derived from the generated `Tags`/`MsgType` maps. Useful for log lines and session-level Reject construction without loading the full dictionary.
