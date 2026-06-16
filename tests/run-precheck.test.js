const assert = require('assert');
const fs = require('fs');
const path = require('path');

const precheck = require('../lib/run_precheck');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

const productResult = precheck.buildRunPrecheck({
  options: {
    tasks: { edit: true, flash: false },
    itemSelectionMode: 'range',
    itemStartIndex: 3,
    itemEndIndex: 5,
    count: 3,
    publish: false,
    processingMode: 'precise',
    sourcePriceExtraCny: 2,
    weightPaddingGrams: 30,
    buyOneTakeOne: true,
  },
  account: { label: '16612348880', complete: true },
});

assert.strictEqual(productResult.ok, true);
assert.deepStrictEqual(productResult.blockers, []);
assert.ok(
  productResult.preview.title.includes('编辑商品预检')
    && productResult.preview.lines.some((line) => line.includes('第 3-5 个商品'))
    && productResult.preview.lines.some((line) => line.includes('价格加价 2 元'))
    && productResult.preview.lines.some((line) => line.includes('买一送一规格：添加')),
  'Product precheck should describe the edit scope and edit preview.',
);
assert.ok(
  !productResult.warnings.some((line) => line.includes('跳过规则')),
  'Precheck should not mention removed task skip rules.',
);

const blockedResult = precheck.buildRunPrecheck({
  options: { tasks: { edit: true, flash: false }, count: 1 },
  account: null,
});
assert.strictEqual(blockedResult.ok, false);
assert.ok(blockedResult.blockers.some((line) => line.includes('没有找到可用账号')));

assert.ok(
  serverSource.includes('/api/run/precheck')
    && serverSource.includes('buildRunPrecheck')
    && !serverSource.includes('getSkipRules'),
  'The web server should expose a run precheck API without task-rule awareness.',
);
assert.ok(
  appSource.includes("requestJson('/api/run/precheck'")
    && appSource.includes('runPrecheck')
    && appSource.includes('formatPrecheckDetails'),
  'The UI should run precheck before showing the final start confirmation.',
);

console.log('run precheck checks passed');
