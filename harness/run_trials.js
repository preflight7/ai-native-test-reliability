#!/usr/bin/env node
// P1.8 — Run the P1 trial set (pristine + A1 + B1) trusted-only.
// Emits one flywheel-event/v1 row per trial to logs/trials.jsonl.

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

// Resolve SHAs
const libSha = execSync('git -C lib rev-parse HEAD', { cwd: ROOT }).toString().trim();
const targetSha = execSync('git -C target_repo rev-parse HEAD', { cwd: ROOT }).toString().trim();

const trials = [
  { id: 'pristine', patch: null, expectedOutcome: 'PASS', driftKind: 'pristine' },
  { id: 'A1',       patch: 'mutations/mut_A1.patch', expectedOutcome: 'PASS',   driftKind: 'restyle' },
  { id: 'B1',       patch: 'mutations/mut_B1.patch', expectedOutcome: 'FAILED', driftKind: 'appbug' },
];

const results = [];

function applyPatch(patchRel) {
  if (!patchRel) return;
  execSync(`git -C target_repo apply "${path.resolve(ROOT, patchRel)}"`, { cwd: ROOT, stdio: 'inherit' });
}
function revertPatch(patchRel) {
  if (!patchRel) return;
  execSync(`git -C target_repo apply -R "${path.resolve(ROOT, patchRel)}"`, { cwd: ROOT, stdio: 'inherit' });
}
function statusClean() {
  const s = execSync('git -C target_repo status --porcelain', { cwd: ROOT }).toString().trim();
  return s === '';
}

const browser = await chromium.launch({ headless: true });

for (const t of trials) {
  console.log(`\n=== trial ${t.id} (expects ${t.expectedOutcome}) ===`);

  if (!statusClean()) {
    console.error(`  ! target_repo dirty before trial; skipping`);
    continue;
  }
  try { applyPatch(t.patch); } catch (e) {
    console.error(`  ! failed to apply patch: ${e.message}`);
    continue;
  }
  // Give vite HMR a beat to pick up source changes
  if (t.patch) await new Promise(r => setTimeout(r, 2500));

  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();

  try {
    const row = await runTrial({
      page,
      test,
      mutation: t,
      trialId: `S1-${t.id}-trusted`,
      targetSha, libSha,
    });
    fs.appendFileSync(trialsFile, JSON.stringify(row) + '\n');
    results.push(row);
    console.log(`  outcome=${row.outcome} verify=${row.verify_confidence} category=${row.category} false_heal=${row.false_heal} latency=${row._trial_meta.latency_ms}ms`);
    if (row.diagnosis) console.log(`  diagnosis: ${row.diagnosis}`);
  } catch (e) {
    console.error(`  ! trial threw: ${e.message}`);
  } finally {
    await context.close();
    try { revertPatch(t.patch); } catch (e) { console.error(`  ! revert failed: ${e.message}`); }
  }
}

await browser.close();

// Gate check
const pristine = results.find(r => r._trial_meta.mutation_id === 'pristine');
const a1 = results.find(r => r._trial_meta.mutation_id === 'A1');
const b1 = results.find(r => r._trial_meta.mutation_id === 'B1');

const gate = {
  pristine_pass: pristine && pristine.outcome === 'PASS' && !pristine.false_heal,
  a1_pass: a1 && a1.outcome === 'PASS' && !a1.false_heal,
  b1_refuse: b1 && (b1.outcome === 'FAILED' || b1.outcome === 'ABSTAIN') && !b1.false_heal,
  aggregate_false_heal: results.reduce((s, r) => s + (r.false_heal ? 1 : 0), 0),
};

console.log('\n=== P1 GATE ===');
console.log(JSON.stringify(gate, null, 2));
const passed = gate.pristine_pass && gate.a1_pass && gate.b1_refuse && gate.aggregate_false_heal === 0;
console.log(passed ? '\nP1 GATE: PASS — proceed to P2\n' : '\nP1 GATE: FAILED — halt, report to user\n');
process.exit(passed ? 0 : 1);
