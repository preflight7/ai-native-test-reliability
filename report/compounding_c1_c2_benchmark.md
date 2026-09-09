# Phase R — Compounding chip, per-run detail

**Date:** 2026-09-09
**Log:** `experiment/logs/compounding.jsonl` (11 rows + 1 SUMMARY).
**Library:** `c8d47aa`, submodule on `feature/heal-policy`.
**Target:** Excalidraw @ `e1bb9ff8` on `:3002`.

Companion to `compounding_c1_c2_executive.md` — this is the row-level detail (brain / ladder counters, healedSelector, identity hash, matchOut) at each step boundary.

## Phase C1 — 6 runs, `toolbar-rectangle` → `toolbar-rect-v2`, `testId=C1-rect`, `stepId=clickRect`

Recorded anchor: `bestLocator=[data-testid='toolbar-rectangle']` (descriptor keys: role, tag, name, type, testid, cls). Identity: `button||Rectangle|Rectangle — R or 2` → hash `bd6395e9de94`.

| run | brainSize (before) | ladder rec (before) | tier (before) | servedBy | matchOut.verdict / via | healedSelector | ladder action | ladder rec (after) | tier (after) | outcome | brainIngested | brainSize (after) | wall_ms |
|---:|---:|---|---|---|---|---|---|---|---|---|---:|---:|---:|
| 1 | 0 | none | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-rect-v2']` | success | `{s:1,f:0}` | L1 | PASS | true | 1 | 530 |
| 2 | 1 | `{s:1,f:0}` | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-rect-v2']` | success | `{s:2,f:0}` | L1 | PASS | true | 1 | 526 |
| 3 | 1 | `{s:2,f:0}` | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-rect-v2']` | success | `{s:3,f:0}` | L1 | PASS | true | 1 | 529 |
| 4 | 1 | `{s:3,f:0}` | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-rect-v2']` | success | `{s:4,f:0}` | L1 | PASS | true | 1 | 527 |
| 5 | 1 | `{s:4,f:0}` | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-rect-v2']` | success | `{s:5,f:0}` | **L2** | PASS | true | 1 | 525 |
| 6 | 1 | `{s:5,f:0}` | **L2** | **brain** | — (skipped) | `[data-testid='toolbar-rect-v2']` | success | `{s:6,f:0}` | L2 | PASS | true | 1 | 522 |

Identity hash on the acted element was `bd6395e9de94` on all 6 runs.

## Phase C2 — 5 runs, 5 buttons, all mutated

Each run threads a different `testId`; brain and ladder both persisted from Phase C1's final state (brain already has `C1-rect:clickRect`).

| run | testId       | mutated testid          | expected aria-label | brainSize (before) | tier (before) | servedBy | matchOut.verdict | healedSelector                              | identity        | ladder action | ladder rec (after) | tier (after) | outcome | brainSize (after) | wall_ms |
|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---|---:|---:|
| 1 | `C2-rect`    | `toolbar-rect-v2`    | Rectangle | 1 | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-rect-v2']`    | `bd6395e9de94` | success | `{s:1,f:0}` | L1 | PASS | 2 | 525 |
| 2 | `C2-ellipse` | `toolbar-ellipse-v2` | Ellipse   | 2 | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-ellipse-v2']` | `c26697be0df8` | success | `{s:1,f:0}` | L1 | PASS | 3 | 528 |
| 3 | `C2-diamond` | `toolbar-diamond-v2` | Diamond   | 3 | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-diamond-v2']` | `31c3e95cfa53` | success | `{s:1,f:0}` | L1 | PASS | 4 | 526 |
| 4 | `C2-arrow`   | `toolbar-arrow-v2`   | Arrow     | 4 | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-arrow-v2']`   | `51d46cf0f575` | success | `{s:1,f:0}` | L1 | PASS | 5 | 524 |
| 5 | `C2-line`    | `toolbar-line-v2`    | Line      | 5 | L1 | matcher | heal (tier=testid) | `[data-testid='toolbar-line-v2']`    | `903230ae4663` | success | `{s:1,f:0}` | L1 | PASS | 6 | 526 |

Note: brainSize after C2 is 6, not 5 — the C1 rectangle entry (`C1-rect:clickRect`) carried over from Phase C1 and Phase C2's first run happened to be the same button under a different `testId` (`C2-rect:clickRect`), producing a second real-anchor entry keyed by test identity. The C2-only slice is 5 new entries.

## Final brain snapshot (after Phase C2)

Keys (test identity → cached locator, all `confidence=HIGH`, `policy=auto`):

- `C1-rect:clickRect`    → `[data-testid='toolbar-rect-v2']`
- `C2-rect:clickRect`    → `[data-testid='toolbar-rect-v2']`
- `C2-ellipse:clickEllipse` → `[data-testid='toolbar-ellipse-v2']`
- `C2-diamond:clickDiamond` → `[data-testid='toolbar-diamond-v2']`
- `C2-arrow:clickArrow`  → `[data-testid='toolbar-arrow-v2']`
- `C2-line:clickLine`    → `[data-testid='toolbar-line-v2']`

## Final ladder snapshot

- `C1-rect:clickRect`    → `{successes:6, failures:0, observations:6}` → tier L2
- `C2-rect:clickRect`    → `{successes:1, failures:0, observations:1}` → tier L1
- `C2-ellipse:clickEllipse` → `{successes:1, failures:0, observations:1}` → tier L1
- `C2-diamond:clickDiamond` → `{successes:1, failures:0, observations:1}` → tier L1
- `C2-arrow:clickArrow`  → `{successes:1, failures:0, observations:1}` → tier L1
- `C2-line:clickLine`    → `{successes:1, failures:0, observations:1}` → tier L1

## Observations

- **Every heal emitted a real anchor** (`[data-testid='...']`). `isRealAnchor` accepted every `put()` — none of the runs exercised the role+name fallback where the brain would refuse to cache.
- **The matcher's tier field was `testid` on every run** — the library located each mutated button by its (new) testid alone, which was unique. Aria-label was available as a corroborating anchor but the emitted selector didn't need it.
- **Ladder counters advanced only on HIGH-verified PASS** — every step here met that bar, so every `record()` produced `action:'success'`. No demote/evict was observed. The false-heal firewall's demote path is documented but unexercised by this chip.
- **Wall-time is flat at ~525 ms per run** across all 11 runs — the matcher itself is not the bottleneck on this fixture; the fixed cost is Playwright navigation + React hydration wait. On this specific target the L2 shortcut is not a latency win, only a re-match-skip.
