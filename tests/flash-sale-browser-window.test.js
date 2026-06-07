const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

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

console.log('flash-sale browser window checks passed');
