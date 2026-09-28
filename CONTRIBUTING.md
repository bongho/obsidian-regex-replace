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
only a human remembers to run. `test.js` is a stale duplicate; treat it as a
leftover.

The thing to know about `test.ts` is that it **copies** the logic it tests out
of `src/` instead of importing it — seven functions as of 1.2.1. A green run
proves the copy correct, not the shipped code, and nothing enforces that the two
stay in step. It also has no imports at all, which is what lets `ts-node` run it
under `"module": "ESNext"` without a loader; adding one would break `npm test`.

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
