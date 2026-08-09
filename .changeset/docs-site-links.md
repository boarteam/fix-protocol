---
'@boarteam/fix': patch
'@boarteam/fix-dict-fix44': patch
'@boarteam/fix-dict-fix42': patch
'@boarteam/fix-dict-fix50sp2': patch
'@boarteam/fix-dict-fixt11': patch
---

Point readers at the documentation site.

Every package now advertises <https://boar.team/fix/docs/> as its `homepage` (npm renders it as
the package's primary link) and opens its README with a docs / API-reference / playground row.
The engine README gains a section listing the six guides, the generated API reference, the issue-code
diagnostics catalogue and the browsable FIX dictionary reference; each dictionary README links the
reference view for its own dialect. Docs-only — no code, types, or dictionary data changed.
