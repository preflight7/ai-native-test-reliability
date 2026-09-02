// Capture the descriptor fields the library needs for the main-menu-trigger.
import { chromium } from 'playwright';
import fs from 'node:fs';

const bundle = fs.readFileSync('logs/selfheal-bundle.js', 'utf8');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript({ content: bundle });
const page = await context.newPage();

await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

// Ask the library to describe the button — this uses its own descriptor extraction.
const desc = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="main-menu-trigger"]');
  if (!el) return { error: 'element not found' };
  // Use library's WEB.extract if available
  const web = window.SELFHEAL && window.SELFHEAL.WEB;
  if (web && typeof web.extract === 'function') {
    return { via: 'library', ex: web.extract(el, document) };
  }
  // Fallback — read attributes manually
  return {
    via: 'manual',
    ex: {
      role: el.getAttribute('role') || 'button',
      tag: el.tagName.toLowerCase(),
      name: (el.textContent || '').trim() || el.getAttribute('aria-label') || null,
      nameAttr: el.getAttribute('aria-label') || null,
      testid: el.getAttribute('data-testid'),
      id: el.id || null,
      type: el.getAttribute('type') || null,
      cls: el.className || null,
    }
  };
});

console.log(JSON.stringify(desc, null, 2));

await browser.close();
