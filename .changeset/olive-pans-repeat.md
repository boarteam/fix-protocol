---
'@boarteam/fix': patch
---

Fix the inbound README snippets: `parse` needs a loaded dictionary.

The "Inbound messages" sections added in 0.6.0 showed `parse(raw, dictionary)` passing the
dict package's `dictionary` export directly. That export is a `DictionaryJSON`, and `parse`
takes `Dictionary | FixtDictionaries` — so the snippet as printed did not compile. Both
READMEs now load it first (`loadDictionary(fix44)`), which is also the form the rest of the
free-function path uses.

Worth knowing, since it is what made the mistake easy: `toInbound`, `inboundKnownGuard`,
`createMessage` and `createFixEngine` all accept `Dictionary | DictionaryJSON`, while
`parse`, `parseAll`, `encode` and `validate` require a loaded `Dictionary`.

Docs only — no API or behaviour change.
