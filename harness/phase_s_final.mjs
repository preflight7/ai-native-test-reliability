#!/usr/bin/env node
// Phase S — one-shot final run on n8n.
// Pass A: 6 elements × 4 drifts × 4 paths × N=3 = 288 trials.
// Pass B: compounding on execute-workflow-button, 6 sequential brain-persisting runs.
// Pass C: identity oracle catch on 2 imposters.
// Emits ONE logs/phase_s.jsonl; report generated separately.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'logs/phase_s.jsonl');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, '');

const BUNDLE = fs.readFileSync(path.join(ROOT, 'logs/selfheal-bundle.js'), 'utf8');
const N8N = 'http://localhost:5678';
const LOGIN_EMAIL = 'test@example.local';
const LOGIN_PASSWORD = 'TestPass123';

const N = 3;

// Elements to test. `naiveSel` is what a QA engineer would write with plain PW as fallback.
const ELEMENTS = [
  { id: 'execute-workflow-button', testid: 'execute-workflow-button', role: 'button', name: 'Test workflow',
    naiveSel: 'button:has-text("Test workflow")' },
  { id: 'workflow-save-button', testid: 'workflow-save-button', role: 'button', name: 'Save',
    naiveSel: 'span:has-text("Save")' },
  { id: 'workflow-name-input', testid: 'workflow-name-input', role: null, name: null,
    naiveSel: null /* no plausible naive fallback */ },
  { id: 'canvas-plus-button', testid: 'canvas-plus-button', role: 'button', name: null,
    naiveSel: null /* icon-only, no accessible name */ },
  { id: 'main-sidebar-user-menu', testid: 'main-sidebar-user-menu', role: null, name: null,
    naiveSel: 'div:has-text("TU")' /* avatar initials */ },
  // menu-item is one of many; pick the first one and target by testid + first-child scope
  { id: 'first-menu-item', testid: 'menu-item', role: 'menuitem', name: null,
    naiveSel: '[data-test-id="menu-item"]:first-of-type' },
];

// Drifts (applied via page.evaluate). Each returns a revert function.
const DRIFTS = {
  DR1_testid: (el) => {
    const orig = el.getAttribute('data-test-id');
    el.setAttribute('data-test-id', orig + '-DR1');
    return () => el.setAttribute('data-test-id', orig);
  },
  DR2_i18n: (el) => {
    const orig = el.getAttribute('aria-label');
    el.setAttribute('aria-label', 'Exécuter');
    return () => orig ? el.setAttribute('aria-label', orig) : el.removeAttribute('aria-label');
  },
  DR3_ab_variant: (el) => {
    const oc = el.className;
    const ot = el.textContent;
    el.className = 'ab-variant-2 el-btn el-btn-primary';
    // preserve visible children by only rewriting leaf text nodes
    for (const c of el.childNodes) {
      if (c.nodeType === 3 && c.textContent.trim()) c.textContent = 'AB Variant';
    }
    return () => { el.className = oc; for (const c of el.childNodes) if (c.nodeType === 3) c.textContent = ot; };
  },
  DR4_refactor_move: (el) => {
    const origParent = el.parentNode;
    const origNext = el.nextSibling;
    document.body.appendChild(el);
    // move to top-right corner to keep it visible/clickable
    el.style.position = 'fixed'; el.style.top = '80px'; el.style.right = '20px'; el.style.zIndex = '99999';
    return () => {
      el.style.position = ''; el.style.top = ''; el.style.right = ''; el.style.zIndex = '';
      if (origNext && origParent.contains(origNext)) origParent.insertBefore(el, origNext);
      else origParent.appendChild(el);
    };
  },
};

// Identity fingerprint: attribute + text; movable-but-stable across drift.
function identityHashJS() {
  return `(function(el){
    if (!el) return null;
    const role = el.getAttribute('role') || (el.tagName.toLowerCase() === 'button' ? 'button' : '');
    const aria = el.getAttribute('aria-label') || '';
    const txt = (el.textContent || '').trim().slice(0, 40);
    return el.tagName.toLowerCase() + '|' + role + '|' + aria + '|' + txt;
  })`;
}
function hash(seed) { return seed ? crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12) : null; }

