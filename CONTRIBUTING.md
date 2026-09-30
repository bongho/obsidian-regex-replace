# Contributing

## CI

`.github/workflows/lint.yml` (added 2026-08-23, #6) runs on every push and pull
request, across Node 20 / 22 / 24: `npm ci` → `build` → `lint --if-present` →
`test --if-present`.

`build` and `lint` are defined; `test` is not, and stays guarded so that adding
it later needs no workflow change.

## Linting

`npm run lint` runs the same ruleset the Obsidian plugin review runs, via
`eslint-plugin-obsidianmd`. Run it before cutting a release. The review reports
`obsidianmd/*` findings against a published release, and a release check that
fails cannot be re-run — clearing it costs a new version, so catching these
locally is the whole point.

Config lives in `eslint.config.mjs` (flat config, eslint 10 +
`typescript-eslint` 8). Build scripts and `test.ts` are exempted from the
mobile-safety and console rules: they are not shipped to users.

One rule to know about is `obsidianmd/no-unsupported-api`, which reads
`manifest.json`'s `minAppVersion` and reports every API newer than it, using the
`@since` tags in `obsidian.d.ts`. Lowering `minAppVersion` is therefore not a
free compatibility win — it makes every newer API an error.

## Known gaps

Each of these is missing on purpose, not by oversight. The reasoning is here so
it doesn't have to be re-derived — or "fixed" in a way that reintroduces the
problem it was avoiding.

**No test framework.** No Vitest/Jest — `test.ts` is a hand-rolled harness with
its own `test()` and `assertEqual()`. It does now run: `npm test` is defined and
CI's `test --if-present` step executes it, so the suite is no longer something
only a human remembers to run.

`test.ts` still **copies** the logic it tests out of `src/` instead of importing
it — 17 functions as of 1.2.2. It has no imports at all, which is what lets
`ts-node` run it under `"module": "ESNext"` without a loader; adding one would
break `npm test`, so the copying stays.

What no longer stays is the silence around it. `npm test` now runs
`check-test-copies.mjs` first, which parses both sides with the TypeScript AST
and fails the run when a copy's body no longer matches its original. Copies are
discovered rather than listed — any top-level function or class method in
`test.ts` whose name also exists in `src/` or `main.ts` is compared — so adding
one needs no change to the checker. Signatures are out of scope, since `test.ts`
cannot name the types it would have to import; a renamed or reordered parameter
that the body never reads is the one thing that still slips through.

It was not a hypothetical gap. When the check was first run, `RegexEngine.preview`
and `RegexEngine.execute` in `test.ts` were still the pre-`processReplacement`
versions: the copy re-ran the regex on the matched substring, which is precisely
the bug `collectMatches` was written to fix, and it never applied the `\n` / `\t`
/ `\r` unescaping that the shipped code does. Both behaviours had no test at
all. They have one each now.

**Vault replace is desktop-only, and that is a gap, not a design.** The whole
protection against a runaway pattern is a worker the main thread can terminate —
a backtracking regex cannot be interrupted on the thread running it. That path
has only ever run on desktop. Worker construction failing is handled (verified by
stubbing `Worker`: both a throwing constructor and one that never answers settle
with a notice), but a mobile WebView where the worker *does* start and the
watchdog behaves differently is untested, and the failure mode there is a hung
app. So `main.ts` registers the two vault commands behind `!Platform.isMobile`.
`isDesktopOnly` stays `false` so everything else keeps working on mobile. Lift
the guard once the worker is confirmed on a real device.

Confirming it needs a build with the guard removed, side-loaded under a
different plugin id so it cannot overwrite the installed copy, and four
questions answered on the device itself:

1. Does `new Worker(URL.createObjectURL(blob))` construct at all? A mobile
   WebView may refuse a `blob:` worker outright. If it does, the handshake
   watchdog already turns that into a notice, which is a pass, not a failure.
2. Does the handshake complete, i.e. does `ready` come back? A worker that
   constructs but never runs is exactly what that watchdog exists for.
3. Does the watchdog still fire when the app is backgrounded mid-scan? This is
   the question that actually decides it. `window.setTimeout` is throttled or
   suspended in a backgrounded mobile WebView, and that timeout is the entire
   protection: if it never arrives, nothing calls `terminate()`.
4. Does `terminate()` stop a worker already inside a backtracking regex? Run
   something like `(a+)+$` against a long line of `a`s and check that the app
   stays responsive and the run ends in the notice rather than a spinner.

Answer 3 and 4 yes on a real device and the guard is one line to remove.

**No `dependabot.yml`.** The lint toolchain was brought current on 2026-09-01
(eslint 10, `typescript-eslint` 8, `typescript` 5.9 — the last of which required
`tsconfig.json` `target` to move to `ES2018`, since TypeScript 5 checks regex
flags against `target` and `engine.ts` uses `/s`). Still behind: `esbuild`
0.17.3, `@types/node` ^16, `tslib` 2.4.0. Enabling Dependabot cold opens that
batch at once. Do a manual catch-up first, then decide grouping, then switch it
on.

When that happens, carry over one thing the sibling repo learned the hard way:
**Dependabot assigns a dependency to a group by specificity, not by declaration
order**, and it ranks `dependency-type` above `patterns`. A narrow
patterns-based group listed first does *not* keep its packages out of a broader
dev-dependency group — that needs an explicit `exclude-patterns` on the broader
one. Getting this wrong split a peer-pinned pair across two PRs and failed
`npm ci` with `ERESOLVE` every week until it was fixed.

**No `release.yml`.** The sibling's release workflow extracts its notes from a
`## [x.y.z]` section in `CHANGELOG.md`, and this repo has no changelog.
Everything through 1.1.4 shipped from a local build. If a changelog is added,
start it at the next release — backfilling entries for versions already shipped
is busywork.

**No branch protection.** Worth enabling once the three `build` jobs have a
track record, not in the same change that introduced them.

## Releasing

Manual, for now: bump the version, `npm run build`, and attach `main.js`,
`manifest.json`, and `styles.css` to a GitHub release. `npm version <x.y.z>`
runs `version-bump.mjs`, which syncs `manifest.json` and `versions.json` from
`package.json`. Tags in this repo carry no `v` prefix.

This machine's default `gh` account is not this repo's owner, and git's
credential helper follows whichever account `gh` has active — so `git push`,
`gh pr merge`, and `gh release create` all fail with 403 until
`gh auth switch -u bongho`. Check `gh auth status` before pushing rather than
after the rejection, and switch back only once no git operations are left.

**The community list entry cannot be updated, and does not need to be.**
`obsidianmd/obsidian-releases` has issues and pull requests disabled at the repo
level — even an unauthenticated read of its `/pulls` API returns 404 — so there
is no PR to open. Its `community-plugins.json` entry was copied from
`manifest.json` when the plugin was admitted and has not tracked it since; ours
still carries a description that predates 1.1.4. That entry's `name`, `author`
and `description` feed **search** only. Opening a plugin's detail page pulls
`manifest.json` and `README.md` live from this repo, so the description users
actually read is the one in `manifest.json` — keep that current, and treat a
stale list entry as lost search matches rather than lost visibility.
