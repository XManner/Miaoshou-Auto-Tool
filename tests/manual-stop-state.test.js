const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  serverSource.includes('run.stopRequested = true;'),
  'Manual stop should mark the active run as user-stopped before killing the child process.',
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