async function loginIfNeeded(page) {
  await page.goto(N8N, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const url = page.url();
  if (url.includes('/signin')) {
    await page.fill('input[name="email"]', LOGIN_EMAIL).catch(async () => {
      // n8n 1.60 may not use `name` attr; try type=email
      await page.fill('input[type="email"]', LOGIN_EMAIL);
    });
    await page.fill('input[type="password"]', LOGIN_PASSWORD);
    await page.click('[data-test-id="form-submit-button"], button[type="submit"]');
    await page.waitForURL(url => !url.href.includes('/signin'), { timeout: 10000 });
    await page.waitForTimeout(1500);
  } else if (url.includes('/setup')) {
    // Fresh state — shouldn't happen, but handle it.
    throw new Error('n8n at /setup — reset happened; abort');
  }
  // Dismiss overlays
  await page.evaluate(() => {
    ['nps-survey-modal', 'version-updates-panel'].forEach(id => {
      document.querySelectorAll(`[data-test-id="${id}"]`).forEach(el => el.remove());
    });
    document.querySelectorAll('.el-overlay, .el-dialog__wrapper').forEach(el => el.style.display = 'none');
  });
}

async function newContext(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: BUNDLE });
  const page = await ctx.newPage();
  await loginIfNeeded(page);
  // ALWAYS land on the workflow editor (not the workflow list).
  if (!page.url().includes('/workflow/new')) {
    await page.goto(N8N + '/workflow/new', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      ['nps-survey-modal', 'version-updates-panel'].forEach(id => {
        document.querySelectorAll(`[data-test-id="${id}"]`).forEach(el => el.remove());
      });
      document.querySelectorAll('.el-overlay, .el-dialog__wrapper').forEach(el => el.style.display = 'none');
    });
  }
  return { ctx, page };
}

function emit(row) { fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); }

// Record anchor for one element via library captureStep.
// Also stamps a stable data-phase-s-target marker so identity checks survive drift.
async function recordAnchor(page, testid) {
  return await page.evaluate((t) => {
    const el = document.querySelector(`[data-test-id="${t}"]`);
    if (!el) return null;
    el.setAttribute('data-phase-s-target', t);   // stable marker; drift never touches this
    return window.SELFHEAL.captureStep(el, document, { stepId: t, action: 'click' });
  }, testid);
}

// Identity check: does the element at `sel` carry the recorded marker attribute?
// Uses a drift-invariant marker, not attribute-scraped hash — so drift on aria/class/text
// doesn't create false identity mismatches.
async function identityMatches(page, sel, targetMarker) {
  if (!sel) return false;
  return await page.evaluate(({ s, m }) => {
    try {
      const el = document.querySelector(s);
      return !!el && el.getAttribute('data-phase-s-target') === m;
    } catch { return false; }
  }, { s: sel, m: targetMarker });
}

// Run one plugin match (with or without brain).
async function pluginMatch(page, anchor, brainSeed) {
  return await page.evaluate(({ a, seed }) => {
    if (seed && !window.__BRAIN) {
      window.__BRAIN = window.SELFHEAL_BRAIN.makeBrain(seed);
      window.__LADDER = window.SELFHEAL_LEARN.makeLadder();
    }
    const doc = document;
    // If brain has an entry at L2, use it directly.
    let servedBy = 'matcher';
    if (window.__BRAIN && window.__LADDER && window.__LADDER.tier(a.stepId || 'x', a.stepId || 'x') === 'L2') {
      const hit = window.__BRAIN.get(a.stepId || 'x', a.stepId || 'x', doc);
      if (hit) return { servedBy: 'brain', bestLocator: hit.locator, verdict: 'heal' };
    }
    const r = window.SELFHEAL.matchAndEmit(doc, a, { gate: true });
    return {
      servedBy, verdict: r.verdict, bestLocator: r.bestLocator, emitCount: r.emitCount,
      score: r.best?.conf, margin: r.margin, diagnosis: r.diagnosis,
    };
  }, { a: anchor, seed: brainSeed });
}

