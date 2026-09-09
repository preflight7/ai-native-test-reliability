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

// Run matcher inside the page (or inside a specific Frame). Strip HTMLElement —
// never crosses the boundary.
// Note: matchStep returns { verdict, best: {el, ex, conf}, margin } — bestLocator is
// a SEPARATE derivation via SELFHEAL.bestLocator(ex), not a field on `best`.
async function matchInScope(scope, anchor) {
  return await scope.evaluate((a) => {
    // matchAndEmit (2026-09-09) collapses matchStep + bestLocator into one path
    // that also enforces uniqueness on the emitted selector against the current
    // DOM. Fixes the ambiguity-firewall gap where an ancestor testid inherited
    // from a component-library primitive would emit an ambiguous selector.
    const emit = window.SELFHEAL.matchAndEmit || null;
    const r = emit
      ? emit(document, a, { gate: true })
      : (() => {
          // Fallback for older bundles without matchAndEmit.
          const s = window.SELFHEAL.matchStep(document, a, { gate: true });
          const ex = s.best ? s.best.ex : null;
          const loc = ex ? window.SELFHEAL.bestLocator(ex) : { sel: null, tier: 'none' };
          return { ...s, bestLocator: loc.sel, tier: loc.tier };
        })();
    return {
      verdict: r.verdict,
      bestLocator: r.bestLocator,
      tier: r.tier,
      score: r.best ? r.best.conf : null,
      margin: r.margin != null ? r.margin : null,
      via: r.via || null,
      diagnosis: r.diagnosis || null,
      emitCount: r.emitCount != null ? r.emitCount : null,
    };
  }, anchor);
}

// Resolve _anchor.framePath (array of CSS selectors, outermost -> innermost) to
// a Playwright Frame. Returns page.mainFrame() for [] / missing. Each hop must
// resolve to exactly one iframe or we throw — never guess across frames.
export async function resolveFrame(page, framePath) {
  if (!framePath || !framePath.length) return page.mainFrame();
  let handle = null;
  for (const sel of framePath) {
    const loc = handle ? handle.frameLocator(sel) : page.frameLocator(sel);
    const els = await (handle ? handle.locator(sel) : page.locator(sel)).count();
    if (els !== 1) throw new Error(`framePath hop ${JSON.stringify(sel)} matched ${els} iframes (need 1)`);
    handle = loc;
  }
  // Convert FrameLocator -> Frame via a body handle so we can call .evaluate().
  const bodyEl = await handle.locator('body').elementHandle({ timeout: 5000 });
  if (!bodyEl) throw new Error('framePath resolved but body handle missing');
  const frame = await bodyEl.ownerFrame();
  return frame;
}

// Translate against a scope (page or frame). Playwright's Locator API differs
// between Page and Frame, but both expose .locator(sel) with matching semantics
// so translateBestLocator receives whichever the caller passed.
function scopeLocatorFactory(scope) {
  return { locator: (sel) => scope.locator(sel) };
}

