const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const envExampleSource = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

assert.ok(
  serverSource.includes('function getBrowserOpenUrl(host, port)'),
  'Server should build a browser-safe URL instead of opening the bind address.',
);

assert.ok(
  serverSource.includes("return `http://127.0.0.1:${port}`;"),
  'Server should open 127.0.0.1 when the bind host is 0.0.0.0 or ::.',
);

assert.ok(
  serverSource.includes('function openBrowserForServer(url)')
    && serverSource.includes("process.env.WEB_OPEN_BROWSER === '0'"),
  'Server should support disabling automatic browser opening with WEB_OPEN_BROWSER=0.',
);

assert.ok(
  serverSource.includes("runOpenCommand('open', ['-a', 'Google Chrome', url])")
    && serverSource.includes("runOpenCommand('open', [url])"),
  'macOS should try Google Chrome first and fall back to the default browser.',
);

assert.ok(
  serverSource.includes('openBrowserForServer(browserUrl);'),
  'Server should open the browser after it starts listening.',
);

assert.ok(
  envExampleSource.includes('WEB_OPEN_BROWSER=1'),
  '.env.example should document automatic browser opening.',
);

console.log('web auto-open browser checks passed');
