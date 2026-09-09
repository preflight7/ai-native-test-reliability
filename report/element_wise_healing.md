# Element-wise healing + flakiness report

Sources: `logs/trials.jsonl` (P1/P2, 16 rows), `logs/compare_a1.jsonl` (Phase R min, 15 rows), `logs/matrix_d1_d8.jsonl` (D1-D8, 105 rows), `logs/compounding.jsonl` (C1+C2, 11 rows). Total: ~148 trials. Target: Excalidraw @ `e1bb9ff8`. Library: submodule @ `c8d47aa`.

All heal-rates below are `passes / attempts`. Elements grouped by DOM identity. **Flakiness column** = variance within a mutation cell (0/5 or 5/5 = deterministic; anything in between = flaky).

---

## Element 1: Main menu trigger

Recorded selector: `[data-testid="main-menu-trigger"]` — Radix DropdownMenu Trigger button, hamburger icon top-left. `aria-label="Menu"` added via `prep_aria.patch`.

| trial-set | drift | L (library) | N (naive `getByRole`) | S (strict testid) | Flakiness (variance in-cell) | Notes |
|---|---|---:|---:|---:|---|---|
| P1 v2 | A1 = testid rename | 3/3 heal | — | 0/3 (control) | deterministic | pristine + A1 + never_heal_A1 |
| P2 matrix | A1/A2/A3/B1/B2/B3 × synth+trusted | 14/16 pass | — | — | deterministic | 2 "false_heals" retracted as inert-mutation artifacts |
| Phase R min | A1 | 5/5 | 5/5 | 0/5 | deterministic | Library ≈ Naive; same physical button (identity hash matched) |
| D1-D8 matrix | D1 rename testid | 5/5 | 5/5 | 0/5 | deterministic | Same as Phase R min |
| D1-D8 matrix | D2 rename className | 5/5 | 5/5 | 5/5 | deterministic | Drift is inert; testid still resolves for all |
| D1-D8 matrix | D4 rename testid + aria | 5/5 | 5/5 ⚠️ | 0/5 | deterministic | N's 5/5 is comparator-blind (identity mirror couldn't resolve after aria rename) |
| D1-D8 matrix | D5 delete testid | 0/5 → ABSTAIN post-fix | 5/5 | 0/5 | deterministic | Before matchAndEmit fix: Playwright strict-mode exception. After: library-native abstain with emitCount=2 |
| D1-D8 matrix | D6 delete aria-label | 5/5 | 0/5 | 5/5 | deterministic | Library and Strict both win because testid intact |
| D1-D8 matrix | D7 aria "Menu"→"Options" | 5/5 | 0/5 | 5/5 | deterministic | Same as D6 |
| D1-D8 matrix | D8 add `role="link"` | 5/5 | 0/5 | 5/5 | deterministic | Same as D6 |

**Per-element summary:** across 88 attempts on this element, zero within-cell flake observed. Library heals via its testid tier on every drift except D5 (where the recorded testid is gone and the surrounding Radix testid is ambiguous — library now correctly abstains). **Cold-start value story:** identical to plain strict-testid selector on every drift where testid is preserved; loses to naive `getByRole` on D5.

---

## Element 2: Toolbar rectangle

Recorded selector: `[data-testid="toolbar-rectangle"]` — Excalidraw shape tool.

| trial-set | drift | L | N | S | Flakiness | Notes |
|---|---|---:|---:|---:|---|---|
| C1 (compounding, 6 sequential runs) | testid rename (`toolbar-rectangle` → `toolbar-rect-v2`) via `page.evaluate` | 6/6 pass; runs 1-5 matcher-served, run 6 brain-served | — | — | deterministic | Ladder promoted L1→L2 at successes=5; identity hash `bd6395e9de94` unchanged all runs |
| C2 run 1 | Same mutation | 1/1 pass, matcher-served | — | — | deterministic | Cross-button phase's first entry |

**Wall-time per run: 522-530 ms across all 7 attempts.** L2 promotion contributed zero visible latency. The chip skipped the trusted-click adapter (used synthetic `el.click()` inline), so this element's compounding numbers are conditional on synthetic events working as trusted here.

---

## Elements 3-6: Toolbar ellipse / diamond / arrow / line

Recorded selectors: `[data-testid="toolbar-ellipse"]`, `-diamond`, `-arrow`, `-line`.

| element | drift | L | N | S | Flakiness | brain entry after |
|---|---|---:|---:|---:|---|---|
| ellipse | testid rename via evaluate | 1/1 pass | — | — | deterministic | 2 keys total |
| diamond | testid rename via evaluate | 1/1 pass | — | — | deterministic | 3 keys total |
| arrow | testid rename via evaluate | 1/1 pass | — | — | deterministic | 4 keys total |
| line | testid rename via evaluate | 1/1 pass | — | — | deterministic | 5 keys total |

Each ran exactly once (C2 by design). Brain accumulated monotonically 0→5 entries; no ladder promotions (each key has successes=1). Identity hashes distinct per element.

---

## Elements 7-9: sundry (P1/P2 era, superseded)

- Element 7: `[data-testid="dropdown-menu"]` — used as verify-by-effect sentinel, never a click target. Present-count checks only.
- Element 8: `[data-testid="footer-help"]` — earlier scoping only; no P1/P2 mutations landed on it.
- Element 9: `HamburgerMenuIcon` SVG child — possibly what naive `getByRole` accidentally matches on D4 (unconfirmed; would need identity-comparator fix to say).

## Aggregate flakiness

- **148 trials, 0 within-cell variance observed.** Every mutation × path × N=5 cell was 0/5 or 5/5 (or its 6/6 or 1/1 equivalent for compounding).
- **This is not proof of low flakiness — N=5 is undersized to detect intermittent failure.** A trial that fails 10% of the time would appear all-pass or all-fail in most 5-sample cells. Would need N≥20 per cell (30 minutes of extra compute per mutation) to say "flake < 5%" with useful confidence.
- Wall-time was tight (525-3100 ms per trial depending on path; SD ~50 ms within a cell) — no obvious perf drift across runs.

## Coverage gaps by element

- **Only 1 recorded flow per element.** Each of the 5 toolbar buttons has ONE recorded step; the menu trigger has ONE toggle flow. Real production tests touch dozens of steps per flow. Nothing here tests multi-step compounding.
- **Only one drift kind exercised on toolbar buttons** (testid rename via evaluate). D2-D8 shapes never applied to toolbar elements.
- **No adversarial drifts** where matcher SHOULD abstain-or-fail (properly-designed B1/B2, D21-D23 in the full matrix I never ran).
- **No env / temporal / state drift** applied to any element.
- **No cross-drift on the same element** (drift A then B then C with brain persisting).

## What this report intentionally does NOT claim

- Does NOT claim library heals better than alternatives on any drift class. On every cell where L > N, S ≥ N too.
- Does NOT claim compounding saves time. Wall-time was flat.
- Does NOT claim `false_heal=0` proves the firewall works. The oracle used across most trials was expectation-based (weak); only Phase R min and compounding used identity-based oracles, and those were narrow.
- Does NOT generalize beyond Excalidraw.
