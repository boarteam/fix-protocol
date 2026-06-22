# Security Policy

## Supported versions

`@boarteam/fix` is in early (0.x) development. Security fixes are applied to the latest
`0.x` release line. There is no long-term-support branch yet.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report privately via
[GitHub Security Advisories](https://github.com/boarteam/fix-protocol/security/advisories/new)
(Security → Report a vulnerability). If that is unavailable to you, contact the maintainers at
**balakirev.andrey@gmail.com** with the details below.

Please include:

- the affected package and version,
- a minimal reproduction (a FIX message and the call you made) — **redact real credentials,
  comp-IDs, and venue identifiers**,
- the impact you observed.

We aim to acknowledge reports within a few business days and will coordinate a fix and
disclosure timeline with you.

## Threat model

This library is a **stateless analyzer** designed to process **untrusted input** (pasted
messages and logs). Its security-relevant guarantees are:

- **The parse and validate paths never throw, hang, or crash on malformed input** — all
  problems are returned as `FixIssue[]` data. This is exercised by an adversarial/fuzz suite
  (truncation, corruption, reordering, bad checksums, oversized group counters, junk tags,
  random bytes). A crash, infinite loop, unbounded memory growth, or uncaught exception on
  any byte input is considered a security bug.
- **No code execution, filesystem, or network access** from the engine. The published
  packages are zero-dependency and contain no `net`/`crypto`/`Buffer`/`@nestjs`/`joi` — a CI
  bundle check enforces this, so a dependency that introduced such access would fail the build.

Out of scope: anything in the session/transport layer (this project has none), and the
correctness of business decisions made from a parsed message.
