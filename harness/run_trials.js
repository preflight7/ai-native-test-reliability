#!/usr/bin/env node
// P2 — full mutation matrix: {pristine, A1, A2, A3, B1, B2, B3} × {trusted, synthetic}.
//
// Additions vs v2:
//  - New mutations A2 (icon wrap), A3 (outer wrapper div), B2 (duplicate injected),
//    B3 (route-form: no source patch; page.route delay).
//  - Runs every mutation in BOTH event modes (trusted, synthetic).
//  - Retry-3x on any gate-tripping outcome; modal outcome wins; retry_seq recorded.
//  - Per-row flywheel-event/v1 schema validation via lib/self-heal/schemas/validator.js.
//    A validation error kills the trial with a loud diagnosis; corrupt rows never
//    reach logs/trials.jsonl.
//  - Per-trial screenshot captured to logs/screenshots/<trialId>.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { runTrial, injectLibrary } from './selfheal-playwright-runtime.js';

// Load the library's UMD/IIFE schema files into a shared vm context so their
// `globalThis.SELFHEAL_*` assignments take effect. `require()` would fail here
// because package.json has `"type": "module"`, which nixes CJS resolution of
// bare `.js` files under lib/.
const _libCtx = vm.createContext({});
function _loadLib(rel) {
  const abs = path.resolve(new URL('.', import.meta.url).pathname, '..', rel);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), _libCtx, { filename: rel });
}
_loadLib('lib/self-heal/schemas/validator.js');
_loadLib('lib/self-heal/schemas/flywheel-event.schema.js');
const VALIDATOR = _libCtx.SELFHEAL_VALIDATOR;
const SCHEMA = _libCtx.SELFHEAL_SCHEMA_FLYWHEEL;
if (!VALIDATOR || typeof VALIDATOR.validate !== 'function') {
  throw new Error('validator failed to load into vm context');
}
if (!SCHEMA || !SCHEMA.EVENT) throw new Error('flywheel-event schema failed to load into vm context');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const test = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/authored-test.json'), 'utf8'));
const trialsFile = path.join(ROOT, 'logs/trials.jsonl');
const screenshotDir = path.join(ROOT, 'logs/screenshots');
fs.mkdirSync(path.dirname(trialsFile), { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });
fs.writeFileSync(trialsFile, '');

const libSha = execSync('git -C lib rev-parse HEAD', { cwd: ROOT }).toString().trim();
const targetSha = execSync('git -C target_repo rev-parse HEAD', { cwd: ROOT }).toString().trim();

const PREP_PATCH = path.resolve(ROOT, 'mutations/prep_aria.patch');

// Full P2 mutation set. Route-form (B3) carries `route` instead of `patch`.
const MUTATIONS = [
  { id: 'pristine', patch: null,                        expectedOutcome: 'PASS',    driftKind: 'pristine' },
  { id: 'A1',       patch: 'mutations/mut_A1.patch',    expectedOutcome: 'PASS',    driftKind: 'restyle' },
  { id: 'A2',       patch: 'mutations/mut_A2.patch',    expectedOutcome: 'PASS',    driftKind: 'restyle' },
  { id: 'A3',       patch: 'mutations/mut_A3.patch',    expectedOutcome: 'PASS',    driftKind: 'restyle' },
  { id: 'B1',       patch: 'mutations/mut_B1.patch',    expectedOutcome: 'PASS',    driftKind: 'restyle' },
  { id: 'B2',       patch: 'mutations/mut_B2.patch',    expectedOutcome: 'ABSTAIN', driftKind: 'restyle' },
  { id: 'B3',       route: { pattern: '**/*', delayMs: 500 }, expectedOutcome: 'PASS', driftKind: 'appbug' },
  // Gap I — heal_policy=never_heal on the recorded step. Reapplies mut_A1
  // (which normally heals cleanly) but the adapter must short-circuit to
  // ABSTAIN/POLICY before matchStep and never click.
  { id: 'never_heal_A1', patch: 'mutations/mut_A1.patch', expectedOutcome: 'ABSTAIN', driftKind: 'restyle',
    policies: { openMenu: 'never_heal' } },
];
const MODES = ['trusted', 'synthetic'];

function sh(cmd) { return execSync(cmd, { cwd: ROOT }).toString(); }
function applyPatch(p) { execSync(`git -C target_repo apply "${p}"`, { cwd: ROOT, stdio: 'inherit' }); }
function revertPatch(p) { execSync(`git -C target_repo apply -R "${p}"`, { cwd: ROOT, stdio: 'inherit' }); }
function repoStatusPorcelain() { return execSync('git -C target_repo status --porcelain', { cwd: ROOT }).toString().trim(); }
function repoDiffMatchesPrepOnly() {
  const stat = execSync('git -C target_repo diff --stat', { cwd: ROOT }).toString().trim();
  return stat.includes('MainMenu.tsx') && stat.includes('1 insertion(+)');
}

function isGateTripping(row) {
  const exp = row._trial_meta.expected_outcome;
  if (row.category === 'UNKNOWN' && /adapter-error/.test(row.diagnosis || '')) return true;
  if (row.outcome !== exp) return true;
  return false;
}

