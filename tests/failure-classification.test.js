const assert = require('assert');
const fs = require('fs');
const path = require('path');

const classification = require('../lib/run_failure_classification');

assert.strictEqual(classification.classifyFailureText('请输入验证码后继续'), 'captcha');
assert.strictEqual(classification.classifyFailureText('登录已失效，请重新登录'), 'login');
assert.strictEqual(classification.classifyFailureText('HTTP 502 Bad Gateway'), 'network');
assert.strictEqual(classification.classifyFailureText('没有找到管理产品按钮'), 'selector');
assert.strictEqual(classification.classifyFailureText('商品数据缺失，detailId required'), 'data');
assert.strictEqual(classification.classifyFailureText('进程已停止：SIGTERM', { status: 'stopped' }), 'stopped');
assert.strictEqual(classification.failureTypeLabel('network'), '网络/妙手服务异常');

const diagnosticSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run_diagnostics.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  diagnosticSource.includes("require('./run_failure_classification')")
    && diagnosticSource.includes('classifyFailureText'),
  'Run diagnostics should use the shared failure classification helper.',
);
assert.ok(
  appSource.includes('failureTypeText')
    && appSource.includes('diagnosticFailureType'),
  'Recent records should display a readable failure type.',
);
assert.ok(
  serverSource.includes('diagnosticFailureType')
    && serverSource.includes('failureTypeLabel'),
  'History records should persist a readable failure type from diagnostics.',
);

console.log('failure classification checks passed');
