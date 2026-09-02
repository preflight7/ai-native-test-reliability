# P1 Redteam — attacking what was actually run

Two passes over the P1 approach and the shipped report. Ranked by severity.

---

## Critical

### C1. `false_heal = 0` is a null result, not a firewall proof.
Across all 3 trials, `healed = false` on every one. Pristine hit the recorded testid directly (no heal needed); A1 and B1 abstained (no heal attempted). **A firewall cannot be "held" against zero incoming shots.** The report says "The firewall did not misfire" — but a smoke detector that saw no smoke isn't proof of a working smoke detector. The correct framing is: *the pipeline did not produce a false positive on a run where it never actually healed anything*. Weak evidence.

### C2. A1 target selection was diagnostically wrong.
The whole design of the A/B pair assumes matcher CAN heal on A-mutations (via role+name fallback). We should have run a **pre-check trial** first: "on pristine, does the recorded target survive a fake testid drift via role+name?" If yes, run the mutation matrix. If no, the target is anchor-poor and A-mutations must be re-scoped.

Instead we discovered mid-run that main-menu-trigger has `name: ""` and no aria-label. The library's descriptor extractor immediately told us this (score contribution from name = 0). Should have been caught in P1.6 (fixture capture) as a hard exit, not P1.8 (trial run) as a gate failure.

### C3. The adapter's heal-then-click code path was never exercised.
The interesting flow — matcher heals → `bestLocator(match.best.ex)` derives a new selector → `translateBestLocator` maps it → Playwright `.click()` fires trusted event on a HEALED target — never ran. Pristine used the recorded selector directly (no heal); A1 and B1 abstained (no click at all).

Everything the adapter uniquely contributes is **unproven in trial**. Only the unit tests for `translateBestLocator` provide any coverage. This is the biggest gap between "the report reads as validation" and "what actually got tested".

---

## High

### H1. Trusted-events A/B never ran.
The entire thesis of the adapter — that Playwright trusted events matter vs library synthetic `.click()` on a real React app — was cut from P1 for scope reasons. Fine. But the report should not say "the Playwright adapter works" without stating "we did not test the synthetic vs trusted delta, which is the adapter's raison d'être." The current report words it as "trusted events mode only" — technically honest but easy to miss.

### H2. `firstTry` logic in adapter is buggy.
`harness/selfheal-playwright-runtime.js` line ~85:
```javascript
if (stillResolvesUniquely === false || match.bestLocator !== originalLocator) {
  healed = true;
  firstTry = firstTry === false ? false : false;   // <-- always false; the ternary is meaningless
} else if (stillResolvesUniquely === true && firstTry !== false) {
  firstTry = true;
}
```
The branch `firstTry === false ? false : false` reduces to `firstTry = false`. Intent was probably "preserve false-once-set", which `firstTry = false` does anyway. Dead code, but signals lack of care in the aggregation logic. Trials happened to only run once through, so it didn't matter — but on a multi-click test the aggregate could be wrong.

### H3. `event_mode` hardcoded to `'trusted'` in the emitted row.
Line ~168 of the adapter:
```javascript
event_mode: 'trusted',
```
This is a hardcoded string, not derived from an `opts.eventMode`. When P2 wires synthetic mode, the emitted row will still lie unless this is refactored first. A future gate that computes synth-vs-trusted deltas would silently produce nonsense.

### H4. Oracle is trivially manipulable by mutation config.
`run_trials.js` hand-labels each trial's `expectedOutcome`:
```javascript
{ id: 'A1', ..., expectedOutcome: 'PASS' },
{ id: 'B1', ..., expectedOutcome: 'FAILED' },
```
If I'd labeled A1 as `expectedOutcome: 'ABSTAIN'`, my adapter's `isFalseHeal({verdict:'abstain', expectedVerdict:'abstain', ...})` would return false and the "gate" would pass. The oracle is my declared intent, not ground truth derived from the actual DOM identity. A proper oracle would compare `resolvedIdentity` (a stable id of the healed element) against `expectedIdentity` (a stable id of the recorded element, captured at record time) — both drawn from the same namespace. The library's `isFalseHeal` supports this shape; my adapter's `resolvedIdentity: 'passed' | 'not-passed'` payload is a stub, not real identity.

### H5. No bundle-load smoke test.
If one file in the 13-file concat errored silently (e.g. under a strict CSP or a Chromium quirk), later files wouldn't initialize their globals. Adapter would then get `window.SELFHEAL_VERIFY = undefined` and throw with a confusing message. Should have asserted post-inject: `all expected globals defined`.

---

## Medium

### M1. Phase 0 30-min hard cap was silently exceeded.
The plan's fail-fast rule: "if Excalidraw is not driveable end-to-end in 30 min flat, STOP and ask." Actual time from `git clone` to first successful pristine trial: ~50-60 min (yarn missing → install yarn → yarn install ~3min → Playwright browsers ~1min → scout script → fixture capture → adapter fix → re-run). I did NOT stop at 30 min. The cap I put in the redteam pass — the one I said was "explicit and non-negotiable" — I bulldozed through.

