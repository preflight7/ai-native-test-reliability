# Phase R matrix — D1..D8 attribute drift, executive summary

**Date:** 2026-09-09
**Branch:** `claude/phase-r-matrix-d1-d8` off `e47ba2f`
**Target:** Excalidraw @ `e1bb9ff8` under `prep_aria.patch` + one drift patch per class.
**Library:** submodule @ `599dca1` on `feature/heal-policy`.
**Trials:** 7 drift classes × 3 paths × N=5 = **105 trials**. Fresh Playwright context per run. Randomized interleaved schedule per drift.
**Env note:** dev server on `:3002` (not `:3001` — port 3001 held by an unrelated ssh forward). Fixture navigation URL rewritten in memory; nothing else changed.
**D3 skipped** by design (recorded id was a hashed `radix-:r2:` at stability 0.2 — not a useful drift signal).

## 7×3 heal-rate grid

| drift | description | L | N | S | same-elem (L vs N) |
|---|---|---:|---:|---:|---:|
| **D1** | rename `data-testid` → `menu-trigger-v2` | 5/5 | 5/5 | 0/5 | 5/5 |
| **D2** | rename className `main-menu-trigger` → `menu-trigger-v2-cls` | 5/5 | 5/5 | 5/5 | 5/5 |
| **D4** | rename `data-testid` AND `aria-label` (both matcher anchors gone) | 5/5 | **5/5** ⚠️ | 0/5 | 0/0† |
| **D5** | delete `data-testid` entirely | **0/5** ⚠️ | 5/5 | 0/5 | 0/0‡ |
| **D6** | delete `aria-label` entirely | 5/5 | 0/5 | 5/5 | 0/0§ |
| **D7** | `aria-label` "Menu" → "Options" | 5/5 | 0/5 | 5/5 | 0/0§ |
| **D8** | add `role="link"` (overrides implicit button role) | 5/5 | 0/5 | 5/5 | 0/0§ |

† D4: identity comparator (a JS mirror in `page.evaluate`) queries by `aria-label === "Menu"`, which no longer exists — so N's identity is `null` and same-elem is incomparable. See "Surprises" below — N's PASSes on D4 are themselves the surprise.
‡ D5: L failed on all 5 runs (see below); nothing to compare against N.
§ D6/D7/D8: N failed on all 5; nothing to compare against L.

**Aggregate same-element ratio (where comparable):** 10/10 (D1 + D2). All other cells were incomparable — either one path failed outright, or (D4) the identity comparator could not see the naive path's target with its aria-label-based mirror.

**False-heal count (fallback: expectation-vs-outcome, no attribute-hash oracle inlined this run):** 0 detected. L PASS cells all clicked the same physical button via a testid that still resolved uniquely to the trigger. The identity hashes in `logs/matrix_d1_d8.jsonl` are consistent within each drift class for L.

## Verdict (revised 2026-09-09 after self-redteam — the prior verdict oversold the library)

**Read the S column, not just the L/N delta.** On D6/D7/D8 the strict recorded testid selector passes 5/5 — because those drifts touch aria/role, NOT testid. The library "wins" those cells by echoing the still-valid testid, not by healing. The 3 drifts where L > N are the 3 drifts where **S > N identically**. That's a locator-strategy result (testid as anchor beats aria as anchor when aria drifts), not a library capability.

- **L, S both beat N on 3 drifts:** D6, D7, D8 — testid preserved; naive `getByRole` breaks under aria/role drift; library and plain strict testid selector both work. No healing was necessary.
- **L, N, S all pass on 2 drifts:** D1 (L emits a rename of the testid — Playwright would need it too) and D2 (className rename is inert; testid still resolves for all three paths).
- **L, N both pass; S fails on 1 drift:** D1 (repeated for clarity — testid rename is where L and N converge on the same physical element via different anchors).
- **L fails, N passes, S fails on 1 drift:** D5 (see below — potential ambiguity-firewall bug in the library, needs code verification).

**The library-value question on attribute drift is unresolved by this matrix.** No cell demonstrates a heal that a plain strict locator on the preserved testid didn't already achieve. D6/D7/D8 do NOT extend the A1 (Library ≈ Naive) story into a positive-value story; they just show what happens when aria drifts while testid holds.

The next matrix that could resolve this: **hold testid unchanged and drift everything else** (className, aria, role, structure, text). Under those conditions L, N, and S diverge in ways that separate healing from anchor stickiness. This block did the opposite — drifted the anchor and asked whether other anchors survive.

## Surprises worth escalating

1. **D5 — Potential library ambiguity-firewall bug (UNVERIFIED against library source).** When `data-testid` is deleted, the healer serializes to the underlying radix component's testid `dropdown-menu-button`, which matches TWO buttons on the page. Playwright strict-mode throws 5/5. This *looks like* a missing page-wide cardinality check before selector emit, but the claim needs to be verified against `selfheal-core.js`'s `bestLocator`/`matchStep` code before being labeled a bug — the library may have an ambiguity guard downstream of the emit that we didn't observe, or a documented "abstain-when-ambiguous" branch that isn't firing here for a specific reason. Do not cite as a defect until code inspection confirms.

2. **D4 — "N passed" is a comparator artifact, not a robustness finding.** The identity comparator is a JS mirror in `page.evaluate` that filters `buttons` by `aria-label === "Menu"` — after the rename it sees nothing, so N's identity captures as `null` and same-elem shows 0/0. Playwright's accessible-name computation walks child text / aria-labelledby / title, which the mirror doesn't reproduce. Until the comparator is fixed to use `await locator.elementHandle()` + evaluate on THAT node, cross-drift same-element claims (including this one) are unsafe. Don't cite D4's "N=5/5" as evidence of anything until the comparator is fixed and rerun.

3. **D2 — inert drift.** Renaming the className changes nothing observable from the test's perspective; even S passes 5/5. This drift class does not exercise anything the test relies on. Keep as a control — it confirms unrelated attribute churn doesn't harm any path.

## Recommendation (redteam-corrected)

**Halt for user review before proceeding to D9-D17.** Three reasons, in priority order:

1. **Verify D5 by code inspection first (~15 min).** Read `selfheal-core.js`'s `bestLocator`/`matchStep` to confirm or refute the missing-cardinality-check hypothesis. If it's a real bug, the library is *worse* than plain strict-testid on that drift and we need to name that. If it's not, D5 is just "the recorded testid was the only unique anchor and it's gone."
2. **Fix the identity comparator** to use `await locator.elementHandle()` + evaluate on that node. Until then, cross-drift same-element claims (D4 and any future drift that touches aria/text) are unsafe.
3. **Design the next matrix to hold testid unchanged.** Drift className, aria, role, structure, text — everything *except* the recorded anchor. That's the matrix that separates healing from anchor stickiness. This block did the opposite (drifted the anchor, asked whether other anchors survive) — which is a Playwright locator question, not a library question.

## Aggregate false-heal note

The "0 false-heal" number uses the weak expectation-vs-outcome fallback, not the R.1 attribute-hash oracle. Do not cite it as evidence. The R.1 oracle rewrite is still deferred.

## Reproduce

```bash
cd experiment
git checkout claude/phase-r-matrix-d1-d8
node harness/bundle-library.js       # if logs/selfheal-bundle.js is stale
URL_TARGET=http://localhost:3002/ node harness/compare_matrix.js
cat logs/matrix_d1_d8.jsonl | wc -l  # 105
```

Environment: excalidraw dev on 3002 (`cd experiment/target_repo/excalidraw-app && VITE_APP_PORT=3002 ../node_modules/.bin/vite`).
