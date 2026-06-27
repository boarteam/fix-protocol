---
'@boarteam/fix-dict-fix44': minor
'@boarteam/fix-dict-fix42': minor
---

Regenerate the dictionaries from permissively-licensed sources and re-source all descriptions under a license that permits redistribution.

- **FIX 4.4** is now generated from the QuickFIX `FIX44.xml` data dictionary (QuickFIX Software License). Its conditional-required (`C`) presence markings are restored from a prose-free facts overlay derived from the published FIX 4.4 specification.
- **Descriptions are re-sourced from the Apache-2.0 FIX Orchestra `orchestrations` project** (`OrchestraFIX44.xml` / `OrchestraFIX42.xml`) for both FIX 4.4 and FIX 4.2, replacing the previously-bundled specification prose. The runtime engine never read descriptions, so this is a data-only change with no behavioural impact on parse/validate/encode.
- **Breaking (data shape):** the FIX 4.4 dictionary now follows QuickFIX naming/factoring conventions — message names lose spacing (e.g. `MarketDataSnapshotFullRefresh`), a few fields are renamed (e.g. `IOIid` → `IOIID`), datatypes use their canonical FIX names, and components are factored more granularly (26 → 105). Decoded wire output is unchanged; the `Tags` / `MsgType` / component-name keys may differ, so pin and review on upgrade.
- `NOTICE` files updated with QuickFIX and FIX Orchestra (Apache-2.0) attribution and corrected provenance.
