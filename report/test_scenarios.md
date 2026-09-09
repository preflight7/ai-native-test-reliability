# Test scenarios — Claude+Playwright vs Claude+Playwright+Plugin

**Purpose:** enumerate the scenarios that make the plugin's value proposition visible or invisible. Framing: baseline is a Claude agent writing/running PW tests and debugging locators when they break. With-plugin is the same agent + our self-heal wrapper, which auto-heals a subset of breakages without agent involvement.

**Value = breakages the plugin heals cleanly × cost of Claude debugging cycle avoided.**
**Cost = breakages the plugin false-heals × cost of a wrong-element click reaching production.**

## Scenarios (grouped)

### A — Baseline capability

| id | scenario | tests |
|---|---|---|
| A1 | pristine test passes both paths | zero drift; sanity baseline |
| A2 | testid rename → plugin heals; PW alone would timeout | the "plugin saves Claude a debug cycle" case |
| A3 | className rename (inert on test) → both paths pass | control; confirms churn tolerance |

### B — Ambiguity + honest failure (the plugin's OTHER value: named-abstain)

| id | scenario | tests |
|---|---|---|
| B1 | testid deleted, surrounding testid shared with sibling → plugin abstains with `diagnosis:'ambiguous-emit'` and `emitCount:2`; PW alone throws strict-mode with less info | plugin gives Claude/human a named reason to intervene; PW alone forces DOM archaeology |
| B2 | element renamed to a completely different-identity button in same slot → plugin should refuse to heal (identity mismatch); PW alone would click the imposter and report PASS silently | **silent-fail catch — the "false PASS" that makes CI green while product is broken** |
| B3 | recorded element removed entirely, no candidate scoring above threshold → plugin abstains with `category='REMOVAL'`; PW alone timeouts with no attribution | attribution quality |

### C — Compounding (cache-and-skip)

| id | scenario | tests |
|---|---|---|
| C1 | same button drifted, rerun 6 times, brain persists → runs 1-5 matcher-served, run 6 brain-served | ladder + cache mechanism (already ran, positive result) |
| C2 | 5 different toolbar buttons, drift once each, brain persists → brain accumulates 5 entries | corpus width |
| C3 | **demote-path** — same as C1 but on run 6 the healed testid is also removed → forces FAILED → plugin evicts the cached entry → run 7 cold-starts | verifies the DEMOTE_AT=1 aggressive-demote invariant is real |
| C4 | **cross-drift same element** — same button, apply D1, then D6, then D7 sequentially with brain persisting → does brain survive semantic diversity or just repetition? | tests whether the "compounding" is per-drift or generalizes |
| C5 | **poison test** — force a wrong-identity heal into brain, rerun → does re-verification catch the poison and evict? | brain trust invariant |

### D — Real production shapes (currently only single-flow toy tests done)

| id | scenario | tests |
|---|---|---|
| D1 | **form flow** — record login, fill fields, click submit; drift the submit button testid → plugin should heal; PW alone would need Claude to inspect | multi-step + user input + state change |
| D2 | **multi-step navigation** — menu → dialog → sub-item click; drift the sub-item after the dialog opens | context-sensitive locators + async open |
| D3 | **async/dynamic** — element appears after 500ms; drift renames it → plugin's `temporal-wait` lever vs PW's auto-wait | the T (temporal) failure class from the taxonomy |
| D4 | **iframe** — element in a nested iframe; drift on it → plugin's `resolveFrame` handles it; PW alone requires `frameLocator` chain the user must remember | scope discipline |
| D5 | **actionability** — button disabled at runtime after drift → plugin refuses with named reason; PW alone timeouts with "element not clickable" | state-vs-drift distinction |
| D6 | **trusted-event-gated interaction** — an element that only responds to `isTrusted=true` events (e.g. paste, drag) → plugin's trusted-click path succeeds; PW-synthetic (some hand-written tests) fails | the harness's own value beyond the library |

### E — Instrumented cost comparison (the actual pitch)

| id | scenario | tests |
|---|---|---|
| E1 | **Claude+PW baseline cycle** — I write a PW test, it breaks after A2-shape drift, I inspect DOM, rewrite selector, retest. Count: tokens spent, wall time, files touched | this is the cost the plugin claims to avoid |
| E2 | **Claude+PW+Plugin cycle** — same drift, plugin heals, Claude sees a passing test, zero intervention needed | delta = plugin value per breakage |
| E3 | **Claude+PW+Plugin honest-abstain cycle** — B1/B2-shape drift, plugin abstains with named diagnosis, Claude sees the diagnosis and intervenes with specific context (not DOM archaeology) | delta = better prompt for Claude when intervention IS needed |

## Grilling (post-first-draft self-review)

Attacks and adjustments:

- **B2 is the load-bearing scenario for anyone worried about auto-heal risk.** Without it we have no evidence the plugin refuses wrong-identity heals. Add explicit design: replace `<DropdownMenu.Trigger>` with a different-identity `<button>` in the same DOM slot (via `page.evaluate` post-load; peer verified React reconciliation cooperates with attribute-set on existing nodes) and confirm plugin identity oracle catches the swap.
- **E1/E2/E3 are the actual pitch scenarios but the hardest to instrument** because token count depends on Claude's specific debug approach for each app. Approximation: count MESSAGES + tool calls per fix cycle, not tokens. Report both baseline and plugin cycles for the same A2/B1/B2 drift on the same test file.
- **D6 (trusted-event-gated) is a real class** but hard to construct on Excalidraw — its drag/paste handlers don't obviously gate on isTrusted. Defer or skip.
- **C3 (demote) and C5 (poison) test invariants we've assumed but never observed.** Both cheap; both high-signal. Prioritize.
- **D1 form flow needs a target app with a login form. Excalidraw doesn't.** Either (a) build a tiny 40-line HTML fixture with a fake login form, run against `file://` or a tiny http-server (breaks "real app" purity but tests the flow), OR (b) defer to bring-your-own-app.
- **Missing: "the plugin costs money too."** Plugin adds a ~600ms per-run overhead (bundle inject + match round trip). Multiply across a 200-test suite = 2 minutes added. Report this cost, not just the debugging saved.
- **Missing: a case where the plugin IS WORSE than PW alone.** D5 was that until we fixed it. What's the current "L < N" case? Unknown — probably none in D1-D8 after the fix, but we haven't checked D9-D28. Should include a "we searched, we didn't find" line rather than pretend it doesn't exist.
- **N=5 (deterministic) is thin for anything claiming a heal-rate.** Every headline needs an "at N=5" qualifier or an N≥20 rerun.

## Live-demo coverage (subset chosen for the walkthrough)

Pick 4 scenarios that make the differentiator visible in ~10 min:

1. **A1** — pristine baseline, both paths pass. Ground truth.
2. **A2** — testid drift, plugin heals silently, no Claude needed. **The "saved cycle" case.**
3. **B1** — ambiguous emit, plugin abstains with named diagnosis, PW alone throws opaque error. **The "better-attribution-when-intervention-needed" case.**
4. **C1 abbreviated** — 3 sequential runs on the same drift showing the brain fill up + eventual promotion (skip to run 5→6 promotion since full 6-run in a demo is boring).

Each scenario runs in the Browser pane so you see the menu clicks land, hear the logs read out, and can question any step.

**Post-demo:** update this doc with anything new the live run surfaces.
