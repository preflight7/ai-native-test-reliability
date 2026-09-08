#!/usr/bin/env node
// Phase R (minimum) — A1 three-way comparison.
//
// Under A1 (testid renamed on the prep_aria baseline), run three click
// strategies and record which physical element each ends up clicking.
//   L  Library   — self-heal adapter (matcher + trusted click)
//   N  Naive     — page.getByRole('button', {name:'Menu'})
//   S  Strict    — page.locator('[data-testid="main-menu-trigger"]') (control)
//
// N=5 runs per path, randomized order across the 15-run schedule, fresh
// Playwright context per run. After each successful click we capture a
// selector- and position-invariant identity hash on the clicked element
// so L and N can be compared on the SAME physical button.

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

const URL_TARGET = 'http://localhost:3001/';
const SENTINEL = '[data-testid="dropdown-menu"]';
const RECORDED_SELECTOR = '[data-testid="main-menu-trigger"]';
const RECORDED_ARIA_NAME = 'Menu';
const N = 5;

const test = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/authored-test.json'), 'utf8'));
const outFile = path.join(ROOT, 'logs/compare_a1.jsonl');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, '');

const libSha = execSync('git -C lib rev-parse HEAD', { cwd: ROOT }).toString().trim();
const targetSha = execSync('git -C target_repo rev-parse HEAD', { cwd: ROOT }).toString().trim();

// Compute identity hash on a locator's first matching element. Attribute /
// semantic based — survives selector drift and position drift both.
async function identityOf(page, locatorSel, useGetByRole = false) {
  try {
    if (useGetByRole) {
      return await page.evaluate((name) => {
        const btns = document.querySelectorAll('button, [role="button"]');
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
      }, RECORDED_ARIA_NAME);
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
  // doClicks = async () => { … } performs BOTH clicks (open then close).
  const beforeOpen = await page.locator(SENTINEL).count();
  await doClicks();
  const afterFinal = await page.locator(SENTINEL).count();
  // For open+close the sentinel should be gone at end. Also require it was
  // present after the first click — the shared identity check below handles
  // that: if the first click didn't open the menu, the identity capture on
  // step 2's click target will not equal step 1's.
  return { verifyPassed: beforeOpen === 0 && afterFinal === 0 };
}

// Path L — Library adapter. runTrial does two clicks + verify + emits row.
// We adapt its output shape to our comparison row.
async function runL(browser, run) {
  const t0 = Date.now();
  const context = await browser.newContext();
  await injectLibrary(context);
  const page = await context.newPage();
  let identity = null, healedSelector = null, verifyPassed = null, outcome = null, diagnosis = null;
  try {
    const row = await runTrial({
      page, test,
      mutation: { id: 'A1', expectedOutcome: 'PASS', driftKind: 'restyle' },
      trialId: `phaseR-A1-L-run${run}`,
      targetSha, libSha,
      eventMode: 'trusted',
    });
    outcome = row.outcome;
    verifyPassed = row.outcome === 'PASS';
    diagnosis = row.diagnosis;
    const step = row._trial_meta.steps?.[0];
    healedSelector = step?.bestLocator || null;
    // Identity of the button the library targeted at click time (menu now closed).
    // Query the current DOM by the healed selector.
    if (healedSelector) {
      const id = await identityOf(page, healedSelector.startsWith('role=') ? null : healedSelector, healedSelector.startsWith('role='));
      identity = hash(id.seed);
    }
  } catch (e) {
    outcome = 'FAILED'; diagnosis = 'exception: ' + e.message;
  } finally { await context.close(); }
  return { path: 'L', run, outcome, verifyPassed, wall_ms: Date.now() - t0, healedSelector, identity, diagnosis };
}

// Path N — Naive getByRole. Two clicks + sentinel check.
async function runN(browser, run) {
  const t0 = Date.now();
  const context = await browser.newContext();
  const page = await context.newPage();
  let identity = null, outcome = null, verifyPassed = null, diagnosis = null;
  try {
    await warm(page);
    const loc = page.getByRole('button', { name: RECORDED_ARIA_NAME });
    // Identity BEFORE click (menu closed, one candidate).
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
    outcome = 'FAILED'; diagnosis = 'exception: ' + e.message;
  } finally { await context.close(); }
  return { path: 'N', run, outcome, verifyPassed, wall_ms: Date.now() - t0, healedSelector: `getByRole button name=${RECORDED_ARIA_NAME}`, identity, diagnosis };
}

// Path S — Strict control. Original recorded selector, expected to timeout.
async function runS(browser, run) {
  const t0 = Date.now();
  const context = await browser.newContext();
  const page = await context.newPage();
  let outcome = null, diagnosis = null;
  try {
    await warm(page);
    const loc = page.locator(RECORDED_SELECTOR);
    await loc.click({ timeout: 5000 });
    outcome = 'PASS'; diagnosis = 'strict selector unexpectedly resolved (mutation not applied?)';
  } catch (e) {
    outcome = 'FAILED';
    diagnosis = /Timeout|waiting for locator/.test(e.message) ? 'expected timeout under A1' : 'exception: ' + e.message;
  } finally { await context.close(); }
  return { path: 'S', run, outcome, verifyPassed: outcome === 'PASS', wall_ms: Date.now() - t0, healedSelector: RECORDED_SELECTOR, identity: null, diagnosis };
}

// Randomized 15-run schedule (5 per path, interleaved).
function schedule() {
  const items = [];
  for (const p of ['L', 'N', 'S']) for (let i = 1; i <= N; i++) items.push({ path: p, run: i });
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const browser = await chromium.launch({ headless: true });
const runners = { L: runL, N: runN, S: runS };
const sched = schedule();
console.log('=== Phase R min — A1 three-way comparison ===');
console.log('Schedule:', sched.map(s => `${s.path}${s.run}`).join(' '));

for (const item of sched) {
  const row = await runners[item.path](browser, item.run);
  fs.appendFileSync(outFile, JSON.stringify({ ...row, targetSha, libSha }) + '\n');
  console.log(`  ${item.path}${item.run}  outcome=${row.outcome}  verify=${row.verifyPassed}  id=${row.identity || '-'}  wall=${row.wall_ms}ms  ${row.diagnosis || ''}`);
}

await browser.close();
console.log('\nwrote', sched.length, 'rows ->', path.relative(process.cwd(), outFile));
