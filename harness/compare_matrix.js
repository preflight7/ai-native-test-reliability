#!/usr/bin/env node
// Phase R matrix — D1..D8 attribute-drift block, three-way comparison (L/N/S).
//
// Extends compare_a1.js: for each drift class, applies prep_aria + drift patch
// to experiment/target_repo, waits for HMR, then runs N=5 runs per path in a
// randomized interleaved schedule with a fresh Playwright context per run.
// Same identity-hash mechanism as compare_a1.js. Reverts drift between classes;
// prep_aria stays applied for the whole run and is reverted at the very end.
//
// Env:
//   URL_TARGET (default http://localhost:3002/)
//   MATRIX_N   (default 5)
//   ONLY       (comma-separated drift ids to include, e.g. "D1,D2")
//
// Skips D3 by design (recorded id was a hashed radix id, not useful).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { runTrial, injectLibrary } from './selfheal-playwright-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const URL_TARGET = process.env.URL_TARGET || 'http://localhost:3002/';
const SENTINEL = '[data-testid="dropdown-menu"]';
const RECORDED_SELECTOR = '[data-testid="main-menu-trigger"]';
const RECORDED_ARIA_NAME = 'Menu';
const N = Number(process.env.MATRIX_N || 5);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);

const DRIFTS = [
  { id: 'D1', patch: 'mut_A1.patch', desc: 'rename data-testid → menu-trigger-v2' },
  { id: 'D2', patch: 'mut_D2.patch', desc: 'rename className main-menu-trigger → menu-trigger-v2-cls' },
  // D3 skipped by design
  { id: 'D4', patch: 'mut_D4.patch', desc: 'rename data-testid AND aria-label' },
  { id: 'D5', patch: 'mut_D5.patch', desc: 'delete data-testid entirely' },
  { id: 'D6', patch: 'mut_D6.patch', desc: 'delete aria-label entirely' },
  { id: 'D7', patch: 'mut_D7.patch', desc: 'aria-label "Menu" → "Options"' },
  { id: 'D8', patch: 'mut_D8.patch', desc: 'add role="link" attribute' },
];

const test = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/authored-test.json'), 'utf8'));
// Rewrite navigation URL in the fixture to whatever we're actually pointed at.
for (const s of test.steps) if (s.action === 'navigate') s.url = URL_TARGET;

const outFile = path.join(ROOT, 'logs/matrix_d1_d8.jsonl');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, '');

const libSha = execSync('git -C lib rev-parse HEAD', { cwd: ROOT }).toString().trim();
const targetShaBase = execSync('git -C target_repo rev-parse HEAD', { cwd: ROOT }).toString().trim();

function gitApply(rel) {
  execSync(`git -C target_repo apply "${path.join(ROOT, 'mutations', rel)}"`, { cwd: ROOT });
}
function gitRevert(rel) {
  execSync(`git -C target_repo apply -R "${path.join(ROOT, 'mutations', rel)}"`, { cwd: ROOT });
}
function targetClean() {
  const s = execSync('git -C target_repo status --porcelain', { cwd: ROOT }).toString().trim();
  return s === '';
}

async function identityOf(page, locatorSel, useGetByRole = false, ariaName = RECORDED_ARIA_NAME) {
  try {
    if (useGetByRole) {
      return await page.evaluate((name) => {
        const btns = document.querySelectorAll('button, [role="button"], [role="link"]');
        for (const el of btns) {
          const aria = el.getAttribute('aria-label') || '';
          if (aria === name) {
            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute('role') || 'button';
            const acc = aria || (el.textContent || '').trim().slice(0, 64);
            const txt = (el.textContent || '').trim().slice(0, 64);
            return { seed: `${tag}|${role}|${acc}|${txt}`, found: true };
          }
        }
        return { seed: null, found: false };
      }, ariaName);
    } else {
      return await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { seed: null, found: false };
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || (tag === 'button' ? 'button' : '');
        const aria = el.getAttribute('aria-label') || '';
        const txt = (el.textContent || '').trim().slice(0, 64);
        const acc = aria || txt;
        return { seed: `${tag}|${role}|${acc}|${txt}`, found: true };
      }, locatorSel);
    }
  } catch { return { seed: null, found: false }; }
}
const hash = (seed) => seed ? crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12) : null;

