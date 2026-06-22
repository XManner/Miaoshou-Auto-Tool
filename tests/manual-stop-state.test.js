const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const flashSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

assert.ok(
  serverSource.includes('run.stopRequested = true;'),
  'Manual stop should mark the active run as user-stopped before killing the child process.',
);

assert.ok(
  serverSource.includes('function hasChildExited(child)')
    && serverSource.includes('!hasChildExited(run.child)')
    && !serverSource.includes('!run.child.killed'),
  'Active run detection should wait for the child process to actually exit, not just for kill() to be called.',
);

assert.ok(
  serverSource.includes('STOP_FORCE_KILL_DELAY_MS')
    && serverSource.includes("run.child.kill('SIGKILL')"),
  'Manual stop should force-kill a process that ignores the first stop signal.',
);

assert.ok(
  flashSource.includes("process.once('SIGTERM'")
    && flashSource.includes('closeBrowserWithTimeout(activeBrowser)')
    && flashSource.includes('activeBrowser = browser;'),
  'Flash sale stop handling should close the automation browser before exiting.',
);

assert.ok(
  serverSource.includes("run.status = 'stopped';"),
  'Manual stop close handlers should persist a stopped status instead of an error status.',
);

assert.ok(
  /function processStderrChunk\(run, text\)[\s\S]{0,180}run\.stopRequested/.test(serverSource),
  'Stderr emitted after a manual stop should not be appended as a red execution error.',
);

assert.ok(
  appSource.includes("stopped: '已停止'"),
  'The UI should render a human-readable stopped status.',
);

assert.ok(
  appSource.includes("if (status === 'stopped')"),
  'The UI should give stopped runs their own neutral status color.',
);

console.log('manual stop state checks passed');
