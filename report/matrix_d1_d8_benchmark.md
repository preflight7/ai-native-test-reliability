# Phase R matrix — D1..D8 per-drift benchmark

Per-drift table. Latencies are p50 across N=5 runs. `wall p50 Δ` = L p50 − N p50.

| drift | L heal-rate | N heal-rate | S heal-rate | same-elem (L vs N) | wall p50 Δ (L−N) | L healed selector | notes |
|---|---:|---:|---:|---:|---:|---|---|
| **D1** rename `data-testid` | 5/5 | 5/5 | 0/5 | 5/5 | +15 ms | `[data-testid='menu-trigger-v2']` | Both L and N reach the same button. S times out (7141 ms p50). Reproduces phase-r-min. |
| **D2** rename className | 5/5 | 5/5 | 5/5 | 5/5 | −13 ms | `[data-testid='main-menu-trigger']` | Inert drift for this test — testid still matches so all three paths pass. Class churn does not affect the anchor. |
| **D4** rename testid AND aria-label | 5/5 | 5/5 | 0/5 | 0/0 | +24 ms | `[data-testid='menu-trigger-v2']` | ⚠️ N still passes. Playwright's accessible-name computation matched *something* labeled "Menu" that the JS mirror comparator couldn't find (probable candidate: the SVG hamburger icon's own aria-label, or a title attribute on the button that survives). Same-elem cannot be computed here until the identity comparator is fixed. |
| **D5** delete testid | **0/5** | 5/5 | 0/5 | 0/0 | −878 ms | `[data-testid='dropdown-menu-button']` (ambiguous — 2 matches) | ⚠️ Library serializes to the underlying radix component's testid, which matches BOTH the main-menu trigger AND the `More tools` trigger. Playwright strict-mode throws on click. Adapter records `adapter-error`. Ambiguity firewall did not fire before selector emit. Fast-fail (~2 s) because strict-mode error is instant. |
| **D6** delete aria-label | 5/5 | 0/5 | 5/5 | 0/0 | −4071 ms | `[data-testid='main-menu-trigger']` | Aria drift — N times out; L heals via testid (still present, unique). S also passes (testid intact). L faster than N by construction (N times out at 5000 ms). |
| **D7** aria-label "Menu" → "Options" | 5/5 | 0/5 | 5/5 | 0/0 | −4078 ms | `[data-testid='main-menu-trigger']` | Same as D6 — N fails on wrong accessible name, L unaffected because testid unchanged. |
| **D8** add `role="link"` | 5/5 | 0/5 | 5/5 | 0/0 | −4103 ms | `[data-testid='main-menu-trigger']` | Explicit `role="link"` overrides implicit `button` role. `getByRole('button')` no longer matches the trigger. L via testid untouched. |

## Latency block

- All L PASS cells are within ~30 ms of each other (~3020–3050 ms p50). The library adds negligible overhead when it succeeds; the click-verify path dominates.
- N PASS cells: ~3000–3050 ms p50. Statistical tie with L on drifts where both succeed.
- N FAIL cells: ~7100 ms p50 — dominated by a single 5000 ms strict-locator timeout plus warm/verify overhead.
- S PASS cells: ~2180 ms p50 (no library injection, no matcher work).
- S FAIL cells: ~7130 ms p50 (5000 ms timeout + navigation).
- D5 L FAIL: ~2160 ms — strict-mode ambiguity error is thrown immediately by Playwright, no waiting.

## Per-drift L healed-selector detail

Each drift emitted the same selector on all 5 L runs (deterministic in this configuration):

| drift | selector serialized by library |
|---|---|
| D1 | `[data-testid='menu-trigger-v2']` |
| D2 | `[data-testid='main-menu-trigger']` |
| D4 | `[data-testid='menu-trigger-v2']` |
| D5 | `[data-testid='dropdown-menu-button']` (⚠️ 2 matches on page) |
| D6 | `[data-testid='main-menu-trigger']` |
| D7 | `[data-testid='main-menu-trigger']` |
| D8 | `[data-testid='main-menu-trigger']` |

The heal path prefers testid every time — even on D5 where it walks up to the radix underlying testid and produces an ambiguous locator. It does not fall back to role+name once a testid candidate is available.

## What this does NOT test

- Ambiguity conditions where multiple testids collide by design (a real duplicate-testid injection in application code).
- Structural drift (element reparenting, wrapping) — that's D9-D17 territory.
- Text-content drift (button label text changing without aria-label changing).
- Compounding across runs (brain persistence — deliberately disabled here; fresh context per run).