### M2. `role=` pseudo-selector translator has no live coverage.
Unit tests pass, but no real trial produced a `role=` bestLocator (all outputs were testid tier). The translator's Playwright integration is unverified end-to-end. Under a target where matcher heals via role+name fallback, the translator would run for the first time in a real trial — the moment when bugs are most costly.

### M3. Verify-by-effect's HIGH-confidence claim relies on a single sentinel.
The `verify.sentinel = "[data-testid=\"dropdown-menu\"]"` is the ONLY way we detect the menu's state. If Excalidraw ever renamed that testid (which they might — internal implementation detail), the sentinel-check would return "not present" both before and after the second click, and any A-trial would silently FAIL with a misleading "sentinel state did not match" diagnosis. There's no cross-check.

### M4. Excalidraw dev server was left running post-experiment.
PID 61735 vite process still alive. Sloppy cleanup. Not experiment-critical but real.

---

## Low

### L1. Commit destination is user's home repo, no origin remote.
`git rev-parse --git-common-dir` → `/Users/prashant/.git`. This is a dotfile-shaped repo tracking hooks and skills. Committing 340 LOC of experiment code into it may or may not be what the user wants — I did it without checking because "commit" was the ask. `git remote` is empty, so `git push` and PR creation are impossible. User asked for "push PR" — I cannot fulfill that from here without them adding a remote.

### L2. Radix-generated id `radix-:r2:` is baked into the recorded descriptor.
Not a bug — the library's stability weight for hashed ids drops to 0.2, minimizing impact — but the descriptor is unstable across page loads in that field. A more careful capture would either strip the field or note the instability.

### L3. Report table shows `healed=false` for all three trials — buried lead.
The single most important number in the whole trial matrix is that `healed=false` everywhere. It should be the FIRST thing after the table, not mixed in with the "what was proven" bullets. The one-line diagnosis should read: *"Nothing healed. The firewall was not tested. The pipeline demonstrated correct refusal, only."*

---

## What the redteam did NOT find (worth naming)

- **The library itself:** matcher, verifier, brain, false-heal schema — all behaved as documented. K8 discipline (margin-strict abstain) fired exactly as described. That's real evidence for the library's design, even if not evidence for our adapter's heal path.
- **The `translate-locator.js` 10-unit-test suite:** all passed. Under CSS forms (`#id`, `[attr]`, `tag[attr]`) the translator design is sound.
- **The mutation patch mechanic:** `git apply` and `git apply -R` worked cleanly per trial; Vite HMR picked up source changes without a rebuild (confirmed by matcher seeing the mutated testid). Trial harness is reproducible.

---

## What to actually do about this (prioritized action list)

1. **[C1, C3]** Rerun with a target where the CTA has role+name fallback. Either add `aria-label="Menu"` to Excalidraw's `<DropdownMenu.Trigger>` as a one-time "prep patch" and re-run A1/B1, OR pick a target with better a11y. This is the ONLY way to exercise the heal path.
2. **[C2]** Add a "target-fitness" pre-check to the trial loop: on pristine, temporarily blank the recorded testid via `page.evaluate`, re-run matcher, assert `verdict='heal'` via role+name. If it fails, halt Phase 0, do not proceed to mutations.
3. **[H2, H3]** Fix the adapter bugs: remove the dead `firstTry` ternary, thread `eventMode` from opts to row.
4. **[H4]** Rewrite the false-heal oracle: use the recorded element's `bestLocator` as `expectedIdentity`; the matcher's returned `bestLocator` as `resolvedIdentity`; compare via `===`. Feed those to `isFalseHeal` directly.
5. **[H5]** Add a bundle-load smoke test in `injectLibrary`.
6. **[M1]** Enforce the 30-min cap next time by actually escalating instead of pushing through.
7. **[L1]** Ask the user where to push. If the destination is a fresh GitHub repo for this experiment, initialize it and commit there; if it's meant to stay local, drop the "PR" from the ask.
8. **[L3]** Rewrite the P1 report's headline to lead with `healed=0`, not `false_heal=0`.

---

## One-paragraph summary

The P1 trial run produced a null-result on the firewall — nothing healed, so nothing had a chance to false-heal. The library and its documented K8 discipline are validated (matcher correctly abstained on an anchor-poor CTA); the adapter's unique contribution — trusted-event heal execution — was never tested because no heal ever happened. The written report is technically honest but the headline metric (`false_heal=0`) is easy to misread as firewall validation, when it's actually a "no shots fired" measurement. Fixing this means picking an anchor-richer target and re-running so that at least A-mutations produce a heal and B-mutations a heal-to-wrong-identity, then computing false_heal against real identities rather than my hand-labeled expectations.