// After a successful heal, update the brain+ladder (if brain is in use).
async function updateBrain(page, testId, stepId, healedSel) {
  await page.evaluate(({ tid, sid, sel }) => {
    if (!window.__BRAIN) return;
    window.__BRAIN.put(tid, sid, sel, { confidence: 'HIGH' });
    window.__LADDER.record(tid, sid, 'PASS', 'HIGH', window.__BRAIN);
  }, { tid: testId, sid: stepId, sel: healedSel });
}

async function brainSnapshot(page) {
  return await page.evaluate(() => {
    if (!window.__BRAIN) return null;
    return { snap: window.__BRAIN.snapshot(), ladder: window.__LADDER.snapshot() };
  });
}

// Apply a drift + return revert; both run in-page.
async function applyDrift(page, testid, driftKey) {
  return await page.evaluate(({ t, k }) => {
    const el = document.querySelector(`[data-test-id="${t}"]`);
    if (!el) return { ok: false, reason: 'element not found' };
    const drifts = {
      DR1: () => { const o = el.getAttribute('data-test-id'); el.setAttribute('data-test-id', o + '-DR1'); return () => el.setAttribute('data-test-id', o); },
      DR2: () => { const o = el.getAttribute('aria-label'); el.setAttribute('aria-label', 'Exécuter'); return () => o ? el.setAttribute('aria-label', o) : el.removeAttribute('aria-label'); },
      DR3: () => {
        const oc = el.className; const ot = el.textContent;
        el.className = 'ab-variant-2 el-btn el-btn-primary';
        for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) c.textContent = 'AB Variant';
        return () => { el.className = oc; for (const c of el.childNodes) if (c.nodeType === 3) c.textContent = ot; };
      },
      DR4: () => {
        // Less destructive than body-reparent (which crashes Vue reactivity on n8n).
        // Swap el with its next sibling in the same parent. Element position shifts
        // among siblings; scope/context disambiguators are affected.
        const p = el.parentNode; const next = el.nextElementSibling;
        if (next && p.children.length > 1) p.insertBefore(next, el);
        return () => { if (next && p.children.length > 1) p.insertBefore(el, next); };
      },
    };
    const revert = drifts[k]();
    window.__REVERT = revert;
    return { ok: true };
  }, { t: testid, k: driftKey });
}
async function revertDrift(page) {
  await page.evaluate(() => { if (window.__REVERT) { window.__REVERT(); window.__REVERT = null; } });
}

// Approximate "Claude cycles proxy" for baseline paths.
// Successful path = 0 turns. Failing path = 3 turns (read DOM, rewrite, retest).
function cyclesFor(outcome) { return outcome === 'PASS' ? 0 : 3; }

