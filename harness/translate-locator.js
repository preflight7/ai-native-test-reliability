// P1.4 — Translate library's bestLocator string into a Playwright Locator.
// Throws on unknown formats — silent fallback would hide adapter bugs
// and let a wrong-element click reach the trusted-events path.
//
// Format zoo (from selfheal-core.js + brain.js.isRealAnchor + code inspection):
//   #id                          -> valid CSS
//   [attr="val"]                 -> valid CSS
//   [name="val"]                 -> valid CSS
//   [data-testid="val"]          -> valid CSS
//   form[action="url"]           -> valid CSS
//   role=button[name="Save"]     -> pseudo-selector (NOT valid CSS); translate to getByRole
//
// If library emits shapes not listed here, throw so we notice and extend.

export function translateBestLocator(page, bestLocator) {
  if (typeof bestLocator !== 'string' || !bestLocator) {
    throw new Error(`translateBestLocator: empty or non-string input: ${JSON.stringify(bestLocator)}`);
  }

  // CSS forms (real selectors)
  if (bestLocator.startsWith('#') || bestLocator.startsWith('[')) {
    return page.locator(bestLocator);
  }

  // form[…], input[…], button[…] etc — tag-prefixed attribute selectors are real CSS
  if (/^[a-z][a-z0-9]*\[/i.test(bestLocator)) {
    return page.locator(bestLocator);
  }

  // role=button[name="Save"] or role=button[name='Save'] pseudo-selector
  const roleMatch = bestLocator.match(/^role=([a-z]+)\[name=['"]([^'"]+)['"]\](?:\[level=(\d+)\])?/i);
  if (roleMatch) {
    const [, role, name, level] = roleMatch;
    const opts = { name };
    if (level) opts.level = parseInt(level, 10);
    return page.getByRole(role, opts);
  }

  throw new Error(`translateBestLocator: unknown format: ${bestLocator}`);
}
