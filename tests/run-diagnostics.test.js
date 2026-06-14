const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const diagnostics = require('../lib/run_diagnostics');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaoshou-diagnostics-'));
const artifactDir = path.join(tempDir, 'run-diagnostic-1');
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, 'index.json'), JSON.stringify({
  runId: 'run-diagnostic-1',
  artifacts: [
    {
      stage: 'process-activity',
      files: {
        screenshot: { name: 'page.png', url: '/api/diagnostics/run-diagnostic-1/artifacts/page.png' },
        html: { name: 'page.html', url: '/api/diagnostics/run-diagnostic-1/artifacts/page.html' },
      },
    },
  ],
}), 'utf8');

const run = {
  id: 'run-diagnostic-1',
  status: 'error',
  command: 'node miaoshou_auto.js --publish true',
  startedAt: '2026-06-10T00:00:00.000Z',
  endedAt: '2026-06-10T00:02:00.000Z',
  durationMs: 120000,
  error: '账号 13800138000 页面超时',
  account: { id: 'acct-1', label: '138****8000' },
  tasks: { edit: true, flash: false },
  progress: {
    phase: 'edit',
    phaseLabel: '编辑商品',
    completed: 3,
    total: 10,
    detailId: '2931851918',
  },
  summary: {
    totalCount: 10,
    successCount: 3,
    failedItems: [{ detailId: '2931851918', error: '保存失败' }],
  },
  logs: [
    { time: '2026-06-10T00:00:01.000Z', stream: 'system', text: '开始执行' },
    { time: '2026-06-10T00:01:59.000Z', stream: 'stderr', text: '账号 13800138000 页面超时' },
  ],
  stderr: 'first line\nsecond line\nthird line',
};

assert.strictEqual(
  diagnostics.classifyRunFailure(run),
  'timeout',
  'Diagnostic classification should recognize timeout failures.',
);

const diagnostic = diagnostics.buildRunDiagnostic(run, { dir: tempDir, logLimit: 1 });
assert.strictEqual(diagnostic.id, 'run-diagnostic-1');
assert.strictEqual(diagnostic.failureType, 'timeout');
assert.strictEqual(diagnostic.error, '账号 138****8000 页面超时');
assert.strictEqual(diagnostic.logs.length, 1);
assert.strictEqual(diagnostic.logs[0].text, '账号 138****8000 页面超时');
assert.strictEqual(diagnostic.stderrTail.includes('second line'), true);
assert.strictEqual(diagnostic.progress.detailId, '2931851918');
assert.strictEqual(diagnostic.artifacts.length, 1);
assert.strictEqual(diagnostic.artifacts[0].files.screenshot.name, 'page.png');

const saved = diagnostics.saveRunDiagnostic(run, { dir: tempDir, logLimit: 1 });
assert.strictEqual(saved.id, 'run-diagnostic-1');
assert.ok(saved.filePath.endsWith('run-diagnostic-1.json'));
assert.ok(fs.existsSync(saved.filePath), 'Diagnostic package should be written to disk.');

const loaded = diagnostics.loadRunDiagnostic('run-diagnostic-1', { dir: tempDir });
assert.strictEqual(loaded.id, 'run-diagnostic-1');
assert.strictEqual(loaded.failureType, 'timeout');

assert.strictEqual(
  diagnostics.saveRunDiagnostic({ id: 'ok-run', status: 'success' }, { dir: tempDir }),
  null,
  'Successful runs should not create failure diagnostics.',
);

assert.ok(
  serverSource.includes("require('./lib/run_diagnostics')")
    && serverSource.includes('saveRunDiagnostic(run')
    && serverSource.includes('diagnosticId')
    && serverSource.includes('/api/diagnostics/'),
  'The web server should save diagnostics and expose a diagnostics API.',
);

console.log('run diagnostics checks passed');