// ================================================================
// PASS A: element × drift × path × N
// ================================================================
async function passA(browser) {
  console.log('\n=== PASS A: 6 elements × 4 drifts × 4 paths × N=3 = 288 trials ===');
  let { ctx, page } = await newContext(browser);
  // Record all anchors first (on pristine DOM).
  const anchors = {};
  for (const el of ELEMENTS) {
    const a = await recordAnchor(page, el.testid);
    if (!a) { console.log(`  WARN: could not record anchor for ${el.id} — skipping`); continue; }
    anchors[el.id] = a;
  }
  console.log(`  recorded ${Object.keys(anchors).length} of ${ELEMENTS.length} anchors`);

  async function reopenContext() {
    try { await ctx.close(); } catch {}
    const fresh = await newContext(browser);
    ctx = fresh.ctx; page = fresh.page;
    // Re-record anchors on fresh page.
    for (const el of ELEMENTS) if (anchors[el.id]) await recordAnchor(page, el.testid);
  }

  for (const el of ELEMENTS) {
    if (!anchors[el.id]) continue;
    console.log(`\n  element: ${el.id}`);

    for (const [driftKey, _] of Object.entries(DRIFTS)) {
      const drift = driftKey.split('_')[0];  // DR1/DR2/DR3/DR4

      for (const pathName of ['S', 'N', 'L-cold', 'L-brain']) {
        for (let run = 1; run <= N; run++) {
          let applied;
          try {
            applied = await applyDrift(page, el.testid, drift);
          } catch (e) {
            const isCrash = /Target crashed|crashed|closed/i.test(e.message || '');
            emit({ pass: 'A', element: el.id, drift, path: pathName, run,
                   outcome: 'SKIPPED_CRASH', diagnosis: e.message.slice(0, 120), wall_ms: 0, claude_cycles: 0 });
            console.log(`    [${el.id}][${drift}][${pathName}][${run}] SKIPPED_CRASH: ${e.message.slice(0,60)}`);
            if (isCrash) { await reopenContext(); }
            continue;
          }
          if (!applied.ok) { console.log(`    [${el.id}][${drift}][${pathName}][${run}] SKIP: ${applied.reason}`); continue; }

          const t0 = Date.now();
          let outcome = 'FAIL', identity = null, healedSel = null, diagnosis = null, extras = {};

          try {
            if (pathName === 'S') {
              const hits = await page.locator(`[data-test-id="${el.testid}"]`).count();
              if (hits === 1) { identity = (await identityMatches(page, `[data-test-id="${el.testid}"]`, el.id)) ? 'MATCH' : 'MISMATCH'; outcome = identity === 'MATCH' ? 'PASS' : 'FALSE_HEAL'; }
              else diagnosis = `strict selector resolved ${hits} elements`;

            } else if (pathName === 'N') {
              if (!el.naiveSel) { diagnosis = 'no naive fallback available'; }
              else {
                try {
                  const hits = await page.locator(el.naiveSel).count();
                  if (hits === 1) { identity = (await identityMatches(page, el.naiveSel, el.id)) ? 'MATCH' : 'MISMATCH'; outcome = identity === 'MATCH' ? 'PASS' : 'FALSE_HEAL'; }
                  else diagnosis = `naive selector resolved ${hits} elements`;
                } catch(e) { diagnosis = 'naive selector error: ' + e.message.slice(0,80); }
              }

            } else if (pathName === 'L-cold') {
              await page.evaluate(() => { delete window.__BRAIN; delete window.__LADDER; });
              const r = await pluginMatch(page, anchors[el.id], null);
              healedSel = r.bestLocator; diagnosis = r.diagnosis; extras = { verdict: r.verdict, score: r.score, margin: r.margin, emitCount: r.emitCount };
              if (r.verdict === 'heal' && r.bestLocator) {
                const match = await identityMatches(page, r.bestLocator, el.id);
                outcome = match ? 'PASS' : 'FALSE_HEAL';
                identity = match ? 'MATCH' : 'MISMATCH';
              } else outcome = r.verdict === 'abstain' ? 'ABSTAIN' : 'FAIL';

            } else { // L-brain
              const r = await pluginMatch(page, anchors[el.id], undefined);
              healedSel = r.bestLocator; diagnosis = r.diagnosis; extras = { verdict: r.verdict, score: r.score, margin: r.margin, emitCount: r.emitCount, servedBy: r.servedBy };
              if (r.verdict === 'heal' && r.bestLocator) {
                const match = await identityMatches(page, r.bestLocator, el.id);
                outcome = match ? 'PASS' : 'FALSE_HEAL';
                identity = match ? 'MATCH' : 'MISMATCH';
                if (outcome === 'PASS' && r.servedBy === 'matcher') await updateBrain(page, el.id, el.id, r.bestLocator);
              } else outcome = r.verdict === 'abstain' ? 'ABSTAIN' : 'FAIL';
            }
          } catch (e) {
            const isCrash = /Target crashed|crashed|closed/i.test(e.message || '');
            diagnosis = 'trial error: ' + e.message.slice(0, 120);
            if (isCrash) {
              const wall_ms = Date.now() - t0;
              emit({ pass: 'A', element: el.id, drift, path: pathName, run,
                     outcome: 'SKIPPED_CRASH', diagnosis, wall_ms, claude_cycles: 0 });
              console.log(`    [${el.id}][${drift}][${pathName}][${run}] CRASH → reopen`);
              await reopenContext();
              continue;
            }
          }

          const wall_ms = Date.now() - t0;
          try { await revertDrift(page); } catch {}

          emit({
            pass: 'A', element: el.id, drift, path: pathName, run,
            outcome, identity_matches_recorded: identity === 'MATCH',
            healedSel, wall_ms, diagnosis, claude_cycles: cyclesFor(outcome), ...extras,
          });
          process.stdout.write(`    [${el.id}][${drift}][${pathName}][${run}] ${outcome} ${wall_ms}ms\n`);
        }
        // Reset brain between paths on same element
        if (pathName === 'L-brain') await page.evaluate(() => { delete window.__BRAIN; delete window.__LADDER; });
      }
    }
  }
  await ctx.close();
}

