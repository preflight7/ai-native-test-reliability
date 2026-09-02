// Spike the main-menu toggle flow: click, capture what appears, click again, capture what disappears.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

async function summarize(label) {
  const d = await page.evaluate(() => {
    const testids = Array.from(document.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid'));
    const dropdown = document.querySelector('.dropdown-menu, [role="menu"], .Island.dropdown-menu');
    const menuItems = Array.from(document.querySelectorAll('.dropdown-menu-item, [role="menuitem"]')).map(e => (e.textContent || '').trim().slice(0, 40));
    return {
      testids_unique: Array.from(new Set(testids)),
      testid_count: testids.length,
      dropdown_present: !!dropdown,
      dropdown_html_snippet: dropdown ? dropdown.outerHTML.slice(0, 240) : null,
      menu_item_texts: menuItems.slice(0, 15),
    };
  });
  console.log(`\n== ${label} ==`);
  console.log('  testid count (all instances):', d.testid_count);
  console.log('  unique testids:', d.testids_unique.length);
  console.log('  dropdown present:', d.dropdown_present);
  console.log('  dropdown html:', d.dropdown_html_snippet);
  console.log('  menu items:', d.menu_item_texts);
}

await summarize('before any click');

await page.locator('[data-testid="main-menu-trigger"]').click();
await page.waitForTimeout(500);
await summarize('after 1st click (menu should be OPEN)');

await page.locator('[data-testid="main-menu-trigger"]').click();
await page.waitForTimeout(500);
await summarize('after 2nd click (menu should be CLOSED)');

await browser.close();
