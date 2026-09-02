#!/usr/bin/env node
// P1.8 v2 — Run the P1 trial set (pristine + A1 + B1) trusted-only.
// Emits one flywheel-event/v1 row per trial to logs/trials.jsonl.
//
// v2 changes vs v1:
//  - Applies mutations/prep_aria.patch once as a "prep baseline" (adds
//    aria-label="Menu" to the main-menu-trigger button so the descriptor
//    carries a name for role+name fallback).
//  - Runs a target-fitness pre-check on the prepped baseline: temporarily
//    strip data-testid at runtime, call the matcher, assert verdict='heal'
//    via role+name. If this fails, HALT before mutations run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { runTrial, injectLibrary } from './selfheal-playwright-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const test = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/authored-test.json'), 'utf8'));
const trialsFile = path.join(ROOT, 'logs/trials.jsonl');
fs.mkdirSync(path.dirname(trialsFile), { recursive: true });
// Fresh log for this run.
fs.writeFileSync(trialsFile, '');

// Resolve SHAs
const libSha = execSync('git -C lib rev-parse HEAD', { cwd: ROOT }).toString().trim();
const targetSha = execSync('git -C target_repo rev-parse HEAD', { cwd: ROOT }).toString().trim();

const PREP_PATCH = path.resolve(ROOT, 'mutations/prep_aria.patch');
const PREPPED_STAT = '1 file changed, 1 insertion(+)'; // sanity marker

const trials = [
  { id: 'pristine', patch: null, expectedOutcome: 'PASS', driftKind: 'pristine' },
  { id: 'A1',       patch: 'mutations/mut_A1.patch', expectedOutcome: 'PASS',   driftKind: 'restyle' },
  // B1 renames data-testid AND className. Under the prep_aria baseline the
  // button still carries aria-label="Menu", so the role+name fallback survives
  // the drift and the matcher heals to the SAME node. Under an identity-based
  // oracle this is a legitimate heal, not a false heal, so expectedOutcome=PASS.
  { id: 'B1',       patch: 'mutations/mut_B1.patch', expectedOutcome: 'PASS',   driftKind: 'restyle' },
];

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT }).toString();
}
function applyPatch(patchAbs) {
  execSync(`git -C target_repo apply "${patchAbs}"`, { cwd: ROOT, stdio: 'inherit' });
}
function revertPatch(patchAbs) {
  execSync(`git -C target_repo apply -R "${patchAbs}"`, { cwd: ROOT, stdio: 'inherit' });
}
function repoStatusPorcelain() {
  return execSync('git -C target_repo status --porcelain', { cwd: ROOT }).toString().trim();
}
function repoDiffMatchesPrepOnly() {
  const stat = execSync('git -C target_repo diff --stat', { cwd: ROOT }).toString().trim();
  return stat.includes('MainMenu.tsx') && stat.includes('1 insertion(+)');
}

const results = [];

// Sanity: target repo must be clean before the run.
if (repoStatusPorcelain() !== '') {
  console.error('target_repo is dirty before run; commit or revert first');
  process.exit(2);
}

// Apply prep_aria baseline for the whole run.
console.log('[prep] applying prep_aria.patch as trial baseline');
applyPatch(PREP_PATCH);
// Give vite HMR a beat.
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ headless: true });

// --- Target fitness pre-check ---
// On the prepped baseline, blank the recorded testid at runtime and confirm
// the matcher can heal via role+name fallback. This is C2 remediation: if the
// target is anchor-poor, halt before any mutation runs.
async function targetFitnessCheck() {
  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();
  try {
    const navStep = test.steps.find(s => s.action === 'navigate');
    await page.goto(navStep.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    // Strip data-testid from the recorded element (in-page only, does not
    // touch source). Then ask the matcher what it would do.
    const stripped = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="main-menu-trigger"]');
      if (!el) return { ok: false, reason: 'testid target not found on page' };
      el.removeAttribute('data-testid');
      return { ok: true };
    });
    if (!stripped.ok) return { ok: false, reason: stripped.reason };

    const anchor = test.steps.find(s => s.action === 'click')._anchor;
    const result = await page.evaluate((a) => {
      const r = window.SELFHEAL.matchStep(document, a, { gate: true });
      const ex = r.best ? r.best.ex : null;
      const loc = ex ? window.SELFHEAL.bestLocator(ex) : { sel: null, tier: 'none' };
      return {
        verdict: r.verdict,
        bestLocator: loc.sel,
        tier: loc.tier,
        score: r.best ? r.best.conf : null,
        margin: r.margin != null ? r.margin : null,
        via: r.via || null,
        diagnosis: r.diagnosis || null,
      };
    }, anchor);

    return { ok: result.verdict === 'heal', result };
  } finally {
    await context.close();
  }
}

