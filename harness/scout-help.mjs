// Spike — check whether Excalidraw has a Help dialog + what testids/roles are around it.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000); // let React settle

// 1) Any element with a data-testid?
const testids = await page.$$eval('[data-testid]', els =>
  Array.from(new Set(els.map(e => e.getAttribute('data-testid')))).slice(0, 40));
console.log('First 40 unique data-testids on the page:');
testids.forEach(t => console.log('  ' + t));
console.log('total unique testids:', testids.length);

// 2) Look for anything help-shaped
const helpish = await page.$$eval('*', els => {
  const hits = [];
  for (const e of els) {
    const testid = e.getAttribute('data-testid');
    const aria = e.getAttribute('aria-label');
    const title = e.getAttribute('title');
    const txt = (e.textContent || '').trim().slice(0, 30);
    const str = [testid, aria, title, txt].filter(Boolean).join(' | ');
    if (/help|shortcut|\?/i.test(str)) {
      hits.push({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role'),
        testid, aria, title,
        text: txt,
      });
    }
  }
  return hits.slice(0, 20);
});
console.log('\nHelp-shaped elements:');
helpish.forEach(h => console.log('  ' + JSON.stringify(h)));

// 3) Existence of dialog/modal roles
const dialogs = await page.$$eval('[role="dialog"]', els => els.length);
console.log('\nvisible dialogs on load:', dialogs);

await browser.close();
