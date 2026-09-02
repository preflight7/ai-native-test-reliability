// Use the library's own captureStep to build the anchor blobs, then save the fixture.
// Solves the {v,st} vs {value,stability} descriptor-shape confusion by never authoring by hand.
import { chromium } from 'playwright';
import fs from 'node:fs';

const bundle = fs.readFileSync('logs/selfheal-bundle.js', 'utf8');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript({ content: bundle });
const page = await context.newPage();

await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

const anchorOpen  = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="main-menu-trigger"]');
  return window.SELFHEAL.captureStep(el, document, { stepId: 'openMenu', action: 'click' });
});
const anchorClose = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="main-menu-trigger"]');
  return window.SELFHEAL.captureStep(el, document, { stepId: 'closeMenu', action: 'click' });
});

const fixture = {
  id: 'excalidraw-menu-toggle',
  title: 'Toggle Excalidraw main menu open then closed',
  kind: 'positive',
  goal: 'the main menu opens on first click and closes on second click',
  steps: [
    { action: 'navigate', url: 'http://localhost:3001/' },
    { action: 'click', target: 'main menu trigger (open)',  _anchor: anchorOpen },
    { action: 'click', target: 'main menu trigger (close)', _anchor: anchorClose },
  ],
  verify: { type: 'elementGone', sentinel: '[data-testid="dropdown-menu"]' },
};

fs.writeFileSync('fixtures/authored-test.json', JSON.stringify(fixture, null, 2));
console.log('captured fixture with steps:', fixture.steps.length);
console.log('sample descriptor keys:', Object.keys(anchorOpen.target.descriptor));
console.log('sample bestLocator:', anchorOpen.target.bestLocator);

await browser.close();