console.log('\n=== target-fitness pre-check ===');
const fit = await targetFitnessCheck();
console.log(JSON.stringify(fit, null, 2));
if (!fit.ok) {
  console.error('\nTarget-fitness pre-check FAILED: matcher cannot heal via role+name fallback.');
  console.error('The heal path cannot be exercised on this target. Halting before mutation trials.');
  await browser.close();
  revertPatch(PREP_PATCH);
  process.exit(3);
}
console.log('Target-fitness pre-check PASSED — heal path is reachable via role+name.\n');

// --- Trial loop ---
for (const t of trials) {
  console.log(`\n=== trial ${t.id} (expects ${t.expectedOutcome}) ===`);

  // Before applying any per-trial mutation, the tree should reflect prep_aria only.
  if (!repoDiffMatchesPrepOnly()) {
    console.error(`  ! target_repo diff is not the expected prep-only baseline; skipping`);
    console.error(sh('git -C target_repo diff --stat'));
    continue;
  }

  const patchAbs = t.patch ? path.resolve(ROOT, t.patch) : null;
  if (patchAbs) {
    try { applyPatch(patchAbs); } catch (e) {
      console.error(`  ! failed to apply patch: ${e.message}`);
      continue;
    }
    // Give vite HMR a beat.
    await new Promise(r => setTimeout(r, 2500));
  }

  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();

  try {
    const row = await runTrial({
      page,
      test,
      mutation: t,
      trialId: `S1v2-${t.id}-trusted`,
      targetSha, libSha,
      eventMode: 'trusted',
    });
    fs.appendFileSync(trialsFile, JSON.stringify(row) + '\n');
    results.push(row);
    console.log(`  outcome=${row.outcome} verify=${row.verify_confidence} category=${row.category} healed=${row.healed} false_heal=${row.false_heal} latency=${row._trial_meta.latency_ms}ms`);
    if (row.diagnosis) console.log(`  diagnosis: ${row.diagnosis}`);
  } catch (e) {
    console.error(`  ! trial threw: ${e.message}`);
  } finally {
    await context.close();
    if (patchAbs) {
      try { revertPatch(patchAbs); } catch (e) { console.error(`  ! revert failed: ${e.message}`); }
    }
  }
}

await browser.close();

// Revert prep baseline.
console.log('\n[prep] reverting prep_aria.patch');
try { revertPatch(PREP_PATCH); } catch (e) { console.error(`  ! prep revert failed: ${e.message}`); }

// Gate check (v2 expectations)
const pristine = results.find(r => r._trial_meta.mutation_id === 'pristine');
const a1 = results.find(r => r._trial_meta.mutation_id === 'A1');
const b1 = results.find(r => r._trial_meta.mutation_id === 'B1');

const gate = {
  pristine_pass:      pristine && pristine.outcome === 'PASS' && !pristine.false_heal,
  a1_healed_and_pass: a1 && a1.outcome === 'PASS' && a1.healed === true && !a1.false_heal,
  b1_healed_and_pass: b1 && b1.outcome === 'PASS' && b1.healed === true && !b1.false_heal,
  aggregate_false_heal: results.reduce((s, r) => s + (r.false_heal ? 1 : 0), 0),
};

console.log('\n=== P1 v2 GATE ===');
console.log(JSON.stringify(gate, null, 2));
const passed = gate.pristine_pass && gate.a1_healed_and_pass && gate.b1_healed_and_pass && gate.aggregate_false_heal === 0;
console.log(passed ? '\nP1 v2 GATE: PASS — heal path empirically exercised\n' : '\nP1 v2 GATE: FAILED — see per-trial diagnosis\n');
process.exit(passed ? 0 : 1);