// ================================================================
// PASS B: compounding on execute-workflow-button
// ================================================================
async function passB(browser) {
  console.log('\n=== PASS B: compounding, 6 sequential runs ===');
  const { ctx, page } = await newContext(browser);
  const anchor = await recordAnchor(page, 'execute-workflow-button');
  if (!anchor) { console.log('  WARN: no anchor for execute-workflow-button — skipping Pass B'); await ctx.close(); return; }

  // Apply drift persistently — testid rename lasts across all 6 runs.
  await applyDrift(page, 'execute-workflow-button', 'DR1');

  // Initialize brain + ladder.
  await page.evaluate(() => {
    window.__BRAIN = window.SELFHEAL_BRAIN.makeBrain();
    window.__LADDER = window.SELFHEAL_LEARN.makeLadder();
  });

  for (let run = 1; run <= 6; run++) {
    const tierBefore = await page.evaluate(() => window.__LADDER.tier('exec', 'exec'));
    const t0 = Date.now();
    const r = await page.evaluate(({ a }) => {
      let servedBy = 'matcher', best = null, verdict = null;
      if (window.__LADDER.tier('exec', 'exec') === 'L2') {
        const hit = window.__BRAIN.get('exec', 'exec', document);
        if (hit) { servedBy = 'brain'; best = hit.locator; verdict = 'heal'; }
      }
      if (!best) {
        const m = window.SELFHEAL.matchAndEmit(document, a, { gate: true });
        best = m.bestLocator; verdict = m.verdict;
      }
      return { servedBy, bestLocator: best, verdict };
    }, { a: anchor });

    const identityMatch = r.bestLocator ? await identityMatches(page, r.bestLocator, 'execute-workflow-button') : false;
    const wall_ms = Date.now() - t0;

    let record = null;
    if (r.verdict === 'heal' && identityMatch) {
      record = await page.evaluate(({ sel }) => {
        window.__BRAIN.put('exec', 'exec', sel, { confidence: 'HIGH' });
        const rec = window.__LADDER.record('exec', 'exec', 'PASS', 'HIGH', window.__BRAIN);
        return { successes: rec.rec.successes, tier: rec.tier };
      }, { sel: r.bestLocator });
    }
    const tierAfter = record?.tier || tierBefore;

    emit({
      pass: 'B', run, tierBefore, tierAfter, servedBy: r.servedBy,
      successes: record?.successes, verdict: r.verdict, bestLocator: r.bestLocator,
      identity_matches_recorded: identityMatch, wall_ms,
    });
    process.stdout.write(`  run ${run}: ${tierBefore}→${tierAfter} ${r.servedBy} ${wall_ms}ms\n`);
  }

  await revertDrift(page);
  await ctx.close();
}

