# Contributing

## CI

`.github/workflows/lint.yml` (added 2026-08-23, #6) runs on every push and pull
request, across Node 20 / 22 / 24: `npm ci` → `build` → `lint --if-present` →
`test --if-present`.

`build` is the only script this repo defines today. The other two are guarded so
that adding either later needs no workflow change.

## Known gaps

Each of these is missing on purpose, not by oversight. The reasoning is here so
it doesn't have to be re-derived — or "fixed" in a way that reintroduces the
problem it was avoiding.

**No `lint` script, and `eslint` is not a dependency.** `.eslintrc` exists and is
a complete config, but in the legacy (non-flat) format, and only
`@typescript-eslint/eslint-plugin` + `parser` are installed — not `eslint`
itself. There are two ways forward and they are not equivalent:

- Cheap: `npm i -D eslint@8` plus a `lint` script. This works with the packages
  already here — `@typescript-eslint@5.29.0` declares
  `peerDependencies.eslint: ^6.0.0 || ^7.0.0 || ^8.0.0`, so eslint 8 is the only
  major it accepts, and legacy `.eslintrc` is native there.
- Current-generation: bump to `typescript-eslint` 8 and eslint 10, which means
  migrating `.eslintrc` to flat config.

The catch with the cheap path is that it newly adopts an unmaintained major:
eslint's dist-tags are `latest: 10.9.0` and `maintenance: 9.39.5`, so 8.x is
outside both. The sibling plugin (`obsidian-book-metasearch`) runs eslint 10.8.1
with `typescript-eslint` 8.67. Pick deliberately; don't assume the cheap path is
free.

**No test runner.** No Vitest/Jest setup, no `test` script. The `test.js` and
`test.ts` files in the repo root predate this and are referenced by nothing — no
runner, no script. Treat them as leftovers rather than a partial suite.

**No `dependabot.yml`.** devDependencies are roughly six majors behind
(`typescript` 4.7.4, `esbuild` 0.17.3, `@typescript-eslint` 5.29, `@types/node`
^16, `tslib` 2.4.0). Enabling Dependabot cold opens that whole batch at once. Do
a manual catch-up first, then decide grouping, then switch it on.

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
