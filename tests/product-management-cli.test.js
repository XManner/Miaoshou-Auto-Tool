const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'miaoshou_product_management.js');
const helperPath = path.join(repoRoot, 'lib', 'product_limit_store_cleanup.js');

assert.ok(
  fs.existsSync(cliPath),
  'miaoshou_product_management.js should exist for the product-management CLI.',
);

assert.ok(
  fs.existsSync(helperPath),
  'lib/product_limit_store_cleanup.js should exist for product-limit cleanup rules and workflow.',
);

const cliSource = fs.readFileSync(cliPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const cleanupRules = require('../lib/product_limit_store_cleanup.js');
const {
  PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES,
  parseProductManagementArgs,
} = require('../miaoshou_product_management.js');
const {
  buildLimitStoreSummary,
  getPaginationStateFromItems,
  normalizeStoreOptionText,
  resolveManualStoreTargets,
} = cleanupRules;

assert.ok(
  cliSource.includes("const PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';"),
  'CLI should declare the stable product-management task name.',
);

assert.ok(
  cliSource.includes('function parseProductManagementArgs(argv = process.argv.slice(2))'),
  'CLI should expose product-management argument parsing.',
);

assert.strictEqual(
  PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES,
  'unpublish-limit-stores',
  'Task constant should match the supported cleanup task.',
);

assert.deepStrictEqual(
  parseProductManagementArgs([]),
  {
    task: 'unpublish-limit-stores',
    maxPages: 5,
    dryRun: false,
    retainCount: 900,
    stores: [],
  },
  'Parser should provide safe defaults.',
);

assert.deepStrictEqual(
  parseProductManagementArgs([
    '--task', 'unpublish-limit-stores',
    '--max-pages', '3',
    '--dry-run',
    '--retain-count', '1200',
    '--stores', 'X SEVEN SHOP PH-菲律宾, BEAUTY LIFE-马来',
  ]),
  {
    task: 'unpublish-limit-stores',
    maxPages: 3,
    dryRun: true,
    retainCount: 1200,
    stores: ['X SEVEN SHOP PH-菲律宾', 'BEAUTY LIFE-马来'],
  },
  'Parser should support task, max-pages, dry-run, retain-count, and stores options.',
);

assert.deepStrictEqual(
  parseProductManagementArgs([
    '--stores', 'BEAUTY LIFE-马来, PLAIN SHOP-菲律宾',
  ]).stores,
  ['BEAUTY LIFE-马来', 'PLAIN SHOP-菲律宾'],
  'Parser should preserve explicit country suffixes in manual store text.',
);

assert.deepStrictEqual(
  parseProductManagementArgs(['--stores', 'PLAIN SHOP']).stores,
  ['PLAIN SHOP'],
  'Parser should accept bare manual store names for direct store-name search.',
);

assert.throws(
  () => parseProductManagementArgs(['--task', 'unknown-task']),
  /不支持的商品管理任务/,
  'Parser should reject unsupported product-management tasks.',
);

assert.throws(
  () => parseProductManagementArgs(['--retain-count', '-1']),
  /--retain-count 必须是大于等于 0 的整数/,
  'Parser should reject invalid retain-count values.',
);

assert.strictEqual(
  normalizeStoreOptionText('X SEVEN SHOP PH-菲律宾'),
  'X SEVEN SHOP PH-菲律宾',
  'Store option normalization should preserve a complete country-qualified store option.',
);

assert.deepStrictEqual(
  resolveManualStoreTargets(['X SEVEN SHOP PH']),
  [
    {
      storeName: 'X SEVEN SHOP PH',
      storeOptionText: '',
      failureCount: 1,
    },
  ],
  'Manual store target resolution should keep bare store names for direct search.',
);

assert.deepStrictEqual(
  resolveManualStoreTargets(['BEAUTY LIFE-马来']),
  [
    {
      storeName: 'BEAUTY LIFE',
      storeOptionText: 'BEAUTY LIFE-马来',
      failureCount: 1,
    },
  ],
  'Manual store target resolution should keep explicit country-qualified store options.',
);

assert.strictEqual(
  getPaginationStateFromItems({
    numericPageItems: [],
    hasEnabledNextPage: true,
  }).isLastPage,
  false,
  'Pagination with no numeric pages but an enabled next control should not be treated as last page.',
);

assert.strictEqual(
  getPaginationStateFromItems({
    numericPageItems: [],
    hasEnabledNextPage: false,
  }).isLastPage,
  true,
  'Pagination with no numeric pages and no enabled next control can be treated as a single final page.',
);

assert.strictEqual(
  getPaginationStateFromItems({
    numericPageItems: [{ pageNumber: 1, active: true }],
    hasEnabledNextPage: false,
  }).isLastPage,
  true,
  'A single visible numeric page should be treated as the final page.',
);

assert.strictEqual(
  getPaginationStateFromItems({
    numericPageItems: [{ pageNumber: 1, active: true }],
    hasEnabledNextPage: true,
  }).isLastPage,
  false,
  'A single visible numeric page with an enabled next control should not be treated as the final page.',
);

assert.strictEqual(
  getPaginationStateFromItems([{ pageNumber: 1, active: true }], true).isLastPage,
  false,
  'Positional pagination arguments with an enabled next control should not be treated as last page.',
);

assert.deepStrictEqual(
  buildLimitStoreSummary({
    results: [
      {
        storeName: 'BEAUTY LIFE',
        storeOptionText: 'BEAUTY LIFE-马来',
        skipped: true,
        reason: '安全校验失败',
      },
    ],
  }).skippedStores,
  [
    {
      storeName: 'BEAUTY LIFE',
      storeOptionText: 'BEAUTY LIFE-马来',
      reason: '安全校验失败',
    },
  ],
  'Skipped stores should preserve storeOptionText when present.',
);

assert.ok(
  cliSource.includes('runProductLimitStoreCleanup(options)'),
  'CLI should call runProductLimitStoreCleanup(options).',
);

assert.ok(
  cliSource.includes('MIAOSHOU_PROGRESS'),
  'CLI should emit machine-readable MIAOSHOU_PROGRESS updates.',
);

assert.ok(
  cliSource.includes('async function ensureLargeBrowserViewport(page)')
    && cliSource.includes('await maximizeBrowserWindow(page);')
    && cliSource.includes("Browser.setWindowBounds")
    && cliSource.includes("windowState: 'maximized'")
    && cliSource.includes('await ensureLargeBrowserViewport(page);'),
  'CLI should maximize the visible browser window before operating Miaoshou pages.',
);

for (const functionName of [
  'async function runProductLimitStoreCleanup',
  'async function scanProductLimitFailureStores',
  'async function cleanupLimitStoreProducts',
]) {
  assert.ok(
    helperSource.includes(functionName),
    `Helper should contain ${functionName}.`,
  );
}

const workflowOrder = [
  'setZeroSalesFilter',
  'clickSearchProducts',
  'setPageSize100',
  'goToLastProductPage',
  'unpublishCurrentPageProducts',
].map((functionName) => ({
  functionName,
  index: helperSource.indexOf(functionName),
}));

for (const entry of workflowOrder) {
  assert.notStrictEqual(entry.index, -1, `Helper should include ${entry.functionName}.`);
}

for (let index = 1; index < workflowOrder.length; index += 1) {
  assert.ok(
    workflowOrder[index - 1].index < workflowOrder[index].index,
    `Helper should order ${workflowOrder[index - 1].functionName} before ${workflowOrder[index].functionName}.`,
  );
}

assert.ok(
  helperSource.includes('storeOptionText'),
  'Helper should preserve exact store option text for product-management store selection.',
);

assert.ok(
  !helperSource.includes('const storeOptionText = `${normalizedStoreName}-菲律宾`;'),
  'Helper should not unconditionally force every matched store to the Philippines suffix.',
);

assert.ok(
  helperSource.includes('normalizeStoreOptionText'),
  'Helper should normalize exact store option text with a clear fallback for manual stores.',
);

assert.ok(
  helperSource.includes('verifyZeroSalesFilterInputs'),
  'Helper should confirm the visible sales filter inputs are both 0.',
);
assert.ok(
  helperSource.includes('assertZeroSalesFilterInputs')
    && helperSource.indexOf("await assertZeroSalesFilterInputs(page, '搜索前无法确认销量 0 到 0')") < helperSource.indexOf("await clickByText(page, '搜索'"),
  'Helper should re-confirm the zero-sales filter immediately before clicking search.',
);

assert.ok(
  helperSource.includes('confirmLastProductPage'),
  'Helper should confirm the product list is on the last page before unpublishing.',
);

assert.ok(
  helperSource.includes('activePageNumber') && helperSource.includes('lastPageNumber'),
  'Helper should compare active page and last page numbers.',
);

assert.ok(
  helperSource.includes('clickCurrentPageSelectAllCheckbox')
    && helperSource.includes('clickTopBulkMoreDropdown')
    && helperSource.includes('clickVisibleDropdownAction')
    && helperSource.includes('下架产品'),
  'Helper should select the current page and use the top bulk 更多 menu to click 下架产品.',
);

assert.ok(
  !helperSource.slice(
    helperSource.indexOf('async function unpublishCurrentPageProducts'),
    helperSource.indexOf('async function cleanupLimitStoreProducts'),
  ).includes('countVisibleProductRows'),
  'Helper should not require parsed product-row counts before clicking the current-page select-all checkbox.',
);

assert.ok(
  !helperSource.includes('extractTotalProductCount') && !helperSource.includes('总计'),
  'Helper should not use 总计 as the unpublishedCount source.',
);

assert.ok(
  cliSource.includes('userDataDir') && cliSource.includes('.miaoshou-browser'),
  'CLI should reuse the shared Miaoshou browser profile directory.',
);

assert.ok(
  cliSource.includes('PUPPETEER_EXECUTABLE_PATH')
    && cliSource.includes('CHROME_EXECUTABLE_PATH')
    && cliSource.includes('CHROME_PATH'),
  'CLI should use existing browser executable environment variable priority with CHROME_PATH fallback.',
);

for (const chromeArg of ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate']) {
  assert.ok(
    cliSource.includes(chromeArg),
    `CLI should launch Chrome with ${chromeArg}.`,
  );
}

for (const anchorText of ['销量', '0 到 0', '100条/页', '最后一页', '下架']) {
  assert.ok(
    helperSource.includes(anchorText),
    `Helper should include the Chinese UI anchor ${anchorText}.`,
  );
}

console.log('product management CLI checks passed');
