# Three Gaps Closed — heal_policy, iframe-scope, control-flow

**Date:** 2026-09-03
**Branch (worktree):** `feature/three-gaps`
**Branch (library submodule):** `feature/heal-policy`
**Pinned SHAs**
- Library baseline: `a31ace4`
- Library head (this work): commit `599dca1` on `feature/heal-policy`
- Target: `e1bb9ff8f8931e783c11d104abb8967ac6605c9a` (Excalidraw)

---

## Gap I — `heal_policy` that sticks (per-key `auto` / `review_only` / `never_heal`)

**What changed.** [lib/self-heal/brain/brain.js](lib/self-heal/brain/brain.js)
gained a per-key `policy` field (defaults to `auto`) plus `setPolicy(testId,
stepId, policy)` and `getPolicy(testId, stepId)`. Policy is persisted on the
same record as `{locator, confidence}` and preserved across `put()` calls, so
an operator can pin a policy on a step that has never healed. The Playwright
adapter
([harness/selfheal-playwright-runtime.js:130](harness/selfheal-playwright-runtime.js:130))
now checks policy **before** calling the matcher: `never_heal` returns an
`ABSTAIN`-shaped row with `category='POLICY'`, no matcher call, no click;
`review_only` runs the matcher, records the candidate `bestLocator`, but
short-circuits to `outcome='REVIEW'` before the trusted click.

**What a test confirms.** A fourth trial in
[harness/run_trials.js](harness/run_trials.js) reapplies `mut_A1` (which
otherwise heals cleanly) with `policies: { openMenu: 'never_heal' }`. Result:
`outcome=ABSTAIN verify=NONE category=POLICY healed=false false_heal=false`,
zero click attempts, matcher never invoked. Gate assertion `never_heal_blocks`
passes. A unit-level smoke on `setPolicy/getPolicy` (bogus values rejected,
default is `auto`, put() preserves an existing policy) also passes.

**What remains.** No `review_only` end-to-end trial yet — the surface is
wired, but proving it emits a reviewable candidate row while suppressing the
act needs a UI/queue on the other side. Also, policy is only in-page state in
this adapter (via `window.__TRIAL_BRAIN`) — persistence across sessions is a
runner concern, not a library concern.

---

## Gap L — iframe-scope enforcement

**What changed.** The `_anchor.framePath` field (previously carried but
ignored) is now honored. A new `resolveFrame(page, framePath)` in the adapter
walks each hop as a `frameLocator`, asserts uniqueness (`count() === 1`) at
every level, then materializes a Playwright `Frame` via
`bodyLocator.elementHandle().ownerFrame()`. The matcher, the `still-resolves`
probe, and the trusted click all now target that `Frame` — never the parent
document. `framePath: []` is a no-op that returns `page.mainFrame()`, so
existing single-frame trials behave identically.

**What a test confirms.**
[harness/scout-iframe.mjs](harness/scout-iframe.mjs) mounts a self-contained
`data:text/html` fixture with a `#target` button in the parent doc AND a
different `#target` button inside an `<iframe id="f1">`. Three assertions:
(a) framePath=`['#f1']` resolves to the child frame and heals to `child-btn`;
(b) framePath=`[]` heals to `parent-btn` in the main frame; (c) presenting
the child anchor with framePath=`[]` (wrong doc) makes the matcher
**abstain** — no false crossing. All three pass. No target-app change was
needed; the spike is Excalidraw-independent.

**What remains.** The `authored-test.json` fixture has `framePath: []`
throughout — Excalidraw's menu-trigger lives in the main doc, so no live
iframe trial in `run_trials.js` yet. A future iframe-hosted target (or a
prepared Excalidraw patch that mounts one) would exercise the path
end-to-end. The isolated spike is sufficient proof of the mechanism.

---

## Gap E — control-flow (While / If / IF-ELSE)

**What changed.** Nothing in code. See
[report/gap_E_control_flow.md](report/gap_E_control_flow.md) for the argument
that control-flow is a runner-level concern (composition of step instances),
not a matcher concern (identity math per instance). The spec pins down the
minimal contract the adapter needs from any runner: a per-invocation
`stepInstanceId` for cache keying, with policy pins staying on the authored
`stepId` so a `never_heal` decision applies to every iteration of a
loop-hosted step. Two keys, one record space.

**What a test confirms.** N/A — spec only. Follow-on tickets in the report
name what would need to move next: adapter signature extension, a
policy-scope test, and (optional, downstream) a thin `runFlow` reference
implementation belonging to whichever authoring layer wraps the library.

**What remains.** The runner itself, and the ecosystem call about which
authoring layer (Playwright test files, a Testsigma-shaped DSL, a homegrown
AST) hosts it. Not our call to make from inside the library.

---

## Reproducing

```bash
cd experiment
node harness/bundle-library.js         # rebundle the library after the brain change
node harness/scout-iframe.mjs          # Gap L spike (self-contained)
# Requires Excalidraw dev server on :3001:
node harness/run_trials.js             # 4 trials incl. never_heal_A1
cat logs/trials.jsonl
```

## What is NOT claimed

- Not a benchmark; N=4 trials on one target.
- `review_only` was not end-to-end exercised (surface only).
- No iframe trial against a real app; the spike uses `data:text/html`.
- No runner shipped for Gap E.