function modalRow(rows) {
  const counts = new Map();
  for (const r of rows) {
    const k = `${r.outcome}|${r.category}|${r.healed}|${r.false_heal}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bestK, bestC = -1;
  for (const [k, c] of counts) if (c > bestC) { bestK = k; bestC = c; }
  return rows.find(r => `${r.outcome}|${r.category}|${r.healed}|${r.false_heal}` === bestK);
}

function validateRow(row) {
  const { _trial_meta, ...core } = row;
  return VALIDATOR.validate(SCHEMA.EVENT, core);
}

// --- Boot ---
if (repoStatusPorcelain() !== '') {
  console.error('target_repo is dirty before run; commit or revert first');
  process.exit(2);
}
console.log('[prep] applying prep_aria.patch as trial baseline');
applyPatch(PREP_PATCH);
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ headless: true });

async function targetFitnessCheck() {
  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();
  try {
    const navStep = test.steps.find(s => s.action === 'navigate');
    await page.goto(navStep.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
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
      return { verdict: r.verdict, bestLocator: loc.sel, tier: loc.tier, score: r.best ? r.best.conf : null, margin: r.margin != null ? r.margin : null };
    }, anchor);
    return { ok: result.verdict === 'heal', result };
  } finally { await context.close(); }
}

console.log('\n=== target-fitness pre-check ===');
const fit = await targetFitnessCheck();
console.log(JSON.stringify(fit, null, 2));
if (!fit.ok) {
  console.error('\nTarget-fitness pre-check FAILED; halting.');
  await browser.close();
  revertPatch(PREP_PATCH);
  process.exit(3);
}
console.log('Target-fitness pre-check PASSED.\n');

async function runOne({ mut, mode, retrySeq }) {
  const patchAbs = mut.patch ? path.resolve(ROOT, mut.patch) : null;
  if (patchAbs) {
    try { applyPatch(patchAbs); } catch (e) { throw new Error(`apply ${mut.patch}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2500));
  }
  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();
  let row;
  try {
    row = await runTrial({
      page, test, mutation: mut,
      trialId: `S1v2-${mut.id}-${mode}${retrySeq ? `-r${retrySeq}` : ''}`,
      targetSha, libSha,
      eventMode: mode,
      screenshotDir,
      policies: mut.policies || null,
    });
    row._trial_meta.retry_seq = retrySeq;
  } finally {
    await context.close();
    if (patchAbs) { try { revertPatch(patchAbs); } catch (e) { console.error(`  ! revert failed: ${e.message}`); } }
  }
  return row;
}

const allRows = [];
const finalRows = [];

for (const mut of MUTATIONS) {
  for (const mode of MODES) {
    console.log(`\n=== ${mut.id} × ${mode} (expects ${mut.expectedOutcome}) ===`);
    if (mut.patch && !repoDiffMatchesPrepOnly()) {
      console.error(`  ! target_repo diff not the expected prep-only baseline; skipping`);
      console.error(sh('git -C target_repo diff --stat'));
      continue;
    }
    const attempts = [];
    for (let k = 0; k < 3; k++) {
      const row = await runOne({ mut, mode, retrySeq: k });
      const vr = validateRow(row);
      if (!vr.ok) {
        console.error(`  ! schema validation FAILED on attempt ${k}:`);
        for (const e of vr.errors) console.error(`      ${e.path}: ${e.msg}`);
        console.error('  ! corrupt row NOT appended; aborting this trial');
        break;
      }
      attempts.push(row);
      allRows.push(row);
      console.log(`  attempt#${k}: outcome=${row.outcome} verify=${row.verify_confidence} category=${row.category} healed=${row.healed} false_heal=${row.false_heal} latency=${row._trial_meta.latency_ms}ms`);
      if (row.diagnosis) console.log(`    diagnosis: ${row.diagnosis}`);
      if (!isGateTripping(row)) break;
    }
    if (attempts.length === 0) continue;
    const modal = modalRow(attempts);
    modal._trial_meta.attempts = attempts.length;
    modal._trial_meta.modal_of = attempts.map(a => a.outcome);
    fs.appendFileSync(trialsFile, JSON.stringify(modal) + '\n');
    finalRows.push(modal);
    console.log(`  → modal: outcome=${modal.outcome} (over ${attempts.length} attempts)`);
  }
}

await browser.close();
console.log('\n[prep] reverting prep_aria.patch');
try { revertPatch(PREP_PATCH); } catch (e) { console.error(`  ! prep revert failed: ${e.message}`); }

const falseHealTotal = finalRows.reduce((s, r) => s + (r.false_heal ? 1 : 0), 0);
console.log('\n=== P2 SUMMARY ===');
console.log(`total trials: ${finalRows.length} (target: ${MUTATIONS.length * MODES.length})`);
console.log(`aggregate false_heal: ${falseHealTotal}`);
for (const r of finalRows) {
  const m = r._trial_meta;
  console.log(`  ${m.mutation_id.padEnd(9)} ${m.event_mode.padEnd(10)} ${r.outcome.padEnd(8)} ${r.category.padEnd(12)} healed=${r.healed}  false_heal=${r.false_heal}  attempts=${m.attempts}`);
}
process.exit(0);
