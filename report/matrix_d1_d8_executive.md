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

## Verdict

- **Library > Naive on 3 drifts:** D6, D7, D8. When the aria-label is renamed/removed, or when a `role` override kills `getByRole('button')`, the library still heals via testid; the naive `getByRole` locator times out.
- **Library ≈ Naive on 2 drifts:** D1, D4. Both paths reach the same physical button 5/5 (or on D4, N reaches *some* button that also toggles the sentinel — see surprises).
- **Library ≈ Naive ≈ Strict on 1 drift:** D2 (className rename is inert for this test — testid still resolves; the drift didn't actually shift the anchor).
- **Library < Naive on 1 drift:** D5 (see below).

**Story shifted from A1-only view.** After A1 (D1) alone the story was "Library ≈ Naive". Broadening to attribute deletions and role overrides shows a real positive gap: L survives 3 drift classes N cannot. But L also has a **clear negative** on D5.

## Surprises worth escalating

1. **D5 — Library fails ambiguity check.** When `data-testid` is deleted, the healer serializes to the underlying radix component's testid `dropdown-menu-button` — which matches TWO buttons on the page (main menu trigger AND `More tools` trigger). Playwright's strict mode throws; adapter records `adapter-error`. **This is exactly the ambiguity-firewall condition** — the library should refuse the heal rather than emit an ambiguous selector. It does not (or the refuse fires later than the emit that fed strict-click). The library ranking picked a wider anchor because the recorded anchors were both gone, and did not check the selector's page-wide cardinality before returning it.

2. **D4 — Naive still passes when aria-label is renamed to "Application menu".** `page.getByRole('button', {name:'Menu'})` PASSes 5/5 even though we changed the label. This means Playwright's accessible name computation is matching *something* on the page (candidates: the `HamburgerMenuIcon` SVG child's aria-label, a title attribute, or an as-yet-unidentified second "Menu" button). Whatever it is, it DOES successfully toggle the same dropdown sentinel — the sentinel toggle check passed. Worth an inspection pass: is Excalidraw exposing a second element with accessible name "Menu" that the JS-mirrored identity check doesn't see? If yes, the D4 result is "N accidentally survived", not "N is robust to aria drift". Recommend confirming before drawing a durable conclusion.

3. **D2 — inert drift.** Renaming the className changes nothing observable from the test's perspective; even S passes 5/5. This drift class does not exercise anything the test relies on. Keep as a control — it confirms unrelated attribute churn doesn't harm any path.

## Recommendation

**Halt for user review before proceeding to D9-D17.** Two reasons:

- D5's outcome contradicts the "ambiguity firewall" narrative for the library. That is either a real bug in the healer or a gap in what the firewall's supposed to prevent, and it's worth naming and understanding before broadening the matrix into structural / text drifts where similar ambiguity conditions will recur.
- D4's naive-pass may or may not be genuine robustness. The identity comparator needs a fix (capture identity via the Playwright locator's `elementHandle`, not a JS mirror) before we can trust same-element claims across drifts where the accessible name changes.

## Reproduce

```bash
cd experiment
git checkout claude/phase-r-matrix-d1-d8
node harness/bundle-library.js       # if logs/selfheal-bundle.js is stale
URL_TARGET=http://localhost:3002/ node harness/compare_matrix.js
cat logs/matrix_d1_d8.jsonl | wc -l  # 105
```

Environment: excalidraw dev on 3002 (`cd experiment/target_repo/excalidraw-app && VITE_APP_PORT=3002 ../node_modules/.bin/vite`).
