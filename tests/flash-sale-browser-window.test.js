const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');
const collectSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_1688_collect.js'), 'utf8');

function extractFunctionBody(moduleSource, functionName) {
  const start = moduleSource.indexOf(`async function ${functionName}`);
  assert.notStrictEqual(start, -1, `${functionName} should exist.`);
  const openBrace = moduleSource.indexOf('{', start);
  let depth = 0;
  for (let index = openBrace; index < moduleSource.length; index += 1) {
    const char = moduleSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return moduleSource.slice(openBrace + 1, index);
      }
    }
  }
  return '';
}

assert.ok(
  source.includes('const DEFAULT_BROWSER_WINDOW_WIDTH = 1600;'),
  'Flash-sale browser should use a wide default window so captcha screenshots are not clipped.',
);
assert.ok(
  source.includes('const DEFAULT_BROWSER_WINDOW_HEIGHT = 1100;'),
  'Flash-sale browser should use a tall default window so login pages fit before screenshots.',
);
assert.ok(
  source.includes("'--start-maximized'"),
  'Chrome should be requested to start maximized for visible automation.',
);
assert.ok(
  source.includes('`--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`'),
  'Chrome launch should include an explicit window-size fallback.',
);
assert.ok(
  source.includes('async function ensureLargeBrowserViewport(page)'),
  'Script should have a viewport guard for pages created before login/captcha capture.',
);
assert.ok(
  source.includes('async function maximizeBrowserWindow(page)'),
  'Script should explicitly maximize the visible Chrome window, not only resize the page viewport.',
);
assert.ok(
  source.includes("Browser.getWindowForTarget"),
  'Script should locate the actual Chrome window for the active page.',
);
assert.ok(
  source.includes("Browser.setWindowBounds"),
  'Script should use Chrome DevTools window bounds API to maximize the OS window.',
);
assert.ok(
  source.includes("windowState: 'maximized'"),
  'Script should request a maximized browser window state.',
);
assert.ok(
  source.includes('await ensureLargeBrowserViewport(page);'),
  'Captcha capture/list page helpers should enlarge the active page before screenshots or navigation.',
);
assert.ok(
  source.includes('await ensureLargeBrowserViewport(listPage);'),
  'The initial flash-sale page should be enlarged before login detection.',
);

for (const [label, moduleSource] of [
  ['Flash sale', source],
  ['1688 collection', collectSource],
]) {
  const ensureBody = extractFunctionBody(moduleSource, 'ensureLargeBrowserViewport');
  assert.ok(
    ensureBody.includes('await maximizeBrowserWindow(page);'),
    `${label} should maximize the real Chrome window when preparing visible automation.`,
  );
  assert.ok(
    !/setViewport\s*\(\s*\{[\s\S]*width:\s*DEFAULT_BROWSER_WINDOW_WIDTH/.test(ensureBody),
    `${label} should not clamp the rendered page viewport to the fallback 1600px width after Chrome is maximized.`,
  );
}

console.log('flash-sale browser window checks passed');
