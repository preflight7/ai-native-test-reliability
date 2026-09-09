# Phase R — Compounding chip, executive summary

**Date:** 2026-09-09
**Branch:** `claude/phase-r-compounding` off `4126548`
**Target:** Excalidraw dev server on `:3002` (upstream port 3001 held by an unrelated ssh forward).
**Library:** submodule @ `c8d47aa` on `feature/heal-policy` (includes the `matchAndEmit` uniqueness fix).
**Fixture drift:** rename `data-testid` on toolbar buttons via `page.evaluate` post-load (DOM mutation persists across React reconciliation because the JSX-declared value is unchanged — verified before authoring).
**Verify signal:** `aria-pressed === "true"` on the button with the recorded `aria-label`. Selector-independent; survives testid drift.
**Persistence:** ONE Playwright browser, fresh context per run. Brain + ladder snapshots (`brain.snapshot()`, `ladder.snapshot()`) round-tripped through Node between runs and rehydrated in-page via `SELFHEAL_BRAIN.makeBrain(seed)` / `SELFHEAL_LEARN.makeLadder(seed)`.

## Phase C1 — same-button repeat learning (6 runs, `toolbar-rectangle` → `toolbar-rect-v2`)

| run | servedBy | tier before → after | ladder action | successes | healedSelector | identity | brainIngested | wall_ms |
|---:|---|---|---|---:|---|---|---:|---:|
| 1 | matcher | L1 → L1 | success | 1 | `[data-testid='toolbar-rect-v2']` | `bd6395e9de94` | true  | 530 |
| 2 | matcher | L1 → L1 | success | 2 | `[data-testid='toolbar-rect-v2']` | `bd6395e9de94` | true  | 526 |
| 3 | matcher | L1 → L1 | success | 3 | `[data-testid='toolbar-rect-v2']` | `bd6395e9de94` | true  | 529 |
| 4 | matcher | L1 → L1 | success | 4 | `[data-testid='toolbar-rect-v2']` | `bd6395e9de94` | true  | 527 |
| 5 | matcher | L1 → **L2** | success | 5 | `[data-testid='toolbar-rect-v2']` | `bd6395e9de94` | true  | 525 |
| 6 | **brain** | L2 → L2 | success | 6 | `[data-testid='toolbar-rect-v2']` | `bd6395e9de94` | true  | 522 |

Ladder promoted to L2 at the fifth consecutive HIGH-verified PASS (matches `PROMOTE_AT=5`). Run 6 was served by the brain — the cached selector `[data-testid='toolbar-rect-v2']` still resolved uniquely to the same physical button (identity hash unchanged all 6 runs), so `brain.get()`'s live-uniqueness re-check accepted it and the matcher was skipped.

## Phase C2 — cross-button corpus growth (5 runs, 5 different toolbar buttons)

| run | testId       | servedBy | tier before → after | brainSize | healedSelector | identity | brainIngested | wall_ms |
|---:|---|---|---|---:|---|---|---:|---:|
| 1 | `C2-rect`    | matcher | L1 → L1 | 1 | `[data-testid='toolbar-rect-v2']`    | `bd6395e9de94` | true | 525 |
| 2 | `C2-ellipse` | matcher | L1 → L1 | 2 | `[data-testid='toolbar-ellipse-v2']` | `c26697be0df8` | true | 528 |
| 3 | `C2-diamond` | matcher | L1 → L1 | 3 | `[data-testid='toolbar-diamond-v2']` | `31c3e95cfa53` | true | 526 |
| 4 | `C2-arrow`   | matcher | L1 → L1 | 4 | `[data-testid='toolbar-arrow-v2']`   | `51d46cf0f575` | true | 524 |
| 5 | `C2-line`    | matcher | L1 → L1 | 5 | `[data-testid='toolbar-line-v2']`    | `903230ae4663` | true | 526 |

Each key promoted to `successes=1` (the whole test has only 1 run) — none reached L2, exactly as designed for this phase. Brain grew monotonically from 0 to 5 entries. Every emitted selector was a real anchor (`[data-testid=...]`) so `isRealAnchor` accepted every put.

## Aggregate

- **C1 run 6 servedBy:** `brain` ✅
- **C2 final brain size:** 5 ✅ (of 5 attempted)
- **False-heal (identity oracle):** 0 in C1 (single identity hash across all 6 runs), 0 in C2 (each test's single run matched pristine identity via aria-label)
- **All 11 runs PASS (aria-pressed=true on the recorded aria-label)**

## Verdict

**Gate: COMPOUNDS.**

The library's brain-served path + ladder promotion **fire as designed** on this fixture. The moat mechanism is not inert here: after five successful HIGH-verified heals of the same authored step, the sixth run skips the matcher entirely and acts on the cached selector, verified against a live-uniqueness re-check. Cross-key corpus growth is monotonic — the brain caches every real-anchor heal it produces, one per authored key, with no cross-key contamination and no false-heals.

Two nuances worth naming:

1. **Wall-time difference on L2 is negligible** (~5 ms). The matcher on this fixture is fast; skipping it doesn't buy visible latency. The library's compounding-value story on this drift shape is *safety and simplicity of the emitted output* — one selector per key, deterministically re-served — not raw throughput.
2. **The healed selector is the NEW testid** (`toolbar-rect-v2`), same as A1 (phase R min). A consuming test would still need to persist this back to source. The brain closes that loop within the session's process; cross-session durability is out of scope for this chip (single-process seed only).

## What this run did NOT test

- Cross-session durability (brain snapshot to disk, re-hydrate in a later process).
- False-heal firewall on a drift shape where the brain SHOULD demote — the ladder's aggressive demote (`DEMOTE_AT=1` → evict) is documented but not exercised here (every run PASSed).
- Any drift where the emitted selector would fail `isRealAnchor` (e.g. a `role=button[name=...]` fallback) — every case here had a real-anchor testid available. On a drift shape where the matcher must fall back to role+name, the brain would refuse to cache and the "N-th ≠ 1st" story would not hold. That is a separate matrix.
- Any target other than Excalidraw.

## Recommended next move

**The moat mechanism works on Excalidraw's toolbar-button fixture.** The two honest next cruxes:

- **Bring-your-own-app is now defensible** — the mechanism has been shown to fire under a realistic drift. A single-app compounding proof is enough evidence to attempt a second app with a different anchor discipline (a table with 20+ row actions, or a form with 10+ fields), to see whether compounding also emerges *at the corpus level* (many keys, not just one).
- **Exercise the demote path**: introduce a drift class after run 6 that causes the cached selector to fail (delete the mutated testid on run 7). Expect: ladder demotes+evicts on the FAILED outcome, run 8 cold-starts back to matcher. That's the false-heal firewall we haven't yet observed.

## Reproduce

```bash
cd experiment
git checkout claude/phase-r-compounding
node harness/bundle-library.js
URL_TARGET=http://localhost:3002/ node harness/compounding.mjs
cat logs/compounding.jsonl | wc -l  # 11 run rows + 1 SUMMARY
```

Env: `cd experiment/target_repo/excalidraw-app && VITE_APP_PORT=3002 ../node_modules/.bin/vite`.
