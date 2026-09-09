#!/usr/bin/env node
// Phase R — Compounding chip (C1 same-button repeat learning; C2 cross-button corpus growth).
//
// Load-bearing thesis: N-th heal is cheaper/safer than 1st because the brain caches
// verified-HIGH heals and the ladder promotes a key to L2 after PROMOTE_AT (=5)
// consecutive HIGH-verified PASSes, at which point the executor may skip re-matching
// and act directly on the cached selector.
//
// This chip is the first real data on whether the brain-served path AND ladder
// promotion actually fire in practice, on Excalidraw. Two phases, both run in this
// script; ONE Playwright browser reused; brain+ladder persisted across runs by
// Node-side snapshot rehydration (fresh page per run rebuilds the in-page brain
// from the Node snapshot).
//
// DOM-only mutation (no source patching): after each navigation we mutate
// `data-testid` via page.evaluate. React does not overwrite the DOM attribute
// on subsequent reconciliation because the JSX-declared value is unchanged;
// verified via harness/_probe3.mjs before authoring this chip.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'logs', 'selfheal-bundle.js');
const URL_TARGET = process.env.URL_TARGET || 'http://localhost:3002/';

const BUNDLE = fs.readFileSync(BUNDLE_PATH, 'utf8');
const libSha = execSync('git -C lib rev-parse HEAD', { cwd: ROOT }).toString().trim();
const targetSha = execSync('git -C target_repo rev-parse HEAD', { cwd: ROOT }).toString().trim();

const LOG = path.join(ROOT, 'logs', 'compounding.jsonl');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, '');

const jlog = (row) => fs.appendFileSync(LOG, JSON.stringify({ ...row, ts: new Date().toISOString(), libSha, targetSha }) + '\n');

