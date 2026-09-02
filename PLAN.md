# Plan reference

Canonical plan lives at `/Users/prashant/.claude/plans/think-about-this-share-dynamic-lobster.md`.
This file is a pointer to keep the experiment directory self-describing.

## P1 (in progress)
- P1.1 scaffold + submodule (done)
- P1.2 Excalidraw + dev server (30-min cap)
- P1.3 bundle-library.js
- P1.4 translate-locator.js + tests
- P1.5 selfheal-playwright-runtime.js
- P1.6 authored-test.json
- P1.7 mut_A1 + mut_B1 patches (B1 = remove+swap-identity, per Mock-2)
- P1.8 run 2 trials trusted-only, check gate

## Recorded SHAs
- `lib` (prashantkothari/ai-for-qa): `a31ace4f199fa3824ba374208c8cc2a9b6f4e4ea`
- `target_repo` (excalidraw/excalidraw): `e1bb9ff8f8931e783c11d104abb8967ac6605c9a` (recorded 2026-09-02)

## Gate metric
`sum(false_heal) == 0` across all trials, per `lib/self-heal/schemas/false-heal.js` `isFalseHeal()`.