async function warm(page) {
  await page.goto(URL_TARGET, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function verifyToggle(page, doClicks) {
  const beforeOpen = await page.locator(SENTINEL).count();
  await doClicks();
  const afterFinal = await page.locator(SENTINEL).count();
  return { verifyPassed: beforeOpen === 0 && afterFinal === 0 };
}

async function runL(browser, drift, run) {
  const t0 = Date.now();
  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();
  let identity = null, healedSelector = null, verifyPassed = null, outcome = null, diagnosis = null;
  try {
    const row = await runTrial({
      page, test,
      mutation: { id: drift.id, expectedOutcome: 'PASS', driftKind: 'attr' },
      trialId: `matrix-${drift.id}-L-run${run}`,
      targetSha: targetShaBase, libSha,
      eventMode: 'trusted',
    });
    outcome = row.outcome;
    verifyPassed = row.outcome === 'PASS';
    diagnosis = row.diagnosis;
    const step = row._trial_meta?.steps?.[0];
    healedSelector = step?.bestLocator || null;
    if (healedSelector) {
      const isRole = healedSelector.startsWith('role=');
      const id = await identityOf(page, isRole ? null : healedSelector, isRole);
      identity = hash(id.seed);
    }
  } catch (e) {
    outcome = 'FAILED'; diagnosis = 'exception: ' + e.message;
  } finally { await context.close(); }
  return { path: 'L', run, outcome, verifyPassed, wall_ms: Date.now() - t0, healedSelector, identityHash: identity, diagnosis };
}

async function runN(browser, drift, run) {
  const t0 = Date.now();
  const context = await browser.newContext();
  const page = await context.newPage();
  let identity = null, outcome = null, verifyPassed = null, diagnosis = null;
  try {
    await warm(page);
    const loc = page.getByRole('button', { name: RECORDED_ARIA_NAME });
    const id0 = await identityOf(page, null, true);
    identity = hash(id0.seed);
    const { verifyPassed: vp } = await verifyToggle(page, async () => {
      await loc.click({ timeout: 5000 });
      await page.waitForTimeout(400);
      await loc.click({ timeout: 5000 });
      await page.waitForTimeout(400);
    });
    verifyPassed = vp;
    outcome = vp ? 'PASS' : 'FAILED';
    if (!vp) diagnosis = 'sentinel toggle failed';
  } catch (e) {
    outcome = 'FAILED';
    diagnosis = /Timeout|waiting for locator|strict mode violation/i.test(e.message) ? `naive locator failed: ${e.message.split('\n')[0]}` : 'exception: ' + e.message;
  } finally { await context.close(); }
  return { path: 'N', run, outcome, verifyPassed, wall_ms: Date.now() - t0, healedSelector: `getByRole button name=${RECORDED_ARIA_NAME}`, identityHash: identity, diagnosis };
}

async function runS(browser, drift, run) {
  const t0 = Date.now();
  const context = await browser.newContext();
  const page = await context.newPage();
  let outcome = null, diagnosis = null, identity = null;
  try {
    await warm(page);
    const loc = page.locator(RECORDED_SELECTOR);
    const id0 = await identityOf(page, RECORDED_SELECTOR, false);
    identity = hash(id0.seed);
    await loc.click({ timeout: 5000 });
    outcome = 'PASS'; diagnosis = 'strict selector still resolved';
  } catch (e) {
    outcome = 'FAILED';
    diagnosis = /Timeout|waiting for locator/i.test(e.message) ? 'expected timeout — testid missing/renamed' : 'exception: ' + e.message;
  } finally { await context.close(); }
  return { path: 'S', run, outcome, verifyPassed: outcome === 'PASS', wall_ms: Date.now() - t0, healedSelector: RECORDED_SELECTOR, identityHash: identity, diagnosis };
}

function schedule() {
  const items = [];
  for (const p of ['L', 'N', 'S']) for (let i = 1; i <= N; i++) items.push({ path: p, run: i });
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// --- main ---

if (!targetClean()) {
  console.error('FATAL: target_repo not clean at start. Aborting.');
  process.exit(2);
}
console.log(`applying prep_aria (baseline for all drift classes)...`);
gitApply('prep_aria.patch');
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ headless: true });
const runners = { L: runL, N: runN, S: runS };
const summary = [];

try {
  for (const drift of DRIFTS) {
    if (ONLY.length && !ONLY.includes(drift.id)) continue;
    console.log(`\n=== ${drift.id}: ${drift.desc} ===`);
    gitApply(drift.patch);
    await new Promise(r => setTimeout(r, 2500)); // HMR settle

    const sched = schedule();
    console.log('schedule:', sched.map(s => `${s.path}${s.run}`).join(' '));
    const rows = [];
    let adapterErrors = 0;

    for (const item of sched) {
      const row = await runners[item.path](browser, drift, item.run);
      const full = { drift_class: drift.id, ...row, targetSha: targetShaBase, libSha };
      fs.appendFileSync(outFile, JSON.stringify(full) + '\n');
      rows.push(full);
      const isAdapterErr = item.path === 'L' && /exception:/.test(row.diagnosis || '');
      if (isAdapterErr) adapterErrors++;
      console.log(`  ${item.path}${item.run}  ${row.outcome}  verify=${row.verifyPassed}  id=${row.identityHash || '-'}  wall=${row.wall_ms}ms  ${row.diagnosis || ''}`);
    }

    // Stop-and-ask condition: if all 5 L runs errored, halt.
    if (adapterErrors >= 5) {
      console.error(`\nHALT: ${drift.id} produced adapter errors on all ${adapterErrors} L runs. Reverting and stopping.`);
      gitRevert(drift.patch);
      process.exitCode = 3;
      break;
    }

    const lRows = rows.filter(r => r.path === 'L');
    const nRows = rows.filter(r => r.path === 'N');
    const sRows = rows.filter(r => r.path === 'S');
    const lPass = lRows.filter(r => r.verifyPassed).length;
    const nPass = nRows.filter(r => r.verifyPassed).length;
    const sPass = sRows.filter(r => r.verifyPassed).length;
    const sameElem = (() => {
      let matches = 0, comparable = 0;
      for (let i = 1; i <= N; i++) {
        const l = lRows.find(r => r.run === i), n = nRows.find(r => r.run === i);
        if (l?.identityHash && n?.identityHash) {
          comparable++;
          if (l.identityHash === n.identityHash) matches++;
        }
      }
      return { matches, comparable };
    })();
    summary.push({ id: drift.id, desc: drift.desc, lPass, nPass, sPass, sameElem, rows });

    gitRevert(drift.patch);
    console.log(`  → L ${lPass}/${N}  N ${nPass}/${N}  S ${sPass}/${N}  same-elem ${sameElem.matches}/${sameElem.comparable}`);
  }
} finally {
  console.log('\nreverting prep_aria...');
  try { gitRevert('prep_aria.patch'); } catch (e) { console.error('revert failed:', e.message); }
  await browser.close();
}

// Print grid summary
console.log('\n=== 7×3 heal-rate grid ===');
console.log('drift  L    N    S    same-elem  desc');
for (const s of summary) {
  console.log(`${s.id}     ${s.lPass}/${N}  ${s.nPass}/${N}  ${s.sPass}/${N}  ${s.sameElem.matches}/${s.sameElem.comparable}       ${s.desc}`);
}
console.log(`\nwrote ${summary.reduce((a, s) => a + s.rows.length, 0)} rows -> ${path.relative(process.cwd(), outFile)}`);
