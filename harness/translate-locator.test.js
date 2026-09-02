#!/usr/bin/env node
// P1.4 tests — mocks `page` with a tiny stub so we can assert dispatch without Playwright.

import { translateBestLocator } from './translate-locator.js';

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else      { fail++; console.log(`  FAIL - ${name}${extra ? ' :: ' + extra : ''}`); }
}

// Stub page — records how it was called instead of returning a real Locator.
function stubPage() {
  const calls = [];
  return {
    _calls: calls,
    locator: (sel) => { calls.push({ fn: 'locator', arg: sel }); return { __k: 'css', sel }; },
    getByRole: (role, opts) => { calls.push({ fn: 'getByRole', role, opts }); return { __k: 'role', role, opts }; },
  };
}

// #id passes through to page.locator
{
  const p = stubPage();
  const r = translateBestLocator(p, '#help-button');
  assert('#id → page.locator("#help-button")', r.__k === 'css' && r.sel === '#help-button');
  assert('  no getByRole invoked', p._calls.every(c => c.fn === 'locator'));
}

// [attr="val"] passes through to page.locator
{
  const p = stubPage();
  const r = translateBestLocator(p, '[data-testid="x"]');
  assert('[attr] → page.locator("[data-testid=\\"x\\"]")', r.__k === 'css' && r.sel === '[data-testid="x"]');
}

// tag[attr="val"] passes through
{
  const p = stubPage();
  const r = translateBestLocator(p, 'form[action="/login"]');
  assert('tag[attr] → page.locator("form[action=...]")', r.__k === 'css' && r.sel === 'form[action="/login"]');
}

// role=button[name="Save"] translates to getByRole
{
  const p = stubPage();
  const r = translateBestLocator(p, 'role=button[name="Save"]');
  assert('role=button[name="Save"] → getByRole("button", {name:"Save"})',
         r.__k === 'role' && r.role === 'button' && r.opts.name === 'Save');
  assert('  no level for non-heading',
         !('level' in r.opts));
}

// role=heading[name="H"][level=2] translates with level
{
  const p = stubPage();
  const r = translateBestLocator(p, 'role=heading[name="H"][level=2]');
  assert('role=heading level=2 → getByRole with level:2',
         r.__k === 'role' && r.role === 'heading' && r.opts.name === 'H' && r.opts.level === 2);
}

// throws on empty
try { translateBestLocator(stubPage(), ''); assert('throws on empty string', false, 'did not throw'); }
catch (e) { assert('throws on empty string', /empty or non-string/.test(e.message)); }

// throws on non-string
try { translateBestLocator(stubPage(), null); assert('throws on null', false, 'did not throw'); }
catch (e) { assert('throws on null', /empty or non-string/.test(e.message)); }

// throws on unknown format
try { translateBestLocator(stubPage(), 'random-selector'); assert('throws on unknown format', false, 'did not throw'); }
catch (e) { assert('throws on unknown format', /unknown format/.test(e.message)); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
