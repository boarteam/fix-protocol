---
'@boarteam/fix': patch
---

Close the `@param`/`@returns` documentation backlog and gate it.

Every exported function now documents all of its parameters and its return value — 51/51
parameters, up from 14 at the gate's introduction — and the doc-coverage gate enforces the
full tier: an exported symbol, member, parameter or return without TSDoc now fails the
package build. No report-only coverage remains.
