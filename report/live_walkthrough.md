# Live walkthrough — Claude+PW vs Claude+PW+Plugin, in the Browser pane

**Date:** 2026-09-09
**Target:** Excalidraw dev server @ `localhost:3002`. Library bundle served from a python http.server on `:8765` and script-tag-injected into the page.
**Mode:** live in the Browser pane; user watches each click; each finding captured from `javascript_tool` return values.

## Scenarios run

| # | Scenario | PW-alone outcome | Plugin outcome | Value delta |
|---|---|---|---|---|
| A1 | Pristine (no drift) | PASS 1488ms | PASS (n/a — no drift) | 0 Claude turns either way |
| A2 | testid rename (`main-menu-trigger` → `menu-trigger-v2`) | **FAIL** — timeout, recorded selector resolves to 0 elements | **HEAL** in 2ms; emitted `[data-testid='menu-trigger-v2']`; click + toggle verified in 603ms | 1 Claude debug cycle avoided |
| B1 | testid deleted → ancestor testid shared (D5-shape) | **FAIL** — either timeout OR strict-mode throw with 2 candidates on `dropdown-menu-button` | **ABSTAIN** in 2ms with `diagnosis:'ambiguous-emit', emitCount:2` | 1 Claude cycle still needed but with named attribution instead of DOM archaeology |
| C1 (6 runs) | 6× rewrite cycles under drift | 6× PASS; runs 1-5 matcher-served (successes 1→5, tier L1→L2 at run 5), run 6 **brain-served** (skip re-matching) | Ladder + cache mechanism observed live matching peer's chip; wall-time flat ~2000ms across all 6 (value is safety, not speed) |
| D3 | Async / dynamic — element hidden 500ms then reappears with drifted testid | **TIMEOUT** at 3000ms; the element does reappear but PW-alone kept polling for the original selector | **ABSTAIN** in 2001ms via temporal-wait lever; FOUND the drifted element (`[data-testid='menu-trigger-late']`) but scored 0.597 (below 0.62 heal threshold) → attribution abstain, not heal | Attribution win, not heal win on this fixture. Score dropped below threshold because scoring weights on this button don't clear the bar without testid; on aria-richer buttons the score would clear |
| D4 | iframe — target inside nested iframe with drifted testid | **FAIL twice** — page.locator misses the iframe entirely; frameLocator with the recorded testid still misses because it drifted. Two stacked problems for Claude to debug | **FAIL** with `diagnosis:'no-identity'` — framePath resolver correctly scoped to iframe, matchAndEmit ran there, scored the drifted button at 0.43 (below 0.45 abstain floor). One problem attributed instead of two | Attribution win — the plugin correctly navigated the frame boundary; scoring dropped below floor because the injected button descriptor was minimal (no cls, no id) |
| B2 | Imposter — real button hidden, imposter injected with SAME testid + different aria + no click handler | **SILENT PASS** (if test only checks click succeeded) OR **cryptic assertion FAIL** (if test checks sentinel) — clicked wrong element with no attribution | **HEAL emitted** (matcher fooled by testid, score 0.93) BUT **identity oracle catches mismatch**: recorded=`button\|button\|Menu\|` vs resolved=`button\|button\|Not the real menu\|imposter` → `false_heal=true` with attribution "clicked element identity does not match recorded" | **The safety-critical case.** Plugin doesn't heal better; it detects that its heal was wrong. Zero silent bad-clicks reach production — CONDITIONAL on the identity oracle being wired |

## What each scenario proved / didn't prove

- **A2** — **plugin's core value story.** On drift where a fallback anchor exists (aria-label), plugin heals silently and zero Claude cycles are needed. If the fallback DIDN'T exist, plugin would abstain (see D3 which was near-threshold).
- **B1** — plugin's **attribution value.** Under an ambiguous emit, plugin refuses cleanly with named diagnosis (`ambiguous-emit`, `emitCount:2`). Claude still has to intervene, but with a targeted question instead of DOM archaeology. Time saved per intervention is real.
- **C1** — plugin's **compounding + safety** story. After 5 successful heals on the same step, the ladder promotes L1→L2 and subsequent runs skip re-matching entirely. Wall-time doesn't drop (matcher isn't the bottleneck), but the surface area for matcher-wobble drops to zero.
- **D3** — the temporal-wait lever WORKED (found the late element in 2s vs PW's 3s timeout). Scoring didn't clear heal threshold on this specific button because it's aria/class-poor. On a richer button the plugin would heal.
- **D4** — the framePath resolver WORKED (matcher scoped to iframe correctly). Scoring didn't clear abstain floor because my injected descriptor was minimal. On a real fixture with a captured anchor from `captureStep`, the descriptor would be richer.
- **B2** — the **honest silent-fail differentiator.** PW-alone silently clicks imposters that carry the recorded testid; plugin's matcher is ALSO fooled by the testid, but the identity oracle in the adapter catches the mismatch. This makes the identity oracle non-optional infrastructure — without it the plugin has the same silent-fail vulnerability.

## Cross-cutting honest caveats

- **All plugin outcomes above ran the matcher via `matchAndEmit` (the D5-fix version) but bypassed the trusted-click adapter** — I used `document.querySelector(sel).click()` inline. The full adapter (`selfheal-playwright-runtime.js`) adds trusted events, retries, and screenshot capture — none of which changed the healing decisions in these demos.
- **N=1 per scenario except C1.** These are functional demonstrations, not benchmarks. For confidence, each scenario needs an N≥20 repeat with variance detection.
- **All identity oracles are inline mini-versions**, not the full R.1.a hash spec from the plan. The B2 imposter test used a tag+role+aria+text fingerprint, which happens to work here but would be blind to drifts that change aria (same D4 comparator problem).
- **Fixture-authored descriptors**. D3 and D4 used my hand-typed recorded descriptors instead of `captureStep` output. Real recorded blobs are richer and would score higher.

## What the demo did NOT test

- Multi-step tests where a heal in step 2 affects step 3's context
- Real user data (auth, forms, cross-page navigation)
- The `demote-path` (DEMOTE_AT=1 → evict)
- Cross-drift on the same element (D1 then D6 then D7 on same button)
- Regression: does the matchAndEmit fix cause any prior-passing case to newly fail?

## Environment state after walkthrough

- Excalidraw dev server: still running on `:3002` (background)
- Aux bundle server on `:8765`: killable via `lsof -i:8765 -t | xargs kill`
- `experiment/target_repo`: reverted clean (git status confirmed)
- Browser pane: still open at `localhost:3002` with the live app
