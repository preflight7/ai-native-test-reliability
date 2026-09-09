# Phase R matrix D1-D8 — redteam + D5 verification

**Date:** 2026-09-09
**Companions:** `matrix_d1_d8_executive.md` (retracted verdict, see revised section), `matrix_d1_d8_benchmark.md`, `matrix_d1_d8_per_trial.md`.

## Why this doc

The first exec summary on this matrix oversold the library — reported "Library > Naive on 3 drifts" without noticing S also passed those same 3 drifts. This doc records the self-redteam that caught it, plus a code-level verification of the one finding that survived (D5).

## Redteam of my own findings

Attacks on the D1-D8 output that landed:

1. **The "L > N on D6/D7/D8" claim collapses when you read the S column.** All three drifts leave `data-testid="main-menu-trigger"` untouched. S passes 5/5 on all three via that unchanged testid. L "wins" by echoing the same testid back — no healing occurred. The delta L vs N is a locator-strategy fact (testid anchor vs role-name anchor under aria drift), not a library capability. Retracted in the revised executive verdict.

2. **D4 "N passed 5/5 despite aria rename" is a comparator artifact, not a robustness finding.** My identity mirror in `page.evaluate` filters buttons by `aria-label === "Menu"`, which no longer exists post-rename. Playwright's `getByRole` uses ARIA accessible-name computation (walks labelled-by, title, child text). My mirror doesn't. So I flagged as "N surprisingly robust" what is more likely "my instrument couldn't measure the target." Fix is straightforward: use `await locator.elementHandle()` and evaluate on that node.

3. **N=5 has no variance detection.** Every cell is 0/5 or 5/5. Intermittent conditions (HMR races, partial-render click landings) can't be surfaced. Deterministic-looking grid may be an N=5 flatness illusion.

4. **Between-drift order effects are unprotected.** Randomization is intra-drift only. Between-drift confounds (bundler cache, HMR warmup, memory pressure) not controlled.

5. **"0 false heals" uses the weak expectation-vs-outcome fallback.** No R.1 attribute-hash oracle was inlined. The number is not defended and should not be cited.

6. **The `same-elem 10/10` aggregate is over D1+D2 only** — drifts where any two locators trivially converge. Not epistemically load-bearing.

7. **"Library > Naive on 3 drifts" was defensible as a raw number and misleading as a story.** The correct read: "when testid is preserved and aria/role drifts, testid-anchored strategies (L, S) beat aria-anchored strategies (N)." That is a Playwright locator fact, not a library fact.

## D5 verification — confirmed library defect

Traced the code path end-to-end. The finding stands, and the mechanism is now precise.

### The path

1. `experiment/lib/selfheal-core.js#matchStep` (line 242) runs. Ranks candidates, picks the correct winner — `vd.best.el` = the actual main-menu-trigger button, top-ranked by `scoreEx` against the recorded descriptor.
2. `noAnchorVeto` does NOT fire. It gates on `step.flag`, which is set at **capture time** from the recorded descriptor (which had `testid=main-menu-trigger` intact). At match time it is not re-derived.
3. `matchStep` returns `{verdict:'heal', best:{el, ex, conf}}`. The winner's `ex` is extracted from the current DOM — and the winner button STILL has `data-testid="dropdown-menu-button"`, supplied by radix's `DropdownMenu.Trigger` default. Deleting the outer prop only removed our override, not the underlying primitive's default.
4. The adapter `experiment/harness/selfheal-playwright-runtime.js#matchInScope` (line 39) then calls `SELFHEAL.bestLocator(ex)`. `bestLocator` (core line 133) unconditionally returns `[data-testid='dropdown-menu-button']` — testid tier is first in the preference order, no cardinality check.
5. Adapter's line 165-170 checks uniqueness — but on the **original recorded** locator (for `firstTry` accounting), not the emitted healed one.
6. Playwright's strict-mode `click` sees 2 matches on `[data-testid='dropdown-menu-button']` (main-menu-trigger and `More tools` trigger — both radix DropdownMenu variants) → throws.

### The gap named precisely

The library owns the uniqueness primitive:
- `experiment/lib/self-heal/pipeline/candidate-validation.js#uniqueness` — counts `doc.querySelectorAll(loc.sel).length === 1`.
- `experiment/lib/selfheal-core.js#captureStep` line 153 uses it at record time (`uniqueAtRecord`).

The library also owns a widening / disambiguation pipeline:
- `experiment/lib/self-heal/pipeline/candidate-generation.js#disambiguate`, `disambiguateByContext`.
- `experiment/lib/self-heal/pipeline/search-and-pick.js` — has an `ambiguous-widened` abstain branch.

**The gap:** `matchStep` in the core does not chain through the pipeline's widening/disambiguation modules; the adapter calls `matchStep` directly. Neither `matchStep` nor `matchInScope` runs a cardinality check on the emitted `bestLocator(ex)` against the current DOM before returning `verdict=heal`. The ambiguity firewall thus exists at record-time and inside a pipeline module the adapter never calls — but is absent on the match-time path the adapter actually uses.

This is a real defect, not documented behavior. `captureStep` treats uniqueness as an invariant the emitted locator must satisfy; the match path does not enforce the same invariant.

### Fix surface

Two candidates:

- **Adapter-side (small, no library change):** in `matchInScope`, after `loc = SELFHEAL.bestLocator(ex)`, run `document.querySelectorAll(loc.sel).length !== 1` → return `{verdict:'abstain', diagnosis:'ambiguous-emit'}`. Measurement-honest, doesn't repair the library. Would flip D5's outcome from `adapter-error` to `ABSTAIN/AMBIGUITY` — correct failure, in the library's own vocabulary.
- **Library-side (correct):** collapse `matchStep` + `bestLocator` into a `matchAndEmit(doc, step)` that runs the uniqueness check on the emitted selector before returning `verdict=heal`, and downgrades to abstain-with-`ambiguous` diagnosis otherwise. This is the invariant `captureStep` already promises; the fix is to enforce the same invariant at the other end of the flow.

## Where we stand

- **A1 (D1) verdict unchanged:** Library ≈ Naive on testid rename, same physical element. Reproduced under this matrix (5/5, 5/5, same identity).
- **D6/D7/D8 do NOT give the library a positive-value story.** They show testid-anchored strategies (including plain strict) beat aria-anchored strategies under aria drift.
- **D5 is a confirmed library defect**, mechanism named, fix surface identified.
- **The library-value question on attribute drift is unresolved by this block.** The next matrix that could resolve it: hold testid unchanged, drift everything else (className, aria, role, structure, text). That's the drift shape where L, N, and S diverge in ways that separate healing from anchor stickiness. This block did the opposite.

## Recommended next moves

1. Land the library-side fix (`matchAndEmit` with cardinality check). Add a targeted regression test: recorded descriptor with unique testid → mutate DOM so testid is now shared by 2 elements → expect abstain, not heal.
2. Fix the identity comparator in `compare_matrix.js` to use `await locator.elementHandle()` + evaluate on that node, so cross-drift same-element claims become trustworthy.
3. Re-run D5 to confirm outcome flips from `adapter-error` to `ABSTAIN/AMBIGUITY`.
4. **Do NOT proceed to D9-D17 yet.** Structural + text drifts will multiply the D4 comparator problem across more cells; running them with a broken comparator produces more numbers, not more knowledge.
5. After 1-3 land, design the "hold testid, drift everything else" matrix — the only shape that can produce a positive library-value story.
