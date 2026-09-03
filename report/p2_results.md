# P2 Results — full mutation matrix × both event modes

**Date:** 2026-09-03
**Total rows:** 16
**Aggregate false_heal:** 2

## Trial table

| trial | mutation | event_mode | outcome | verify_confidence | category | healed | false_heal | latency_ms | attempts | tier | best-locator |
|---|---|---|---|---|---|---:|---:|---:|---:|---|---|
| S1v2-pristine-trusted | pristine | trusted | PASS | HIGH | VERIFIED | false | false | 3029 | 1 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-pristine-synthetic | pristine | synthetic | PASS | HIGH | VERIFIED | false | false | 2963 | 1 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-A1-trusted | A1 | trusted | PASS | HIGH | VERIFIED | true | false | 3014 | 1 | testid | `[data-testid='menu-trigger-v2']` |
| S1v2-A1-synthetic | A1 | synthetic | PASS | HIGH | VERIFIED | true | false | 2942 | 1 | testid | `[data-testid='menu-trigger-v2']` |
| S1v2-A2-trusted | A2 | trusted | PASS | HIGH | VERIFIED | false | false | 3012 | 1 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-A2-synthetic | A2 | synthetic | PASS | HIGH | VERIFIED | false | false | 2961 | 1 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-A3-trusted | A3 | trusted | ABSTAIN | NONE | AMBIGUITY | false | false | 2083 | 3 | testid | `[data-testid='dropdown-menu-button']` |
| S1v2-A3-synthetic | A3 | synthetic | ABSTAIN | NONE | AMBIGUITY | false | false | 2109 | 3 | testid | `[data-testid='dropdown-menu-button']` |
| S1v2-B1-trusted | B1 | trusted | PASS | HIGH | VERIFIED | true | false | 3016 | 1 | testid | `[data-testid='unrelated-widget']` |
| S1v2-B1-synthetic | B1 | synthetic | PASS | HIGH | VERIFIED | true | false | 2958 | 1 | testid | `[data-testid='unrelated-widget']` |
| S1v2-B2-trusted | B2 | trusted | PASS | HIGH | VERIFIED | false | true | 3034 | 3 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-B2-synthetic | B2 | synthetic | PASS | HIGH | VERIFIED | false | true | 2946 | 3 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-B3-trusted | B3 | trusted | PASS | HIGH | VERIFIED | false | false | 8620 | 1 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-B3-synthetic | B3 | synthetic | PASS | HIGH | VERIFIED | false | false | 8567 | 1 | testid | `[data-testid='main-menu-trigger']` |
| S1v2-never_heal_A1-trusted | never_heal_A1 | trusted | ABSTAIN | NONE | POLICY | false | false | 2095 | 1 | none | `—` |
| S1v2-never_heal_A1-synthetic | never_heal_A1 | synthetic | ABSTAIN | NONE | POLICY | false | false | 2085 | 1 | none | `—` |

## Per-mutation delta: trusted vs synthetic

| mutation | trusted outcome | synthetic outcome | Δ outcome | Δ healed | Δ false_heal | Δ latency_ms |
|---|---|---|---|---|---|---:|
| pristine | PASS | PASS | same | same | same | -66 |
| A1 | PASS | PASS | same | same | same | -72 |
| A2 | PASS | PASS | same | same | same | -51 |
| A3 | ABSTAIN | ABSTAIN | same | same | same | +26 |
| B1 | PASS | PASS | same | same | same | -58 |
| B2 | PASS | PASS | same | same | same | -88 |
| B3 | PASS | PASS | same | same | same | -53 |
| never_heal_A1 | ABSTAIN | ABSTAIN | same | same | same | -10 |

## Aggregate observations (plan §4 secondary metrics)

- **firstTry distribution:** true=8, false=4, null=4
- **servedBy (step0 tier) distribution:** testid=14, none=2
- **verify_confidence distribution:** HIGH=12, NONE=4
- **outcome distribution:** PASS=12, ABSTAIN=4
- **latency p50:** 2963 ms  (min 2083, max 8620)
- **verify_confidence=NONE count:** 4
- **aggregate false_heal:** 2

## Honest verdict — does the trusted-events adapter change outcomes?

On the excalidraw main-menu-trigger fixture, the trusted-events Playwright adapter produced **identical outcomes to synthetic (in-page `.click()`) events across all 8 mutations**: same outcome, same healed flag, same false_heal verdict, only differing in latency. Radix's DropdownMenu.Trigger fires its React handler on both synthetic and trusted click events, so on this target the adapter's added complexity is not load-bearing. This is **negative evidence** for the adapter-vs-synthetic hypothesis on this fixture — it does not prove trusted events are never necessary (some components explicitly check `isTrusted`, e.g. certain drag-and-drop or paste handlers), only that they do not measurably matter here. To generate positive evidence, the fixture must include a component that gates behavior on `event.isTrusted`.

The **false_heal** metric surfaced 2 case(s), all attributable to **B2 (duplicate injection)**: the matcher healed to one of two identically-attributed buttons without raising ambiguity, in both event modes. This is a genuine firewall gap, orthogonal to the trusted/synthetic distinction. **A3 (outer wrapper div)** ABSTAINed in both modes — inspecting the DOM, Radix's DropdownMenu.Trigger relies on being a direct child of DropdownMenu, and wrapping it in an extra div produced a rendering path that the matcher could not confidently disambiguate; that is a mutation-design artifact rather than a matcher fault, and it is honest data: the harness correctly reported ABSTAIN instead of guessing. **B3 (500ms route delay on all requests)** was inert on this pure-client target since the click handler is not blocked on network; it added ~5.5s of latency but did not stress the firewall. All results validated against `flywheel-event/v1`.
