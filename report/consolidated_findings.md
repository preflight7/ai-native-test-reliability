# Consolidated findings — AI-Native Test Reliability Slice-1

**Date:** 2026-09-03
**Status:** Stopped. Not shipping further code. This document supersedes p1_results.md, p1_v2_results.md, p2_results.md, and three_gaps_closed.md as the honest read of what happened.

**Pinned refs**
- Target: `excalidraw/excalidraw` @ `e1bb9ff8`
- Library: `preflight7/ai-for-qa` fork @ `599dca1` on `feature/heal-policy` (upstream: `prashantkothari/ai-for-qa` @ `a31ace4`)
- Experiment repo: `preflight7/ai-native-test-reliability`

---

## 1. What we actually proved

- **The Playwright adapter runs end-to-end.** The library's diagnosis-first pipeline (matcher → verify-by-effect → false-heal firewall) can be driven against a real running React SPA via `page.evaluate` + a `bestLocator` translator + Playwright trusted click. Pristine runs produce `PASS / verify_confidence=HIGH / VERIFIED`.
- **The library's K8 discipline holds on cold starts.** When the recorded target's identity cannot be uniquely disambiguated after drift, the matcher refuses to guess (`ABSTAIN / AMBIGUITY`). Documented in the library, observed in trials.
- **The heal path executes correctly when an anchor survives drift.** A1 (rename `data-testid`) with the aria-label prep baseline heals via role+name fallback, verify passes, false_heal=false. The library's `bestLocator` selection + fallback tier logic works as designed.
- **`heal_policy` (per-key `auto` / `review_only` / `never_heal`) works.** Added on lib branch `feature/heal-policy`. A `never_heal_A1` trial produces `ABSTAIN / category=POLICY`, no matcher call, no click. Closes a gap called out earlier (heal-preference-doesn't-stick).
- **iframe scope enforcement works.** New `resolveFrame` in the adapter honors `_anchor.framePath`. The `scout-iframe.mjs` spike asserts child-frame heal, main-frame heal, and cross-frame abstain — all pass.
- **Adapter machinery has no vendor-name leakage.** `bundle-library.js` scrubs six brand names on concat; our own code + docs + reports also grep clean.

## 2. What we did NOT prove (and the reasons)

- **The trusted-events thesis — the adapter's *reason for existing* — is not load-bearing on this fixture.** Trusted vs synthetic delta across 8 P2 mutations = ZERO. Radix `DropdownMenu.Trigger` doesn't gate on `event.isTrusted`; only latency differed by ~50-90 ms. Honest negative evidence. Would need an `isTrusted`-checking component (drag-drop, paste, some paywall handlers) to generate positive evidence for the adapter's value.
- **The `false_heal` oracle is a self-set expectation, not identity-derived.** `run_trials.js` hand-labels each trial's `expectedOutcome`; my adapter feeds a stub `resolvedIdentity`/`expectedIdentity` (`'passed'` / `'not-passed'` strings) into `SELFHEAL_FALSEHEAL.isFalseHeal`. This means "false_heal=true" surfaces whenever runtime outcome doesn't match my declared expectation, not when the matcher actually resolved a wrong-identity element. **The `false_heal=2` P2 headline was this oracle firing on a mutation that turned out to be inert** (see §3 B2). Real identity-based oracle needs `resolvedIdentity` = the healed element's stable id, `expectedIdentity` = the recorded element's stable id, compared with `===`. Not implemented.
- **Compounding — the original SaaS moat thesis — was not tested at all.** The plan dropped it in P1. Never returned. Every trial ran with a fresh brain. The library's ladder (`PROMOTE_AT=5`, `DEMOTE_AT=1`) and brain-served path were never exercised. The whole "10th repair cheaper than 1st" claim remains unmeasured.
- **`brain.js`'s ladder / demote-fast / sticky `was_primary` semantics never fired.** Fresh brain per trial; nothing to demote. Design is documented; behavior is unproven.
- **The B2 firewall gap was not real.** See §3.
- **Mutation authoring was never gate-checked.** We wrote 6 mutations and only verified two (A1, B1) actually change what they claim to. A3/B2/B3 are effectively inert on this target (details in §3). We spent trials measuring our own mutation authoring, not the library.

## 3. Mutation-by-mutation fate (honest read)

| id | Intent | What actually happens on this target | Signal produced |
|---|---|---|---|
| **A1** | Rename `data-testid` | Works. Matcher heals via `aria-label` fallback (prep-aria baseline). | Real: positive-heal path, verify=HIGH, false_heal=false |
| **A2** | Wrap `<button>` in a React component | Renders, matcher heals via testid unchanged. | Weak: doesn't actually test wrapper drift because testid persists |
| **A3** | Wrap Radix Trigger in outer `<div>` | ABSTAINed both modes. Radix re-renders differently (different testid). | Artifact: measuring Radix reconciliation, not matcher |
| **B1** | Rename both testid AND className | Works. Matcher heals via role+name; identity check via `isFalseHeal` doesn't currently distinguish this from A1 outcome. | Weak: absent proper identity oracle, we can't say "wrong identity" fired |
| **B2** | Inject duplicate button | **INERT.** Radix's slot system drops the injected `<button>` before render. Live DOM has 1 element, not 2. | Artifact: the "false_heal=2" P2 headline was my `expectedOutcome=ABSTAIN` firing on a legitimate PASS |
| **B3** | 500 ms network delay via `page.route` on `**/*` | INERT on pure-client target. Added ~5.5s latency; outcome PASS. | Zero: matcher never sees any drift |

**Two mutations (A1, B1) produce real signal. Two (B2, B3) are inert. Two (A2, A3) test artifacts of the wrapper.** N=2 of usable-signal trials × 2 event modes = 4 datapoints. Not a benchmark.

## 4. Why we drifted (self-critique)

- **Target picked in ~30 min with a fail-fast rule; then patched for 4+ hours to keep it usable.** Prep-aria patch, target-fitness pre-check, mutation redesigns — each was a plausible incremental step but the cumulative effect is: we made a fixture-shaped adapter for a specific Radix component, not a general reliability harness.
- **`spawn_task` reflex.** When findings surfaced problems (P1 criticals, B2 "gap"), I spawned chips to fix them rather than pausing to ask whether the finding actually invalidated the experimental shape. The peer session's stop-and-ask on B2 was better discipline than my "let's ship a guard" instinct.
- **Every headline was over-strong.** P1 report headlined `false_heal=0` when nothing had healed. P2 report headlined `false_heal=2` when the mutation was inert. Both technically true, both misleading if skimmed.
- **The SaaS thesis went unmentioned in every follow-up.** Compounding is the whole point. We never got there.

## 5. What this run legitimately produced

- Working, tested Playwright adapter (~340 LOC + 10 unit tests for the locator translator).
- A `bestLocator` translator that handles the observed format zoo.
- A `heal_policy` addition to the library that fills a documented gap (branch `feature/heal-policy`, commit `599dca1`).
- iframe-scope resolver in the adapter (`resolveFrame`).
- A control-flow spec (`gap_E_control_flow.md`) that names the runner-side interface needed for While/If steps to interleave heals correctly.
- Vendor-name scrub in the bundler + `.gitignore` hygiene.
- A subtree-split public repo (`preflight7/ai-native-test-reliability`) with a clean 7-commit history, submodule fork wired for reproducibility.

## 6. What the next research question should be (recommendation, not action)

The current experimental shape has told us most of what it can. Two paths, either of which is a fresh start:

- **A: Test the compounding thesis directly.** Pick a target with 8-12 similar CTAs (a checklist app, a table with row actions, an admin dashboard). Drift them one at a time across sequential trials. Persist the brain. Measure whether cost/heal drops and false_heal stays 0 as N grows. This is the SaaS moat claim.
- **B: Test on an anchor-poor target where the library's residue (LLM/vision gate) becomes load-bearing.** Excalidraw is anchor-medium; the library's deterministic pipeline handles most of it. A target where role+name doesn't survive drift would expose whether the library's `T3+` levers exist and work.

Either path requires: **a proper identity-based oracle** (currently H4 in the P1 redteam, unresolved), **verified-runnable mutations** (add a "does this mutation change the live DOM?" pre-check to the harness), and **a target with better anchor discipline than Excalidraw**.

## 7. Open follow-ups (not scheduled)

- Identity-based `false_heal` oracle in the adapter (P1 redteam H4)
- Mutation-runnability pre-check in `run_trials.js` (would have caught B2 and B3 before we spent 8 trials on them)
- Dirty-tree bailout bug in `run_trials.js` (peer flagged during P2, unfixed)
- Push `feature/heal-policy` back to upstream `prashantkothari/ai-for-qa` as a PR (currently only on the preflight7 fork)
- Explicit non-goal: mobile parity, cross-tenant learning, Salesforce Lightning parity, framework-agnostic (Selenium/Cypress) — all deliberately out of scope for anything we've built.

## 8. Chip status (post-consolidation)

- task_54c95207 (P1 criticals) — landed
- task_38d6b343 (three gaps) — landed
- task_c6b396de (P2 matrix) — landed
- task_8e41f5da (GH remote) — I took over; repos pushed
- task_5fd150a5 (B2 firewall fix) — told peer to revert and exit; no code shipped

Local branch `claude/ai-native-test-reliability-011333` @ `3752205`. Public repo `preflight7/ai-native-test-reliability` @ `main`. This report will be one commit on top.
