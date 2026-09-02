# P1 Results — AI-Native Test Reliability Slice-1

**Date:** 2026-09-02
**Pinned SHAs**
- Library (`prashantkothari/ai-for-qa`): `a31ace4f199fa3824ba374208c8cc2a9b6f4e4ea`
- Target (`excalidraw/excalidraw`): `e1bb9ff8f8931e783c11d104abb8967ac6605c9a`

**Scope:** cold-start firewall fitness check at N=3, trusted-events mode only.
**Question P1 answers:** Does the library's pipeline run end-to-end against a real running app driven by Playwright's *trusted* events, and does `false_heal` stay at 0?

---

## What was built (contribution)

| File | LOC | Purpose |
|---|---:|---|
| `harness/bundle-library.js` | 45 | Concat load-order into one script for `page.addInitScript` |
| `harness/translate-locator.js` | 32 | Map library's `bestLocator` (CSS + `role=…` pseudo) → Playwright Locator; throws on unknown |
| `harness/translate-locator.test.js` | 63 | 10 unit tests, all pass |
| `harness/selfheal-playwright-runtime.js` | 165 | Adapter: injects library, delegates match/verify to `page.evaluate`, does the *act* with Playwright trusted click, emits `flywheel-event/v1` row |
| `harness/capture-fixture.mjs` | 40 | Records the authored test via library's own `captureStep` (correct `{v,st}` descriptor shape without hand-authoring) |
| `harness/run_trials.js` | 96 | Trial loop: git-apply/revert per trial, launch page, run adapter, check gate |
| `fixtures/authored-test.json` | 132 | 3-step test recorded from pristine Excalidraw |
| `mutations/mut_A1.patch` | — | Renames `data-testid="main-menu-trigger"` → `"menu-trigger-v2"`, keeps class |
| `mutations/mut_B1.patch` | — | Renames BOTH `data-testid` and `className` (Mock-2-corrected form) |

**Reused verbatim from the library** (no rewrites): `selfheal-core.js` (matcher, `matchStep`, `captureStep`, `verdict`, `bestLocator`, `verifyEffect`, weights, thresholds), `schemas/false-heal.js` (`isFalseHeal`), `schemas/flywheel-event.schema.js` (row shape), the whole `pipeline/*` (diagnose/generate/validate/verify/report/temporal-wait/search-and-pick/learning-loop), and `brain/brain.js`.

---

## Trial results

Command: `node harness/run_trials.js`. Log file: `logs/trials.jsonl`.

| trial | outcome | verify_confidence | category | healed | false_heal | first-step best-locator | latency |
|---|---|---|---|---:|---:|---|---:|
| pristine | **PASS** | HIGH | VERIFIED | false | **false** | `[data-testid='main-menu-trigger']` (testid tier) | 3005 ms |
| A1 | ABSTAIN | NONE | AMBIGUITY | false | **false** | `[data-testid='menu-trigger-v2']` (testid tier, top-ranked but margin too tight) | 2066 ms |
| B1 | ABSTAIN | NONE | AMBIGUITY | false | **false** | `[data-testid='unrelated-widget']` (top-ranked but margin too tight) | 2068 ms |

**Aggregate `false_heal` across 3 trials: 0.**

---

## What was proven

1. **The Playwright adapter works.** Pristine Excalidraw drove end-to-end through the pipeline: library injected via `addInitScript`, matcher ran in-page via `page.evaluate`, `bestLocator` was translated to a real Playwright Locator, trusted click fired, verify-by-effect (`elementGone` on `[data-testid="dropdown-menu"]`) confirmed HIGH-confidence PASS.
2. **The firewall did not misfire.** No `false_heal:true` on any trial. On both mutations, the matcher **correctly abstained** rather than guess between similarly-scoring candidates.
3. **`isFalseHeal` (identity-based) integrates cleanly with our trial oracle.** Adapter calls `SELFHEAL_FALSEHEAL.isFalseHeal(…)` from Playwright over `page.evaluate` — no schema drift, no divergence.
4. **K8 in action.** The library's documented principle — *"healing is a disambiguation problem, not a threshold problem"* — is visible in the raw numbers: on A1 the mutated menu-trigger scored 0.667 (above the 0.62 heal threshold) but the runner-up scored 0.609, margin 0.058 < 0.12 → abstain rather than guess. On B1 every button on the page tied at 0.609 → tighter abstain.

## What was NOT proven

1. **Positive-heal path (matcher heals correctly + verify passes + identity preserved).** Excalidraw's `<DropdownMenu.Trigger>` has no distinguishing `aria-label` or visible text. Under testid drift, matcher has nothing to lean on. This is a *target limitation*, not a pipeline limitation — the K8 finding literally warns about this class of app. Proving the positive path needs a target where the CTA carries `role + name` beyond the testid.
2. **False-heal-triggering B mutation.** Because A1 abstained rather than heal, B1's design (heal-then-verify-fails) never got a chance to execute. To trip `false_heal:true` we'd need matcher to *heal to a wrong element*, which requires either a target with tighter descriptor margins or a mutation that supplies a decoy that clears the margin.
3. **Everything from the original P2 scope**: brain/ladder compounding, synthetic-vs-trusted A/B, retry-on-flake, larger mutation matrix, screenshots.

## Honest verdict

The pipeline is *not obviously broken* at N=3 on Excalidraw. The library's identity-based firewall held by refusing to heal when it could not safely disambiguate — which is exactly the design intent. What we did not test is the pipeline's ability to heal correctly *when a heal is possible*; that requires a target with better a11y anchors than Excalidraw's main-menu-trigger.

**One paragraph for a future reader:** The self-heal library's cold-start pipeline can be driven by real Playwright trusted events against a real running React SPA with a small (~340 LOC) adapter that keeps HTMLElements out of `page.evaluate` and translates the library's `bestLocator` output to Playwright Locators. On the trials we ran, the firewall correctly abstained rather than guess on anchor-poor CTAs — matching the library's own K8 documentation. The positive-heal path was not exercised because Excalidraw's CTA lacks the aria-label / visible-text that role+name fallback needs; proving that path requires either a pre-mutation aria patch or a target chosen for anchor richness. This is a fitness check, not a benchmark; N=3 tells us the pipeline runs and the firewall doesn't misfire — nothing more.

---

## Reproducing

```bash
cd experiment
node harness/bundle-library.js
# ensure Excalidraw dev server is running on :3001 (yarn start in target_repo)
node harness/capture-fixture.mjs   # only if you need to re-record
node harness/run_trials.js
cat logs/trials.jsonl
```
