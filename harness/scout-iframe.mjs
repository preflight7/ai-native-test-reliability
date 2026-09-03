#!/usr/bin/env node
// Gap L spike — confirm the matcher only heals within the correct frame.
//
// Loads a data:text/html page with:
//   - a #target button in the MAIN document
//   - an iframe (#f1) containing its OWN #target button
// Then, given an anchor recorded from INSIDE the iframe (framePath=['#f1']),
// runs the matcher through the adapter's resolveFrame() path and asserts the
// resolved bestLocator points at the iframe's node — not the parent doc's.
//
// This spike is self-contained; it does not need the Excalidraw target.

import { chromium } from 'playwright';
import { injectLibrary, resolveFrame } from './selfheal-playwright-runtime.js';

const HTML = `
<!doctype html><html><body>
  <button id="target" data-testid="parent-btn">Parent Menu</button>
  <iframe id="f1" srcdoc='<!doctype html><html><body>
    <button id="target" data-testid="child-btn">Child Menu</button>
  </body></html>'></iframe>
</body></html>
`;

const anchor = {
  stepId: 'openMenuInFrame',
  action: 'click',
  framePath: ['#f1'],
  target: {
    descriptor: {
      role: { v: 'button', st: 0.9 },
      tag:  { v: 'button', st: 0.5 },
      name: { v: 'Child Menu', st: 0.5 },
      testid: { v: 'child-btn', st: 0.95 },
    },
    bestLocator: "[data-testid='child-btn']",
    uniqueAtRecord: true,
  },
  scope: { visibleOnly: true },
};

const anchorParent = {
  ...anchor,
  stepId: 'openMenuInParent',
  framePath: [],
  target: { ...anchor.target, descriptor: { ...anchor.target.descriptor, name: { v: 'Parent Menu', st: 0.5 }, testid: { v: 'parent-btn', st: 0.95 } }, bestLocator: "[data-testid='parent-btn']" },
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await injectLibrary(context);
const page = await context.newPage();

await page.goto('data:text/html,' + encodeURIComponent(HTML));
await page.waitForTimeout(300);

async function matchInFrame(scope, a) {
  return await scope.evaluate((aa) => {
    const r = window.SELFHEAL.matchStep(document, aa, { gate: true });
    const ex = r.best ? r.best.ex : null;
    const loc = ex ? window.SELFHEAL.bestLocator(ex) : { sel: null, tier: 'none' };
    return { verdict: r.verdict, bestLocator: loc.sel, tier: loc.tier, testidOnEl: r.best && r.best.el ? r.best.el.getAttribute('data-testid') : null };
  }, a);
}

const outcomes = {};

// 1) framePath=['#f1'] must resolve to the child frame and heal to the child button.
const childFrame = await resolveFrame(page, anchor.framePath);
const childScopeIsMain = childFrame === page.mainFrame();
const childMatch = await matchInFrame(childFrame, anchor);
outcomes.childFrame = { childScopeIsMain, ...childMatch };

// 2) framePath=[] must resolve to main frame and heal to the parent button.
const mainFrame = await resolveFrame(page, []);
const mainScopeIsMain = mainFrame === page.mainFrame();
const parentMatch = await matchInFrame(mainFrame, anchorParent);
outcomes.mainFrame = { mainScopeIsMain, ...parentMatch };

// 3) Negative test — pass the CHILD anchor with framePath=[] (wrong doc).
//    Matcher should NOT find a heal candidate (no child-btn in parent doc).
const crossMatch = await matchInFrame(mainFrame, { ...anchor, framePath: [] });
outcomes.crossFrameSanity = crossMatch;

console.log(JSON.stringify(outcomes, null, 2));

const ok =
  outcomes.childFrame.childScopeIsMain === false &&
  outcomes.childFrame.testidOnEl === 'child-btn' &&
  outcomes.mainFrame.mainScopeIsMain === true &&
  outcomes.mainFrame.testidOnEl === 'parent-btn' &&
  outcomes.crossFrameSanity.verdict !== 'heal';

console.log(ok ? '\nSCOUT-IFRAME: PASS — matcher scoped correctly per frame' : '\nSCOUT-IFRAME: FAIL — see outcomes above');
await browser.close();
process.exit(ok ? 0 : 1);
