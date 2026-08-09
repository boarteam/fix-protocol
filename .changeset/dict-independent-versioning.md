---
'@boarteam/fix-dict-fix44': patch
'@boarteam/fix-dict-fix42': patch
'@boarteam/fix-dict-fix50sp2': patch
'@boarteam/fix-dict-fixt11': patch
---

Stop the dictionaries from taking a major bump on every engine release.

Each dictionary declared `@boarteam/fix` as `workspace:^`, published as `^0.5.0` — a range that
in 0.x admits patches only. Every engine minor therefore left it, and Changesets bumps a peer
dependent whose range is left to **major**, so the dictionaries climbed a major per engine
release (`fix44` reached 4.0.0 against an engine at 0.5.0) carrying nothing but an "Updated
dependencies" line.

The peer range now spans the whole pre-1.0 engine line — `">=0.5.0 <1.0.0"` — so an engine
release stays inside it, and `onlyUpdatePeerDependentsWhenOutOfRange` limits the forced major to
peers whose range a new version actually leaves. From here each dictionary versions on its own
changes: a regenerated dictionary, a new export, a corrected field — or an engine change that
genuinely breaks it, which gets its own changeset. Published data, types, and exports are
unchanged; the only difference in the tarball is the wider peer range.