async function newPage(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: BUNDLE });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function warm(page) {
  await page.goto(URL_TARGET, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function captureAnchor(page, testid, stepId) {
  return await page.evaluate(({ sel, stepId }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return window.SELFHEAL.captureStep(el, document, { stepId, action: 'click' });
  }, { sel: `[data-testid="${testid}"]`, stepId });
}

async function applyRenameMutations(page, renames) {
  await page.evaluate((rs) => {
    for (const [from, to] of rs) {
      const el = document.querySelector(`[data-testid="${from}"]`);
      if (el) el.setAttribute('data-testid', to);
    }
  }, renames);
}

// One run: rehydrate brain+ladder in-page from Node seeds, thread them into a
// locate+act on the given anchor. Returns per-run metrics AND the new snapshots
// so the caller can persist to the next run.
async function runOne(page, { testId, stepId, anchor, expectedAriaLabel, brainSeed, ladderSeed }) {
  const t0 = Date.now();

  const preResult = await page.evaluate(({ brainSeed, ladderSeed, testId, stepId, anchor }) => {
    const brain = window.SELFHEAL_BRAIN.makeBrain(brainSeed);
    const ladder = window.SELFHEAL_LEARN.makeLadder(ladderSeed);
    window.__BRAIN = brain;
    window.__LADDER = ladder;
    const tierBefore = ladder.tier(testId, stepId);
    const ladderRecBefore = ladder.get(testId, stepId);
    let servedBy = 'matcher';
    let healedSelector = null;
    let actedElFound = false;
    let matchOut = null;
    let originalBestLocator = anchor && anchor.target && anchor.target.bestLocator || null;

    // Brain-first path only when the ladder has promoted this key to L2.
    if (tierBefore === 'L2') {
      const hit = brain.get(testId, stepId, document);
      if (hit) {
        servedBy = 'brain';
        healedSelector = hit.locator;
        actedElFound = true;
        // Act synthetically — Excalidraw's onClick handlers work on synthetic click.
        try { hit.el.click(); } catch (e) {}
      }
    }
    if (!actedElFound) {
      const r = window.SELFHEAL.matchAndEmit
        ? window.SELFHEAL.matchAndEmit(document, anchor, { gate: true })
        : (function () {
            const s = window.SELFHEAL.matchStep(document, anchor, { gate: true });
            const ex = s.best ? s.best.ex : null;
            const loc = ex ? window.SELFHEAL.bestLocator(ex) : { sel: null, tier: 'none' };
            return { ...s, bestLocator: loc.sel, tier: loc.tier };
          })();
      matchOut = { verdict: r.verdict, tier: r.tier, bestLocator: r.bestLocator, via: r.via || null };
      if (r.verdict === 'heal' && r.best && r.bestLocator) {
        healedSelector = r.bestLocator;
        try { r.best.el.click(); } catch (e) {}
        actedElFound = true;
      }
    }

    // Identity fingerprint on the healed selector's current DOM node — tag|aria-label|title|role.
    // Selector- and position-invariant. Compared across runs to detect false-heals.
    let identity = null;
    if (healedSelector) {
      try {
        const el = document.querySelector(healedSelector);
        if (el) {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || '';
          const aria = el.getAttribute('aria-label') || '';
          const title = el.getAttribute('title') || '';
          identity = tag + '|' + role + '|' + aria + '|' + title;
        }
      } catch (e) {}
    }

    return {
      tierBefore,
      ladderRecBefore,
      servedBy,
      healedSelector,
      originalBestLocator,
      matchOut,
      identity,
      actedElFound,
    };
  }, { brainSeed, ladderSeed, testId, stepId, anchor });

  await page.waitForTimeout(500);

  // Verify: aria-pressed toggled to "true" on the button with the expected aria-label.
  // Selector-independent — survives testid drift.
  const verified = await page.evaluate((label) => {
    const btns = document.querySelectorAll('button, [role="button"]');
    for (const b of btns) {
      if (b.getAttribute('aria-label') === label) {
        return { present: true, pressed: b.getAttribute('aria-pressed') === 'true' };
      }
    }
    return { present: false, pressed: false };
  }, expectedAriaLabel);

  const outcome = verified.pressed ? 'PASS' : 'FAILED';
  const verify_confidence = 'HIGH'; // aria-pressed state change is a specific, deterministic effect

  // Post: write to brain (verified-HIGH only) and advance ladder. Return new snapshots.
  const post = await page.evaluate(({ testId, stepId, healedSelector, outcome, verify_confidence }) => {
    const brain = window.__BRAIN, ladder = window.__LADDER;
    let ingested = false;
    if (outcome === 'PASS' && verify_confidence === 'HIGH' && healedSelector) {
      ingested = brain.put(testId, stepId, healedSelector, { confidence: verify_confidence });
    }
    const rec = ladder.record(testId, stepId, outcome, verify_confidence, brain);
    return {
      brainSnap: brain.snapshot(),
      ladderSnap: ladder.snapshot(),
      tierAfter: rec.tier,
      ladderAction: rec.action,
      ladderRecAfter: rec.rec,
      brainIngested: ingested,
    };
  }, { testId, stepId, healedSelector: preResult.healedSelector, outcome, verify_confidence });

  return {
    wall_ms: Date.now() - t0,
    servedBy: preResult.servedBy,
    tierBefore: preResult.tierBefore,
    tierAfter: post.tierAfter,
    ladderAction: post.ladderAction,
    ladderRecBefore: preResult.ladderRecBefore,
    ladderRecAfter: post.ladderRecAfter,
    healedSelector: preResult.healedSelector,
    originalBestLocator: preResult.originalBestLocator,
    matchOut: preResult.matchOut,
    identity: preResult.identity,
    identityHash: preResult.identity ? crypto.createHash('sha1').update(preResult.identity).digest('hex').slice(0, 12) : null,
    outcome,
    verifyPresent: verified.present,
    verifyPressed: verified.pressed,
    verify_confidence,
    brainIngested: post.brainIngested,
    brainSnap: post.brainSnap,
    ladderSnap: post.ladderSnap,
    brainSize: Object.keys(post.brainSnap).length,
  };
}

// ------- PHASE C1: same-button repeat learning (6 runs, rectangle) -------

async function phaseC1(browser) {
  console.log('\n=== Phase C1 — same-button repeat learning (target=toolbar-rectangle → toolbar-rect-v2) ===');
  const testId = 'C1-rect';
  const stepId = 'clickRect';
  const originalTestid = 'toolbar-rectangle';
  const mutatedTestid = 'toolbar-rect-v2';
  const expectedAriaLabel = 'Rectangle';

  // Capture the anchor once, from the PRISTINE DOM, using the library's own captureStep.
  let anchor;
  {
    const { ctx, page } = await newPage(browser);
    try {
      await warm(page);
      anchor = await captureAnchor(page, originalTestid, stepId);
      if (!anchor) throw new Error('C1: could not capture anchor on pristine DOM');
      console.log('  captured anchor: bestLocator=%s, tier-cue keys=%s',
        anchor.target.bestLocator, Object.keys(anchor.target.descriptor).join(','));
    } finally { await ctx.close(); }
  }

  let brainSeed = {};
  let ladderSeed = {};
  const rows = [];

  for (let run = 1; run <= 6; run++) {
    const { ctx, page } = await newPage(browser);
    try {
      await warm(page);
      await applyRenameMutations(page, [[originalTestid, mutatedTestid]]);

      const row = await runOne(page, { testId, stepId, anchor, expectedAriaLabel, brainSeed, ladderSeed });
      brainSeed = row.brainSnap;
      ladderSeed = row.ladderSnap;

      const summary = {
        phase: 'C1', run, testId, stepId,
        servedBy: row.servedBy,
        tierBefore: row.tierBefore, tierAfter: row.tierAfter,
        ladderAction: row.ladderAction,
        successes: row.ladderRecAfter ? row.ladderRecAfter.successes : 0,
        failures: row.ladderRecAfter ? row.ladderRecAfter.failures : 0,
        healedSelector: row.healedSelector,
        originalBestLocator: row.originalBestLocator,
        identityHash: row.identityHash,
        identity: row.identity,
        outcome: row.outcome,
        brainSize: row.brainSize,
        brainIngested: row.brainIngested,
        wall_ms: row.wall_ms,
        matchOut: row.matchOut,
      };
      rows.push(summary);
      jlog(summary);
      console.log(`  run ${run}: served=${row.servedBy} tier ${row.tierBefore}→${row.tierAfter} ok=${row.outcome} sel=${row.healedSelector} id=${row.identityHash} ingest=${row.brainIngested} brainN=${row.brainSize} wall=${row.wall_ms}ms`);
    } finally { await ctx.close(); }
  }

  return { rows, finalBrain: brainSeed, finalLadder: ladderSeed };
}

// ------- PHASE C2: cross-button corpus growth (5 runs, 5 different buttons) -------

async function phaseC2(browser) {
  console.log('\n=== Phase C2 — cross-button corpus growth (rect, ellipse, diamond, arrow, line) ===');
  const targets = [
    { testId: 'C2-rect',    stepId: 'clickRect',    origTestid: 'toolbar-rectangle', mutTestid: 'toolbar-rect-v2',    aria: 'Rectangle' },
    { testId: 'C2-ellipse', stepId: 'clickEllipse', origTestid: 'toolbar-ellipse',   mutTestid: 'toolbar-ellipse-v2', aria: 'Ellipse'   },
    { testId: 'C2-diamond', stepId: 'clickDiamond', origTestid: 'toolbar-diamond',   mutTestid: 'toolbar-diamond-v2', aria: 'Diamond'   },
    { testId: 'C2-arrow',   stepId: 'clickArrow',   origTestid: 'toolbar-arrow',     mutTestid: 'toolbar-arrow-v2',   aria: 'Arrow'     },
    { testId: 'C2-line',    stepId: 'clickLine',    origTestid: 'toolbar-line',      mutTestid: 'toolbar-line-v2',    aria: 'Line'      },
  ];

  // Capture all anchors from pristine DOM first.
  const anchors = {};
  {
    const { ctx, page } = await newPage(browser);
    try {
      await warm(page);
      for (const t of targets) {
        anchors[t.testId] = await captureAnchor(page, t.origTestid, t.stepId);
        if (!anchors[t.testId]) throw new Error(`C2: could not capture anchor for ${t.origTestid}`);
      }
      console.log('  captured %d anchors', targets.length);
    } finally { await ctx.close(); }
  }

  let brainSeed = {};
  let ladderSeed = {};
  const rows = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const { ctx, page } = await newPage(browser);
    try {
      await warm(page);
      // Apply ALL renames — DOM mutations are cheap and this lets the fixture look identical run-to-run.
      await applyRenameMutations(page, targets.map(x => [x.origTestid, x.mutTestid]));

      const row = await runOne(page, {
        testId: t.testId, stepId: t.stepId, anchor: anchors[t.testId],
        expectedAriaLabel: t.aria, brainSeed, ladderSeed,
      });
      brainSeed = row.brainSnap;
      ladderSeed = row.ladderSnap;

      const summary = {
        phase: 'C2', run: i + 1, testId: t.testId, stepId: t.stepId,
        servedBy: row.servedBy,
        tierBefore: row.tierBefore, tierAfter: row.tierAfter,
        ladderAction: row.ladderAction,
        successes: row.ladderRecAfter ? row.ladderRecAfter.successes : 0,
        failures: row.ladderRecAfter ? row.ladderRecAfter.failures : 0,
        healedSelector: row.healedSelector,
        originalBestLocator: row.originalBestLocator,
        identityHash: row.identityHash,
        identity: row.identity,
        outcome: row.outcome,
        brainSize: row.brainSize,
        brainIngested: row.brainIngested,
        wall_ms: row.wall_ms,
        matchOut: row.matchOut,
      };
      rows.push(summary);
      jlog(summary);
      console.log(`  run ${i + 1} (${t.testId}): served=${row.servedBy} tier ${row.tierBefore}→${row.tierAfter} ok=${row.outcome} sel=${row.healedSelector} id=${row.identityHash} ingest=${row.brainIngested} brainN=${row.brainSize} wall=${row.wall_ms}ms`);
    } finally { await ctx.close(); }
  }

  return { rows, finalBrain: brainSeed, finalLadder: ladderSeed };
}

// ------- MAIN -------

(async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const c1 = await phaseC1(browser);
    const c2 = await phaseC2(browser);

    // Aggregate metrics
    const c1_run6_served = c1.rows[5] ? c1.rows[5].servedBy : null;
    const c2_final_brain_size = c2.rows.length ? c2.rows[c2.rows.length - 1].brainSize : 0;

    // False-heal (identity oracle): every run should produce the same identity for the SAME test.
    // Group by testId, count unique identity hashes → any test with >1 unique hash across runs = false-heal.
    // For C1 all 6 runs are the same test — expect 1 unique hash.
    // For C2 each test has 1 run — expect same identity as pristine (aria-label unchanged).
    const groupFalseHeal = (rows) => {
      const byTest = {};
      for (const r of rows) {
        if (!byTest[r.testId]) byTest[r.testId] = new Set();
        if (r.identityHash) byTest[r.testId].add(r.identityHash);
      }
      let fh = 0;
      for (const t in byTest) if (byTest[t].size > 1) fh++;
      return fh;
    };
    const false_heal_c1 = groupFalseHeal(c1.rows);
    const false_heal_c2 = groupFalseHeal(c2.rows);

    // Simple gate
    const c1Promoted = c1.rows[5] && c1.rows[5].servedBy === 'brain';
    const c2Grew = c2_final_brain_size >= 5;
    let gate;
    if (c1Promoted && c2Grew) gate = 'COMPOUNDS';
    else if (c1.rows.some(r => r.brainIngested) && !c1Promoted) gate = 'PARTIAL — brain caches but ladder never promotes / brain-served path never fires';
    else if (!c1.rows.some(r => r.brainIngested)) gate = 'FATAL-TO-THESIS — brain never accumulates on this fixture';
    else gate = 'MIXED — see per-run detail';

    const summary = {
      c1_run6_served,
      c2_final_brain_size,
      false_heal_c1, false_heal_c2, false_heal_total: false_heal_c1 + false_heal_c2,
      c1_all_pass: c1.rows.every(r => r.outcome === 'PASS'),
      c2_all_pass: c2.rows.every(r => r.outcome === 'PASS'),
      gate,
    };
    jlog({ phase: 'SUMMARY', ...summary });
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})();
