# Gap E — Control-Flow (While / If / IF-ELSE) is a runner-level concern

## Why the self-heal adapter is the wrong place to fix this

The library's `matchStep` and our Playwright adapter operate on a **single step
instance**: one authored `_anchor`, one live DOM scope, one match, one act.
Control-flow constructs (loop, conditional, branch) are **compositions of
steps** — they interleave, repeat, or skip step instances. Nothing about the
matcher's identity math changes across a loop iteration; what changes is
*which step instance is being executed and how many times it has been executed
in this run*.

Concretely, three concerns show up only at the runner level and cannot be
resolved by the matcher:

1. **Which of N candidate steps runs next.** An `If` node picks one of two
   subtrees based on a predicate evaluated against runtime state. The matcher
   does not see the predicate; the runner does.
2. **How many times a step runs.** A `While` node runs its body until a
   predicate becomes false. Each iteration produces a fresh step instance with
   the same authored `stepId`. The matcher has no notion of iteration count.
3. **Brain-key collision across iterations.** The brain keys records by
   `testId + ':' + stepId`. Two iterations of the same authored step inside a
   `While` share a `stepId`. If iteration 1 cached a locator, iteration 2 hits
   the cache — but the intended target for iteration 2 may be a *different*
   element (e.g. "click the Nth row"). Silent wrong-element reuse.

## What the adapter needs from a runner

A minimal contract that lets the adapter interleave healed steps inside
control flow *without* mixing keys or violating the K8 abstain-on-ambiguity
discipline:

```
Runner -> Adapter, per step invocation:
  {
    stepInstanceId: string,     // unique per (authored stepId × loop iteration × branch)
                                // e.g. "openMenu#while:0", "openMenu#while:1", "submit#if:then"
    authoredStepId: string,     // the original stepId from the fixture
    iterationCtx?: {            // present only inside a loop/branch
      construct: 'while' | 'for' | 'if' | 'ifElse',
      iteration?: number,       // 0-indexed, present for loop constructs
      branch?: 'then' | 'else', // present for conditional constructs
    },
    anchor: _anchor,            // as today, plus optional per-iteration scope hint
  }
```

The adapter then keys the brain with `stepInstanceId` rather than
`authoredStepId`. A policy pin, however, stays on the authored id — an
operator saying "never heal `openMenu`" means *every iteration of every
`openMenu`*, not the first one only. So the adapter needs both:

- **Cache reads/writes**: `brain.get/put(testId, stepInstanceId, ...)`
- **Policy reads**: `brain.getPolicy(testId, authoredStepId)`

Two keys, one record space. This mirrors how a compiler keeps distinct
per-invocation locals for the same source-level variable inside a loop while
the *declaration* still lives at the source-level scope.

## What we are NOT doing here

We are not writing a runner. The library ships without one on purpose —
authoring tools (Playwright test files, Cypress, Testsigma-shaped DSLs) all
have their own control-flow semantics, and the self-heal library slots
underneath any of them. The adapter's job is to be call-shaped enough that a
runner can drive it with the per-invocation context above.

## Concrete follow-on tickets

1. **Adapter**: extend `runTrial` (and any future per-step API) to accept
   `stepInstanceId` and thread it into the brain call sites. Default to
   `authoredStepId` when absent (current behavior — one iteration per test).
2. **Brain**: no change needed. `key(testId, stepId)` already treats stepId as
   opaque; the runner supplies whatever string it wants.
3. **Policy semantics doc**: state explicitly that `setPolicy` is authored-id
   scoped, not instance-id scoped. Add a test that a `never_heal` pin blocks
   every iteration of a loop-hosted step.
4. **Runner reference impl (optional)**: a thin `runFlow(node, adapter)`
   sample that walks a `While/If` AST and calls the adapter with the right
   `stepInstanceId` per invocation. Not part of the library; lives in the
   authoring-tool integration.

## One-paragraph summary

Control-flow is composition of steps, not a matcher concern. The self-heal
library's identity math is per-instance and stateless across iterations; the
only invariant it needs from a runner is that concurrent iterations of the
same authored step present as distinct brain keys (via a per-invocation
`stepInstanceId`) while policy pins remain keyed to the authored step so an
operator's decision applies to every iteration. That interface change is a
one-line signature extension on the adapter and zero change to the library —
which is why writing an entire runner here would be overreach.
