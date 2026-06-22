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
    buyOneTakeOnePriceMarkupPercent: 90,
  },
  account: { label: '16612348880', complete: true },
});

assert.strictEqual(productResult.ok, true);
assert.deepStrictEqual(productResult.blockers, []);
assert.ok(
  productResult.preview.title.includes('编辑商品预检')
    && productResult.preview.lines.some((line) => line.includes('第 3-5 个商品'))
    && productResult.preview.lines.some((line) => line.includes('价格加价 2 元'))
    && productResult.preview.lines.some((line) => line.includes('买一送一规格：添加'))
    && productResult.preview.lines.some((line) => line.includes('加价比例 90%')),
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

const productManagementDryRunResult = precheck.buildRunPrecheck({
  options: {
    tasks: { productManagement: true },
    productManagementMaxPages: 5,
    productManagementRetainCount: 900,
    productManagementDryRun: true,
    productManagementStores: [],
  },
  account: { label: '16612348880', complete: true },
});
assert.strictEqual(productManagementDryRunResult.ok, true);
assert.deepStrictEqual(productManagementDryRunResult.blockers, []);
assert.ok(
  productManagementDryRunResult.preview.title.includes('商品管理预检')
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('上限店铺商品下架'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('扫描发布失败记录前 5 页'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('商店试用期'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('最多只能使用1000个产品列表'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('销量 0 到 0'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('100条/页'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('最后一页'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('超过 900 个'))
    && productManagementDryRunResult.preview.lines.some((line) => line.includes('只扫描')),
  'Product-management precheck should describe limit-store cleanup rules and dry-run mode.',
);

const productManagementManualStoresResult = precheck.buildRunPrecheck({
  options: {
    tasks: { productManagement: true },
    productManagementMaxPages: 5,
    productManagementRetainCount: 1200,
    productManagementDryRun: false,
    productManagementStores: ['X SEVEN SHOP PH-菲律宾'],
  },
  account: { label: '16612348880', complete: true },
});
assert.strictEqual(productManagementManualStoresResult.ok, true);
assert.deepStrictEqual(productManagementManualStoresResult.blockers, []);
assert.ok(
  productManagementManualStoresResult.preview.lines.some((line) => line.includes('手动指定 1 个店铺')),
  'Product-management precheck should describe manual store scope.',
);
assert.ok(
  productManagementManualStoresResult.preview.lines.some((line) => line.includes('直接使用店铺名')),
  'Product-management precheck should allow direct store-name search for manual stores.',
);
assert.ok(
  productManagementManualStoresResult.preview.lines.some((line) => line.includes('超过 1200 个')),
  'Product-management precheck should describe the configured retain count.',
);

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
