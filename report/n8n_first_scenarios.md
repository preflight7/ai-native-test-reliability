# n8n first scenarios — 3 inline steps executed

**Date:** 2026-09-09
**Target:** n8n 1.60.0 at `http://localhost:5678`, workflow editor page (`/workflow/new`), post-owner-account setup, overlays cleared.
**Library:** submodule at `dded40e` on `feature/heal-policy` (includes matchAndEmit + heal_policy + NEW `data-test-id` recognition).
**Mode:** live in Browser pane; each step verified with returned JSON.

## Step 1 — Library extension: WEB.testid recognizes `data-test-id`

Added `data-test-id` to the recognized test-id attribute list in `selfheal-core.js`. New field `testidAttr` stores which attribute a live element uses, so `bestLocator` emits with the matching attribute name (previously always `data-testid`, which wouldn't resolve against `data-test-id` elements).

Committed on `feature/heal-policy` as `dded40e`. Pushed to `preflight7/ai-for-qa`. Submodule pointer bumped in parent `claude/phase-r-compounding` as `9f10822`. Bundle regenerated (`data-test-id` appears 3× in the concatenated output). Verified in the browser: `extract` on `[data-test-id="workflow-name-input"]` correctly captured `testid: "workflow-name-input"` + `testidAttr: "data-test-id"`, and `bestLocator` emitted `[data-test-id='workflow-name-input']` (hyphenated).

**Integration issue #1: RESOLVED.**

## Step 2 — Author a test on workflow-name-input

Captured anchor via `SELFHEAL.captureStep`. Descriptor:
```
role:   {v: "span",  st: 0.9}   ← already a red flag
tag:    {v: "span",  st: 0.5}
testid: {v: "workflow-name-input", st: 0.95}
```
n8n's workflow-name is a `<span>`, not `<input>` — inline-edit widget. No aria-label, no visible text, no name.

## Step 3a — N-A1 on workflow-name-input: ALL PATHS FAIL

Renamed the testid via `page.evaluate setAttribute` (post-load, doesn't fight React reconciliation since JSX-declared value is unchanged). Ran L / N / S paths, N=3 each.

| path | 3/3 outcome | detail |
|---|---|---|
| L | 0/3 FAIL, verdict=fail, diagnosis=`no-identity`, score=0 | matcher found ZERO candidates matching the descriptor |
| N (naive: various guesses) | 0/3 FAIL | tried `[aria-label="Workflow name"]`, `[data-testid="workflow-name-input"]`, `[class*="workflow-name"]`, `input[placeholder*="workflow"]` — none matched |
| S (strict recorded) | 0/3 FAIL | testid drifted, obviously |

**Integration issue #2 surfaced: `WEB.candidates` filter is too narrow.** The library iterates `input, button, a, select, textarea, [role]` for candidates. Role-less `<span>` elements never enter the pool. Under drift the element becomes invisible to the matcher — score=0, no candidate to rank. **This is a real library gap for Vue-heavy / inline-editable apps** which use non-standard-role elements as widgets.

Options for the fix: extend `WEB.candidates` to also include `[data-testid], [data-test-id], [data-test], [data-cy]` so any elements that carry a test-id enter the pool regardless of role. Small change (~5 LOC on `feature/heal-policy`). NOT applied yet — surfaced for review.

## Step 3b — N-A1 on `execute-workflow-button` (proper `<button>`): L < N

Pivoted to `execute-workflow-button` — a real `<button>` in the candidate pool, visible text "Test workflow", n8n's Element Plus classes on it. Same drift (testid rename). N=3 each.

| path | 3/3 outcome | detail |
|---|---|---|
| L | **0/3 ABSTAIN** | score 0.493, margin 0. Another button on the page ties. K8 discipline: refuse-rather-than-guess. |
| N (`getByRole('button', {name:'Test workflow'})`) | **3/3 PASS** | unique match, same physical element (identity hash matched all 3 runs) |
| S (strict recorded testid) | 0/3 FAIL | testid drifted |

**First honest "Library < Naive" cell on a real fixture.** The library correctly abstains because n8n's other Element Plus buttons match the descriptor's role/tag/name-partial closely enough to tie the margin. `getByRole` with the visible text uniquely resolves the button — plain Playwright semantics win.

Why the library ties: n8n's execute button carries hashed Element Plus classes (`_button_yut61_229 _primary_yut61_489 ...`). `looksHashed` drops class stability to 0.08. Other buttons share the same base classes at similar fuzzy match. The recorded name "Test workflow" gets weight 0.5 — real, but not enough to break the tie with other role=button candidates. Meanwhile `getByRole` uses accessible-name computation which is exact-string-match and unique on this page.

## Cross-cutting findings

- **`data-test-id` fix works and unblocks n8n** — but on its own doesn't create library value.
- **`WEB.candidates` filter is a real gap on Vue/inline-edit apps** — the ~5-LOC fix should be included in the next library commit. Without it, most n8n non-button elements are invisible to the matcher.
- **First negative-value cell on a real fixture (N-A1 on execute-workflow-button).** The library's disambiguation caution costs it a heal that plain `getByRole` gets for free. The SaaS pitch on "we heal cold-start drifts" continues to weaken with each fresh test. The plugin's positive-value story keeps concentrating in: (1) compounding cache-and-skip (C1 on Excalidraw), (2) identity oracle catching wrong-identity heals (B2), (3) named-abstain attribution for Claude debug cycles (B1). Cold-start attribute heal has not shown value.

## Live state after this run

- n8n dev server: still running at `:5678`, workflow editor open in browser pane
- Aux bundle server: running at `:8765`
- All drifts reverted (both testids restored on the two buttons touched)
- `experiment/lib` submodule dirty pointer bumped locally + pushed to fork
- Working tree of parent has 1 modified file (submodule pointer, already committed as `9f10822`)

## Recommended next 2 moves (not yet done)

1. **Fix the `WEB.candidates` filter** on `feature/heal-policy` — extend to include test-id-bearing elements regardless of role. Small; unblocks most of n8n's UI.
2. **Try a scenario where library SHOULD beat naive on n8n** — e.g., a sidebar `menu-item` that shares its testid with other menu items (real ambiguity that `getByRole` can't resolve without ordinal or scope). If library abstains cleanly there while naive picks the wrong one, that's a real value story.
