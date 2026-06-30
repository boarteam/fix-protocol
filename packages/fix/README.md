# @boarteam/fix

A **dictionary-driven FIX protocol toolkit** for TypeScript — parse, validate, and encode
[FIX](https://www.fixtrading.org/) messages with **zero runtime dependencies**, in the browser
or Node. This is the engine; pair it with a dictionary such as
[`@boarteam/fix-dict-fix44`](https://www.npmjs.com/package/@boarteam/fix-dict-fix44).

On a 0.x line: the foundation is solid and well-tested, and the API may still refine ahead of
1.0. See the [project README](https://github.com/boarteam/fix-protocol#readme) for coverage,
testing, and the roadmap — [feedback](https://github.com/boarteam/fix-protocol/issues) welcome.

<!-- The GIF must use an absolute raw URL (npmjs.com does not resolve relative paths) pinned to
     the default branch. It 404s until `.github/demo.gif` exists on `main`, so do not publish a
     release pointing here before this lands on `main`. Source: .github/demo.tape. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/boarteam/fix-protocol/main/.github/demo.gif" width="900" alt="Terminal recording of @boarteam/fix: a raw FIX 4.4 log line is piped in and decoded in stages into named, typed fields with its repeating group expanded into nested Bid/Offer objects, validating clean; then a corrupted message is piped in and still parses without throwing, returning the bad float, wrong checksum, and invalid enum as structured diagnostics. The same pure engine runs in a browser tab or Node.">
</p>

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);
const { message, issues } = fix.parse(raw); // never throws; issues is FixIssue[]
const problems = fix.validate(message); // presence, enums, datatypes, conditional rules
const wire = fix.encode({
  msgType: 'D',
  fields: {
    /* ... */
  },
}); // ordered + framed
```

- **Stateless analyzer**, not a session/transport engine: no sockets, sequence numbers, or
  heartbeats — just the protocol.
- **Pure & deterministic**; **never throws** on the analyze path (diagnostics are returned
  data); **browser + Node** via `TextEncoder`/`TextDecoder`.

Full docs, examples, and the contribution guide are in the
[monorepo](https://github.com/boarteam/fix-protocol).

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE). "FIX" is a trademark of FIX
Protocol Limited; this is an independent project, not affiliated with or endorsed by it.