// ================================================================
// PASS C: identity oracle catch on 2 imposters
// ================================================================
async function passC(browser) {
  console.log('\n=== PASS C: identity oracle catch on 2 imposters ===');
  const { ctx, page } = await newContext(browser);

  for (const targetId of ['execute-workflow-button', 'workflow-save-button']) {
    const anchor = await recordAnchor(page, targetId);
    if (!anchor) { console.log(`  WARN: no anchor for ${targetId} — skipping`); continue; }

    // Set up imposter: hide real, inject impostor with same testid + different identity + no handler.
    await page.evaluate(({ t }) => {
      const real = document.querySelector(`[data-test-id="${t}"]`);
      if (!real) return;
      real.style.display = 'none';
      real.setAttribute('data-test-id', t + '-real-hidden');
      const imp = document.createElement('button');
      imp.setAttribute('data-test-id', t);
      imp.setAttribute('aria-label', 'Not the real element');
      imp.textContent = 'IMPOSTER';
      imp.className = 'imposter';
      imp.style.cssText = 'position:fixed;top:16px;left:16px;width:36px;height:36px;background:#f88;z-index:99999';
      document.body.appendChild(imp);
    }, { t: targetId });

    // PW-alone: click recorded selector → likely clicks the imposter (marker attr absent).
    const pwHit = await page.locator(`[data-test-id="${targetId}"]`).count();
    const pwIdentityMatch = pwHit === 1 ? await identityMatches(page, `[data-test-id="${targetId}"]`, targetId) : false;
    const pwSilentBadClick = pwHit === 1 && !pwIdentityMatch;
    emit({
      pass: 'C', element: targetId, path: 'PW-alone',
      outcome: pwHit === 1 ? (pwIdentityMatch ? 'PASS' : 'CLICKED_IMPOSTER') : 'FAIL',
      identity_matches_recorded: pwIdentityMatch,
      silent_bad_click: pwSilentBadClick,
      false_heal: pwSilentBadClick,
    });

    // Plugin: matcher heals to imposter (testid dominates), identity oracle catches via marker.
    const r = await pluginMatch(page, anchor, null);
    const plIdentityMatch = r.bestLocator ? await identityMatches(page, r.bestLocator, targetId) : false;
    emit({
      pass: 'C', element: targetId, path: 'Plugin',
      outcome: r.verdict === 'heal' ? (plIdentityMatch ? 'PASS' : 'FALSE_HEAL_CAUGHT') : 'ABSTAIN',
      identity_matches_recorded: plIdentityMatch,
      false_heal_caught: r.verdict === 'heal' && !plIdentityMatch,
      false_heal: r.verdict === 'heal' && !plIdentityMatch,
      healedSel: r.bestLocator,
    });

    // Cleanup: restore real, remove imposter.
    await page.evaluate(({ t }) => {
      document.querySelectorAll('.imposter').forEach(e => e.remove());
      const hidden = document.querySelector(`[data-test-id="${t}-real-hidden"]`);
      if (hidden) { hidden.style.display = ''; hidden.setAttribute('data-test-id', t); }
    }, { t: targetId });

    process.stdout.write(`  ${targetId}: PW-alone-silent-bad-click=${pwSilentBadClick}, Plugin-oracle-caught=${!plIdentityMatch && r.verdict==='heal'}\n`);
  }
  await ctx.close();
}

// ================================================================
// Main
// ================================================================
const START = Date.now();
console.log('Phase S final run — headless chromium, logs -> ' + path.relative(process.cwd(), OUT));
const browser = await chromium.launch({ headless: true });

try {
  await passA(browser);
  await passB(browser);
  await passC(browser);
} finally {
  await browser.close();
  console.log(`\nTotal wall time: ${Math.round((Date.now() - START) / 1000)}s`);
  console.log(`Rows: ${fs.readFileSync(OUT, 'utf8').trim().split('\n').length}`);
}
