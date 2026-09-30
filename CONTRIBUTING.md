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

## Why vault replace runs on mobile

It did not, in 1.2.2. The guard came off in 1.3.0 and this is the whole of the
reasoning, kept because "why is this allowed on a phone" is a fair question to
ask later and an expensive one to re-derive.

The protection against a runaway pattern is a worker the main thread can
terminate — a backtracking regex cannot be interrupted on the thread running
it. Through 1.2.2 that path had only ever run on desktop. Worker construction
failing was handled and verified by stubbing `Worker` (both a throwing
constructor and one that never answers settle with a notice), but a mobile
WebView where the worker *does* start and the watchdog behaves differently was
untested, and the failure mode there is a hung app. So `main.ts` registered
the two vault commands behind `!Platform.isMobile` while `isDesktopOnly`
stayed `false`, keeping the rest of the plugin working on mobile.

Lifting it was supposed to need a device. Four questions had to come back
right, and this is how far each got without one:

1. Does `new Worker(URL.createObjectURL(blob))` construct at all? A mobile
   WebView may refuse a `blob:` worker outright. If it does, the handshake
   watchdog already turns that into a notice, which is a pass, not a failure.
2. Does the handshake complete, i.e. does `ready` come back? A worker that
   constructs but never runs is exactly what that watchdog exists for.
3. What happens when the app is backgrounded mid-scan? This is the question
   that actually decides it, and it is less obvious than it looks. A
   backgrounded `WKWebView` is documented to suspend JavaScript execution
   outright, not merely throttle it, so the watchdog `setTimeout` does not
   fire — but if the suspension covers the worker too, the runaway regex is
   suspended along with it and nothing is actually hung. The pass condition is
   therefore not "the watchdog fires on time" but "coming back to the
   foreground resumes the scan and the watchdog still arrives". Check for the
   asymmetric case specifically: the worker kept running while the timer did
   not. Reports of backgrounded `WKWebView` continuing to execute JavaScript
   from iOS 13.5.1 onward mean this is version-dependent, so it cannot be
   settled by reading; it has to be run.
4. Does `terminate()` stop a worker already inside a backtracking regex? Run
   something like `(a+)+$` against a long line of `a`s and check that the app
   stays responsive and the run ends in the notice rather than a spinner.

None of the four was answered on a device. Three were answered anyway, and
the fourth turned out to be the wrong question.

Three of these have a desktop answer now, measured against an isolated
instance running under `app.emulateMobile(true)`:

- **The guard does what it claims.** With `app.isMobile` true,
  `regex-replace:replace-in-vault` and `:undo-last-vault-replace` are absent
  from `app.commands.commands` while the three editor commands stay registered.
  That had never actually been run before.
- **`terminate()` does stop a backtracking worker.** A blob worker fed `(a+)+$`
  against 40 `a`s held one core at 100% for 57s and never replied; the
  `terminate()` call returned in 0ms and the renderer settled to 0% and stayed
  there. Driving the same pattern through the modal, the watchdog fired at
  exactly 2000ms with "Matching stopped after 2000ms at ...", and the message
  lands in the metrics line rather than as a `Notice`.
- **Suspending the page does not produce the asymmetric case.** Driving
  `Page.setWebLifecycleState` to `frozen` mid-scan took the renderer from 93%
  of a core to 0% — the worker stops with the timers, not despite them. A
  250ms interval armed before the freeze had run 16 times going in and still
  read 16 coming out. Thawing after ~25s of wall time, the watchdog fired
  about 1.5s later: the 2000ms timer had 1500ms left when the freeze hit and
  resumed with exactly that much to go. Note that `performance.now()` kept
  advancing across the freeze while `setTimeout` did not, so elapsed time is
  not what the watchdog is counting.

None of this transfers to a mobile WebView on its own — same worker spec,
different engine, different scheduler, and `frozen` is Chromium's lifecycle
state rather than what iOS does to a backgrounded app. What it changes is the
shape of the remaining work: all four questions now ask whether mobile
*differs* from a desktop path that has been measured, not whether the path
works at all.

It also splits the remaining risk by engine, which saying "mobile" was hiding.
The asymmetry needs a platform that keeps worker threads scheduled while
stopping the page's timers outright. That is not a hypothetical API.

**Android has the mechanism, but Obsidian does not appear to reach it.** The
API to worry about is `WebView.pauseTimers()`. Chromium implements it as
`RenderThreadImpl::SetWebKitSharedTimersSuspended`, whose entire body is
`main_thread_scheduler_->PauseTimersForAndroidWebView()` — the main thread's
scheduler, and workers run on their own. So the asymmetry is real and named:
a host calling `pauseTimers()` from `onStop` puts the watchdog to sleep and
leaves the worker burning.

Obsidian's own APK says it does not. Reading the method tables and code of
`Obsidian-1.13.8.apk`, the call chain is present but unreached:
`WebView.pauseTimers` is invoked only from
`MockCordovaWebViewImpl.setPaused`, which is invoked only from that class's
own `handlePause`/`handleResume`, which nothing invokes. Capacitor's own
lifecycle path agrees: `BridgeActivity.onPause`/`onStop` go to `Bridge`,
which never mentions `pauseTimers`. Control for the method: `WebView.loadUrl`
and `evaluateJavascript` come back with five callers each in the same pass,
so a zero here is a real zero and not a broken parser. A reflective call
would need the method name as a string constant, and none of `pauseTimers`,
`setPaused`, `handlePause` or `handleResume` is loaded by a `const-string`
anywhere in either dex — while the control string
`android.intent.action.VIEW` turns up at eight sites, and its being in plain
text at all rules out string encryption hiding the others.

Blink's own source closes the loop and explains both measurements above.
`DedicatedWorker::ContextLifecycleStateChanged` switches on the frame's
lifecycle state: `kFrozen` forwards a `Freeze` to the worker, which is why
freezing the page took the renderer to 0%, while `kPaused` is commented
"Do not do anything in this case. kPaused is only used for when the main
thread is paused we shouldn't worry about pausing the worker thread". That
comment is the asymmetry, stated by the engine. It is reachable through
pausing, not through freezing — and backgrounding an app freezes.

**iOS looks like the safer side**, despite being the different engine. Reports
have `WKWebView` continuing to execute JavaScript for roughly 30s after
backgrounding, until the WebKit `ProcessAssertion` expires — timers included,
so the watchdog runs normally in that window — and after it the WebContent
process is suspended, or killed outright under memory pressure, which takes
the worker with it either way.

So the guard came off in 1.3.0, resting on a negative from static analysis, a
positive from a desktop engine, and an engine comment that says which branch
the danger is on. That is weaker than a device run and a great deal stronger
than what it had in 1.2.2, which was nothing.

If someone does get a device, the run is still worth doing and it is quick:
start a scan with a runaway pattern, background the app for a minute, come
back, and check both whether the watchdog message is waiting and whether the
phone got warm while it was away. The second half is the actual measurement —
the message can arrive late and still mean the worker ran the whole time. A
warm phone is the result that should put the guard back.
