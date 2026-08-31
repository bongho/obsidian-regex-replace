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

**No test runner.** No Vitest/Jest setup, no `test` script. The `test.js` and
`test.ts` files in the repo root predate this and are referenced by nothing — no
runner, no script. Treat them as leftovers rather than a partial suite.

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
