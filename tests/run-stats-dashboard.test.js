const assert = require('assert');
const fs = require('fs');
const path = require('path');

const stats = require('../lib/run_stats');

const summary = stats.buildRunStats([
  { status: 'success', durationMs: 1000, diagnosticFailureType: '' },
  { status: 'error', durationMs: 3000, diagnosticFailureType: 'network' },
  { status: 'error', durationMs: 5000, diagnosticFailureType: 'network' },
  { status: 'stopped', durationMs: 1000, diagnosticFailureType: 'stopped' },
]);

assert.strictEqual(summary.totalRuns, 4);
assert.strictEqual(summary.successRuns, 1);
assert.strictEqual(summary.failedRuns, 2);
assert.strictEqual(summary.stoppedRuns, 1);
assert.strictEqual(summary.successRateText, '25%');
assert.strictEqual(summary.averageDurationText, '2秒');
assert.deepStrictEqual(summary.failureRanking.map((item) => `${item.label}:${item.count}`), [
  '网络/妙手服务异常:2',
  '人工停止:1',
]);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  serverSource.includes("require('./lib/run_stats')")
    && serverSource.includes('stats: buildRunStats(history)'),
  'Status responses should include run statistics derived from history.',
);
assert.ok(
  appSource.includes('dashboardStats')
    && appSource.includes('failureRanking')
    && appSource.includes('homeFailureCount')
    && appSource.includes('今日概况')
    && appSource.includes('成功率')
    && appSource.includes('失败记录'),
  'The home page should render a data statistics dashboard.',
);

console.log('run stats dashboard checks passed');