// The core trial loop for one test run.
// `mutation` shape:
//   { id: 'A1' | 'B1' | ..., expectedOutcome: 'PASS'|'FAILED'|'ABSTAIN', driftKind: 'restyle'|'appbug'|... }
// `test` shape (our extension of the library's authored-test):
//   { id, goal, steps: [{action, url?, _anchor?}], verify: {type, sentinel} }
export async function runTrial({ page, test, mutation, trialId, targetSha, libSha, eventMode = 'trusted', policies = null, screenshotDir = null }) {
  const startTime = Date.now();
  let outcome, verify_confidence, category, diagnosis = null;
  let healed = false;
  let false_heal = false;
  let firstTry = null;
  const stepLog = [];
  let screenshotPath = null;

  // Route-form mutation (B3 shape): install request interception for the whole trial.
  if (mutation && mutation.route) {
    const { pattern, delayMs = 0, mode = 'delay' } = mutation.route;
    await page.route(pattern, async (route) => {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      try {
        if (mode === 'abort') await route.abort();
        else await route.continue();
      } catch (e) { /* nav aborted */ }
    });
  }

  try {
    // Step 0: navigate (assumes first step is navigate)
    const navStep = test.steps.find(s => s.action === 'navigate');
    await page.goto(navStep.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200); // let React hydrate

    // Optional in-page brain wired with per-step policies for this trial. Kept
    // page-local (not persisted) — the trial harness owns policy state.
    if (policies) {
      await page.evaluate(({ testId, entries }) => {
        window.__TRIAL_BRAIN = window.SELFHEAL_BRAIN.makeBrain();
        for (const [stepId, policy] of entries) {
          window.__TRIAL_BRAIN.setPolicy(testId, stepId, policy);
        }
      }, { testId: test.id, entries: Object.entries(policies) });
    }

    // Steps: click each in order, matching via library, translating, trusted-clicking.
    for (const step of test.steps) {
      if (step.action !== 'click') continue;
      const originalLocator = step._anchor.target.bestLocator;
      const stepId = step._anchor.stepId;

      // Gap I — policy check BEFORE matcher.
      // never_heal: abstain-shaped row, no matcher, no click, category=POLICY.
      // review_only: run matcher to emit a candidate, but never click; outcome=REVIEW.
      const policy = policies ? (policies[stepId] || 'auto') : 'auto';
      if (policy === 'never_heal') {
        stepLog.push({ stepId, originalLocator, policy, verdict: 'abstain', bestLocator: null, tier: 'none', score: null, margin: null, via: 'policy:never_heal', diagnosis: null });
        outcome = 'ABSTAIN';
        verify_confidence = 'NONE';
        category = 'POLICY';
        diagnosis = `policy=never_heal at step ${stepId}`;
        break;
      }

      // Gap L — resolve to the right Frame per step. framePath [] = main frame.
      const framePath = step._anchor.framePath || [];
      const scope = await resolveFrame(page, framePath);

      const match = await matchInScope(scope, step._anchor);
      stepLog.push({ stepId, originalLocator, policy, framePath, ...match });

      if (match.verdict !== 'heal' || !match.bestLocator) {
        outcome = match.verdict === 'abstain' ? 'ABSTAIN' : 'FAILED';
        verify_confidence = 'NONE';
        category = match.verdict === 'abstain' ? 'AMBIGUITY' : 'REMOVAL';
        diagnosis = `matcher ${match.verdict} at step ${stepId}`;
        break;
      }

      if (policy === 'review_only') {
        // Matcher emitted a candidate; policy blocks the act. Emit REVIEW and stop.
        outcome = 'REVIEW';
        verify_confidence = 'NONE';
        category = 'POLICY';
        diagnosis = `policy=review_only at step ${stepId} (candidate ${match.bestLocator} suppressed)`;
        break;
      }

      // Track whether the recorded bestLocator still resolved uniquely (firstTry semantics).
      const stillResolvesUniquely = await scope.evaluate((sel) => {
        try {
          if (!/^[#\[a-z]/i.test(sel)) return null; // role= etc. not a CSS selector
          return document.querySelectorAll(sel).length === 1 ? true : false;
        } catch (e) { return null; }
      }, originalLocator);
      if (stillResolvesUniquely === false || match.bestLocator !== originalLocator) {
        healed = true;
        firstTry = false;
      } else if (stillResolvesUniquely === true && firstTry !== false) {
        firstTry = true;
      }

      // Translate + click. eventMode='trusted' → Playwright's real click (fires
      // isTrusted=true DOM events). eventMode='synthetic' → in-page
      // element.click() (isTrusted=false; mirrors the library's built-in
      // fixture behavior). Only CSS-form bestLocators are click-in-page-able —
      // role= etc. can't be querySelector'd, so we fall back to trusted for
      // those regardless of the requested mode and record it.
      const sel = match.bestLocator;
      const isCssSel = /^[#\[a-z*.]/i.test(sel) && !sel.startsWith('role=');
      if (eventMode === 'synthetic' && isCssSel) {
        const clicked = await scope.evaluate((s) => {
          const els = document.querySelectorAll(s);
          if (els.length !== 1) return { ok: false, count: els.length };
          els[0].click();
          return { ok: true };
        }, sel);
        if (!clicked.ok) throw new Error(`synthetic click: selector matched ${clicked.count} elements`);
      } else {
        const loc = translateBestLocator(scope, sel);
        await loc.click({ timeout: 5000 });
      }
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
    // POLICY / REVIEW outcomes are policy-gated, not matcher-gated — they never
    // touch the click path, so they can never be false-heals. Short-circuit.
    if (outcome === 'ABSTAIN' && category === 'POLICY') {
      // never_heal — treat as an explicit non-heal, false_heal=false regardless.
    }
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

  // Capture per-trial screenshot (best-effort — page may be closed on error).
  if (screenshotDir) {
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
      screenshotPath = path.join(screenshotDir, `${trialId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 5000 });
    } catch (e) {
      screenshotPath = null;
    }
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
      event_mode: eventMode,
      target_sha: targetSha,
      library_sha: libSha,
      latency_ms,
      retry_seq: 0,
      steps: stepLog,
      screenshot: screenshotPath,
    },
  };
}
