// P1.5 — Minimum Playwright adapter for the self-heal library.
//
// SCOPE (P1): trusted event mode only, no screenshots, no retry loop.
// Contribution: replaces the library's in-page fixture + synthetic events with
// a real running app driven by Playwright's trusted click on healed selectors.
//
// Contract:
//   runTrial({ page, test, mutation, trialId, targetSha, libSha }) -> flywheelEventRow
//
// The row is flywheel-event/v1-shaped plus a `_trial_meta` sidecar for
// experiment metadata (mutation_id, latency, sha pins). The core fields are
// exactly the ones the library's schema validates.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateBestLocator } from './translate-locator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLE_PATH = path.resolve(__dirname, '..', 'logs', 'selfheal-bundle.js');

export async function injectLibrary(context) {
  if (!fs.existsSync(BUNDLE_PATH)) {
    throw new Error(`selfheal bundle missing at ${BUNDLE_PATH}. Run: node harness/bundle-library.js`);
  }
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  await context.addInitScript({ content: bundle });
}

// Run matcher inside the page. Strip HTMLElement — never crosses the boundary.
// Note: matchStep returns { verdict, best: {el, ex, conf}, margin } — bestLocator is
// a SEPARATE derivation via SELFHEAL.bestLocator(ex), not a field on `best`.
async function matchInPage(page, anchor) {
  return await page.evaluate((a) => {
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
}

// The core trial loop for one test run.
// `mutation` shape:
//   { id: 'A1' | 'B1' | ..., expectedOutcome: 'PASS'|'FAILED'|'ABSTAIN', driftKind: 'restyle'|'appbug'|... }
// `test` shape (our extension of the library's authored-test):
//   { id, goal, steps: [{action, url?, _anchor?}], verify: {type, sentinel} }
export async function runTrial({ page, test, mutation, trialId, targetSha, libSha }) {
  const startTime = Date.now();
  let outcome, verify_confidence, category, diagnosis = null;
  let healed = false;
  let false_heal = false;
  let firstTry = null;
  const stepLog = [];

  try {
    // Step 0: navigate (assumes first step is navigate)
    const navStep = test.steps.find(s => s.action === 'navigate');
    await page.goto(navStep.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200); // let React hydrate

    // Steps: click each in order, matching via library, translating, trusted-clicking.
    for (const step of test.steps) {
      if (step.action !== 'click') continue;
      const originalLocator = step._anchor.target.bestLocator;
      const match = await matchInPage(page, step._anchor);
      stepLog.push({ stepId: step._anchor.stepId, originalLocator, ...match });

      if (match.verdict !== 'heal' || !match.bestLocator) {
        outcome = match.verdict === 'abstain' ? 'ABSTAIN' : 'FAILED';
        verify_confidence = 'NONE';
        category = match.verdict === 'abstain' ? 'AMBIGUITY' : 'REMOVAL';
        diagnosis = `matcher ${match.verdict} at step ${step._anchor.stepId}`;
        break;
      }

      // Track whether the recorded bestLocator still resolved uniquely (firstTry semantics).
      const stillResolvesUniquely = await page.evaluate((sel) => {
        try {
          if (!/^[#\[a-z]/i.test(sel)) return null; // role= etc. not a CSS selector
          return document.querySelectorAll(sel).length === 1 ? true : false;
        } catch (e) { return null; }
      }, originalLocator);
      if (stillResolvesUniquely === false || match.bestLocator !== originalLocator) {
        healed = true;
        firstTry = firstTry === false ? false : false;
      } else if (stillResolvesUniquely === true && firstTry !== false) {
        firstTry = true;
      }

      // Translate + trusted click
      const loc = translateBestLocator(page, match.bestLocator);
      await loc.click({ timeout: 5000 });
      await page.waitForTimeout(400); // let the click's effect land
    }

    // Verify-by-effect: check sentinel state after the last click.
    if (!outcome) {
      const sentinelCount = await page.locator(test.verify.sentinel).count();
      const has = sentinelCount > 0;
      const expectType = test.verify.type; // 'elementGone' | 'textPresent'
      let passed = false;

      if (expectType === 'elementGone') {
        passed = !has;
        verify_confidence = 'HIGH';
      } else if (expectType === 'textPresent') {
        const pageText = await page.evaluate(() => document.body.innerText);
        passed = pageText.toLowerCase().includes(String(test.verify.value).toLowerCase());
        verify_confidence = 'MEDIUM';
      } else {
        verify_confidence = 'NONE';
      }

      outcome = passed ? 'PASS' : 'FAILED';
      category = passed ? 'VERIFIED' : 'APP_BUG';
      if (!passed) diagnosis = `verify(${expectType}) failed — sentinel=${test.verify.sentinel} present=${has}`;
    }

    // False-heal oracle (our contribution):
    //   A trial produces a false_heal when its outcome doesn't match the mutation's expectation.
    //     A-mutation expects PASS. If outcome is not PASS -> not false-heal here; that's a matcher/verify failure.
    //     B-mutation expects FAILED or ABSTAIN. If outcome is PASS -> false_heal=true.
    //   The library's isFalseHeal is identity-based; we adapt it to our expectation-based oracle by
    //   feeding it verdict='heal' + expectedVerdict='abstain' when outcome=PASS on a B-mutation.
    const expectedVerdict = mutation.expectedOutcome === 'PASS' ? 'heal' : 'abstain';
    const runtimeVerdict = outcome === 'PASS' ? 'heal' : 'abstain';
    const falseHealInput = {
      verdict: runtimeVerdict,
      expectedVerdict,
      resolvedIdentity: outcome === 'PASS' ? 'passed' : 'not-passed',
      expectedIdentity: mutation.expectedOutcome === 'PASS' ? 'passed' : 'not-passed',
    };
    false_heal = await page.evaluate(
      (fh) => window.SELFHEAL_FALSEHEAL.isFalseHeal(fh),
      falseHealInput
    );

  } catch (err) {
    outcome = 'FAILED';
    verify_confidence = 'NONE';
    category = 'UNKNOWN';
    diagnosis = 'adapter-error: ' + (err && err.message || String(err));
  }

  const latency_ms = Date.now() - startTime;

  return {
    schemaVersion: 'flywheel-event/v1',
    ts: new Date().toISOString(),
    app: 'excalidraw',
    testId: test.id,
    stepId: null,
    outcome,
    verify_confidence,
    category,
    source: 'live',
    driftKind: (mutation && mutation.driftKind) || 'pristine',
    healed,
    false_heal,
    firstTry,
    diagnosis,
    hitl_decision: null,
    _trial_meta: {
      trial_id: trialId,
      mutation_id: mutation ? mutation.id : null,
      expected_outcome: mutation ? mutation.expectedOutcome : null,
      event_mode: 'trusted',
      target_sha: targetSha,
      library_sha: libSha,
      latency_ms,
      retry_seq: 0,
      steps: stepLog,
    },
  };
}
