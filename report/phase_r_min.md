# Phase R (minimum) — A1 three-way comparison

**Date:** 2026-09-09
**Branch:** `claude/phase-r-min`
**Target:** Excalidraw @ `e1bb9ff8` under `prep_aria.patch` + `mut_A1.patch` (rename `data-testid="main-menu-trigger"` → `"menu-trigger-v2"`; aria-label `"Menu"` preserved).
**Library:** submodule @ `599dca1` on `feature/heal-policy`.

## Numbers

| Path | Description | Heal-rate | Wall p50 |
|---|---|---:|---:|
| **L** — Library adapter | Full self-heal pipeline via `runTrial()` | **5/5** | 3069 ms |
| **N** — Naive role locator | `page.getByRole('button', {name:'Menu'})` | **5/5** | 3073 ms |
| **S** — Strict control | `page.locator('[data-testid="main-menu-trigger"]')` | 0/5 | 7150 ms (timeout) |

- Same-element-clicked ratio (L identity hash vs N identity hash): **5/5** (`fc9fb748653f` on every run)
- Latency delta L vs N: **~30 ms** (noise-band)
- Randomized schedule: `S4 S2 N3 S3 N2 N5 N4 S1 S5 N1 L2 L5 L1 L4 L3` (fresh Playwright context per run)

## What the library actually did

L's healed selector on all 5 runs: `[data-testid='menu-trigger-v2']` — the **new** testid. The matcher scored candidates using the recorded descriptor (testid=`main-menu-trigger`, aria=`Menu`) but the winning candidate's serialized `bestLocator` came from *its* current features. So the mechanism was: aria-label (weight 0.85) + role + tag + class fuzzy → highest score on the mutated menu-trigger → serialize back to the winner's new testid.

This is not the "role+name fallback" narrative I've been telling — it's "attribute-weighted candidate ranking followed by re-serialization to the winning candidate's strongest available anchor." The heal produces a *new* testid string that any consuming test would need to persist.

## Verdict

**Gate outcome: Library ≈ Naive** (both 5/5, same physical element, no measurable latency win).

On A1 — the one mutation we've proven produces real signal — the self-heal library does not beat `page.getByRole('button', {name:'Menu'})`. Two things worth naming honestly:

1. **The naive path is arguably more resilient** than L on this drift class: `getByRole` reads a semantic property that survives the drift and never needs updating; L emits a new testid selector that a persisting test would need to write back.
2. **The library's value proposition on this drift class needs a different story** than "heals what Playwright can't." Candidates: heals **when aria-label is also missing** (D1-like drift), heals **when multiple similar candidates exist** (real duplicate injection, D4-like), or catches wrong heals via `false_heal` firewall (which requires drift where heal should refuse, not where it should succeed).

## What this run did NOT test

- Ambiguity firewall (real DOM duplicates, not the inert B2)
- Compounding (fresh context per run; brain disabled by design here)
- Drift where naive `getByRole` would fail (aria-label also renamed / removed; role changed; role+name ambiguous)
- Anything on any app other than Excalidraw

## Recommended next move

Do not bring-your-own-app yet. The library's positive-value story is unclear on this drift class; validating on a user's real app before we can articulate that story would risk showing the same "library ≈ naive" result on their higher-stakes fixture.

Better next crux: run a **fourth path** on the same fixture with aria-label ALSO removed (i.e. drop the prep_aria half of the baseline). Under that condition N should fail (no accessible name to match by) and L should heal via class fuzzy or fail. That's the condition where L would have a positive story to tell, or where its inability to heal becomes a real limitation.

## Reproduce

```bash
cd experiment
git checkout claude/phase-r-min
git -C target_repo apply "$PWD/mutations/prep_aria.patch" "$PWD/mutations/mut_A1.patch"
sleep 3
node harness/bundle-library.js
node harness/compare_a1.js
cat logs/compare_a1.jsonl
```
