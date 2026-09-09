# n8n target profile — new fixture for Phase R scenarios

**Date:** 2026-09-09
**App:** n8n 1.60.0 (older release; latest requires Node 24, we have Node 22)
**Boot:** `npx n8n@1.60.0 start` — 90s cold install, ~10s subsequent boots
**URL:** `http://localhost:5678`
**Auth:** first-run owner-account wizard at `/setup`; completed once with local-only test creds; SQLite state at `~/.n8n/`
**Post-auth landing:** `/workflow/new` — the workflow editor

## Why this target

Meets the "complex UI-heavy" criteria we picked over Excalidraw:

| UI shape | Present in n8n | Example testids |
|---|---|---|
| Forms | ✅ | setup-form, workflow-name-input, node-parameters (in node config popup) |
| Popups / modals | ✅ | nps-survey-modal, version-updates-panel, node-creator (drawer on Add-step) |
| Wizards | ✅ | owner setup wizard, node-connection wizard, credential-setup wizard |
| Left sidebar nav | ✅ | project-home-menu-item, menu-item × N, main-sidebar-user-menu |
| Right side-panel | ✅ | ndv-* (node-detail-view) opens on node click |
| Canvas / spatial | ✅ | node-view, canvas-plus-button, zoom-in-button, sticky |

**63 testids** on the fresh editor page (vs Excalidraw's 16). Coverage is far better; drift stress-tests will exercise more fallback paths.

## Immediate UI observations

- Uses `data-test-id` (hyphenated `test-id`), not `data-testid`. **Library's `WEB.extract` reads `data-testid` OR `data-test` OR `data-cy`** — n8n's `data-test-id` will NOT be picked up as `ex.testid` on match. Verified by reading `selfheal-core.js#WEB.extract`. **First real integration issue to name** — the library's testid detection needs extending, OR we pre-process the DOM.
- Rich Element Plus (Vue) component library — dialogs, dropdowns, tooltips all class-based `.el-*` on top of testids
- Sidebar collapses to icons — some `menu-item` testids resolve to items with only aria-label, not visible text
- Node canvas is Vue Flow — SVG + HTML mix
- Two ambient overlays on first-run (NPS survey, updates panel) need dismissing before automation

## Candidate scenarios worth running on n8n

Priority ordered, all recorded-then-drifted patterns:

### First pass (baseline: does the plugin even work on n8n?)

- **N-A1**: click `workflow-name-input` → rename `data-test-id` → does plugin heal? (blocked until we extend `WEB.extract` to read `data-test-id`)
- **N-A2**: click sidebar `project-home-menu-item` → rename → heal path via aria-label
- **N-B1**: click canvas `Add first step` → the button has multiple `canvas-plus-button` twins (main + toolbar plus) → ambiguity firewall test

### Form scenarios (impossible on Excalidraw)

- **N-D1a** (setup form redux): record filling the setup form → drift `data-test-id="email"` → does plugin heal via `name="email"` fallback?
- **N-D1b** (workflow-name inline edit): record clicking + typing into workflow name → drift the input's testid
- **N-D1c** (node parameter form): add a node → open its parameters panel → record clicking a parameter field → drift the field

### Wizard / popup scenarios

- **N-D2a** (node creator drawer): click `canvas-plus-button` → node creator opens as drawer → record clicking a node type → drift the node option
- **N-D2b** (credential wizard): open a node that needs credentials → wizard opens with multiple steps → drift a wizard input
- **N-D2c** (sticky note popup): click `add-sticky-button` → sticky note editor opens → drift its testid

### Sidebar navigation (multi-page)

- **N-D3a** (workflow list nav): sidebar → Workflows list → drift the list's search input
- **N-D3b** (credentials nav): sidebar → Credentials list → click "Create credential" wizard
- **N-D3c** (settings): sidebar → Settings → drift a settings toggle

### Compounding on this fixture

- **N-C1** (same-element repeat): pick one form field, drift it, run same test 6 times, ladder should promote L1→L2 (same shape as Excalidraw C1 but on form input)
- **N-C2** (cross-form corpus): 5 different form fields across 5 different pages (setup / workflow-name / node-params / credential / settings), one drift each, brain accumulates

## Blockers to address before running scenarios

1. **`data-test-id` vs `data-testid`.** Library only reads `data-testid`/`data-test`/`data-cy`. Either:
   - Extend `WEB.extract` to also read `data-test-id` (small library change, upstream `feature/heal-policy` branch)
   - Or run a `page.evaluate` preprocessor at load that mirrors `data-test-id` to `data-testid` on every element
   
   The preprocessor is a HACK for the demo; the library extension is the right fix.
2. **Two ambient overlays** need dismissing before any first-click scenario. Add a `setup()` helper in the harness that runs on every context init.
3. **`data-test-id="menu-item"` is used MANY times** — same testid on multiple sidebar items. Any recorded step on a menu-item needs a container/scope disambiguator (which the library's `disambiguateByContext` supports but our current adapter doesn't invoke). Fits the D5 / matchAndEmit story.

## Recommended next 3 steps

1. **Fix the testid-attribute mismatch** — extend `WEB.extract` in the library on a new branch to also read `data-test-id`, push to fork. ~15 min.
2. **Recreate `capture-fixture.mjs` for n8n** — record one authored test on the workflow-name inline edit (simplest form field). ~15 min.
3. **Run N-A1 as the first plugin-vs-naive comparison on n8n.** ~10 min. Baseline for whether the plugin works at all on this fixture.

Then iterate through the scenario groups above.
