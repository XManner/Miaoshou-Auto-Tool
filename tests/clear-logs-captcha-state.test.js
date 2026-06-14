const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

const clearLogsMatch = serverSource.match(/function clearCurrentRunLogs\(\) \{([\s\S]*?)\n\}/);
assert.ok(clearLogsMatch, 'Missing clearCurrentRunLogs function.');
const clearLogsBody = clearLogsMatch[1];

assert.ok(
  clearLogsBody.includes('currentRun.captcha = null;'),
  'Clearing current logs should also clear any stale captcha prompt state on the server.',
);
assert.ok(
  clearLogsBody.includes('isRunActive(currentRun)'),
  'Clearing logs should preserve the active run while it is still running.',
);
assert.ok(
  clearLogsBody.includes('currentRun = null;'),
  'Clearing logs after a run has ended should reset the visible run status.',
);
assert.ok(
  appSource.includes("captchaCode.value = '';"),
  'The Vue app should clear the local captcha input after log cleanup or status refresh.',
);
assert.ok(
  appSource.includes("displayRun.captcha.status === 'waiting'"),
  'The captcha panel should only render while the current page run is waiting for captcha input.',
);
assert.ok(
  appSource.includes('<img :src="displayRun.captcha.imageUrl"'),
  'The Vue captcha panel should bind the latest captcha image URL.',
);
assert.ok(
  /\.captcha-image-wrap\s*\{[^}]*overflow:\s*visible;/.test(styles)
    && /\.captcha-image-wrap img\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/.test(styles)
    && !/\.captcha-image-wrap\s*\{[^}]*max-height:\s*420px;/.test(styles),
  'The captcha image should fit the panel instead of being clipped inside a fixed-height scroller.',
);

console.log('clear logs captcha state checks passed');
