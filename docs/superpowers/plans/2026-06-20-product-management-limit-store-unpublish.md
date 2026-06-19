# Product Management Limit-Store Unpublish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `商品管理` module with existing product editing plus a new `商品上限店铺下架` automation that finds stores with trial-period 1000-product-list publish failures and down-shelves only zero-sales products from the last filtered page.

**Architecture:** Keep the existing Vue + Ant Design single-page workbench and Node child-process runner pattern. Add a focused product-management CLI and helper module so limit-store cleanup is separate from edit, collection, and flash-sale scripts. Integrate the new run type into existing `/api/run`, history, progress, logs, and UI panels without changing unrelated task behavior.

**Tech Stack:** Node.js CommonJS, Vue 3 global build, Ant Design Vue, `puppeteer-core`, built-in `assert` tests through `tests/run-all.js`.

---

## File Structure

- Create `lib/product_limit_store_cleanup.js`: pure helpers plus browser automation utilities for matching failure reasons, deduping stores, scanning publish records, filtering store products, and down-shelving the last zero-sales page.
- Create `miaoshou_product_management.js`: CLI entrypoint for `--task unpublish-limit-stores`; launches Chrome and delegates to the cleanup module.
- Modify `web_server.js`: add product-management run normalization, child process launcher, serialization fields, status labels, and `/api/run` support.
- Modify `public/app.js`: rename top-level `编辑商品` to `商品管理`, add inner tabs for `编辑商品` and `商品上限店铺下架`, add payload/start logic, and route product-management runs to the product page.
- Modify `public/styles.css`: add small layout styles for the product-management tabs and preview list.
- Modify `/Users/zhenggaiping/.codex/skills/miaoshou-unpublish-duplicate-color-failures/SKILL.md`: change the skill from duplicate-color cleanup to standalone product-limit cleanup.
- Modify `/Users/zhenggaiping/.codex/skills/miaoshou-unpublish-duplicate-color-failures/agents/openai.yaml`: update user-facing skill metadata.
- Create tests:
  - `tests/product-limit-store-cleanup-module.test.js`
  - `tests/product-management-cli.test.js`
  - `tests/product-management-server.test.js`
  - `tests/product-management-ui.test.js`

## Task 1: Pure Cleanup Rules

**Files:**
- Create: `tests/product-limit-store-cleanup-module.test.js`
- Create: `lib/product_limit_store_cleanup.js`

- [ ] **Step 1: Write the failing pure-helper test**

Create `tests/product-limit-store-cleanup-module.test.js`:

```js
const assert = require('assert');
const {
  PRODUCT_LIMIT_REASON_PATTERNS,
  matchesProductLimitFailureReason,
  normalizeStoreName,
  dedupeLimitStoreRecords,
  buildLimitStoreSummary,
} = require('../lib/product_limit_store_cleanup');

assert.deepStrictEqual(
  PRODUCT_LIMIT_REASON_PATTERNS,
  ['商店试用期', '最多只能使用1000个产品列表'],
  'The cleanup matcher should be anchored to the trial-period 1000-product-list failure text.',
);

assert.strictEqual(
  matchesProductLimitFailureReason('你目前处于商店试用期。根据您的试用级别，您目前最多只能使用1000个产品列表（该报错有1小时缓存时间，请到tk后台创建产品成功后，1小时后重试）'),
  true,
  'A publish failure with both required phrases should match.',
);

assert.strictEqual(
  matchesProductLimitFailureReason('发布失败：最多只能使用1000个产品列表'),
  false,
  'A failure with only the product-list phrase should not match.',
);

assert.strictEqual(
  matchesProductLimitFailureReason('你目前处于商店试用期，请稍后重试'),
  false,
  'A failure with only the trial-period phrase should not match.',
);

assert.strictEqual(
  normalizeStoreName('  X SEVEN SHOP PH-菲律宾  '),
  'X SEVEN SHOP PH',
  'Store names copied from selectors should normalize by removing the site suffix.',
);

const records = dedupeLimitStoreRecords([
  { storeName: 'X SEVEN SHOP PH', reason: '你目前处于商店试用期。根据您的试用级别，您目前最多只能使用1000个产品列表' },
  { storeName: 'X SEVEN SHOP PH-菲律宾', reason: '你目前处于商店试用期。根据您的试用级别，您目前最多只能使用1000个产品列表' },
  { storeName: 'X FIVE SHOP PH', reason: '你目前处于商店试用期。根据您的试用级别，您目前最多只能使用1000个产品列表' },
  { storeName: 'X OTHER SHOP PH', reason: '规格名称[Color]重复，请重新编辑' },
  { storeName: '', reason: '你目前处于商店试用期。根据您的试用级别，您目前最多只能使用1000个产品列表' },
]);

assert.deepStrictEqual(
  records,
  [
    { storeName: 'X SEVEN SHOP PH', failureCount: 2 },
    { storeName: 'X FIVE SHOP PH', failureCount: 1 },
  ],
  'Matched stores should be exact-name deduped and count only matching failures.',
);

assert.deepStrictEqual(
  buildLimitStoreSummary({
    scannedFailureRecords: 7,
    matchedStores: records,
    results: [
      { storeName: 'X SEVEN SHOP PH', unpublishedCount: 100 },
      { storeName: 'X FIVE SHOP PH', unpublishedCount: 0, skipped: true, reason: '没有 0 销量商品' },
    ],
  }),
  {
    mode: 'product-limit-store-unpublish',
    scannedFailureRecords: 7,
    matchedStores: [
      { storeName: 'X SEVEN SHOP PH', failureCount: 2 },
      { storeName: 'X FIVE SHOP PH', failureCount: 1 },
    ],
    matchedStoreCount: 2,
    processedStoreCount: 1,
    unpublishedCount: 100,
    skippedStores: [{ storeName: 'X FIVE SHOP PH', reason: '没有 0 销量商品' }],
    failedItems: [],
    results: [
      { storeName: 'X SEVEN SHOP PH', unpublishedCount: 100 },
      { storeName: 'X FIVE SHOP PH', unpublishedCount: 0, skipped: true, reason: '没有 0 销量商品' },
    ],
  },
  'Summary should expose counts and skipped stores for the web UI.',
);

console.log('product limit store cleanup module checks passed');
```

- [ ] **Step 2: Run the pure-helper test and verify it fails**

Run:

```bash
node tests/product-limit-store-cleanup-module.test.js
```

Expected: FAIL with `Cannot find module '../lib/product_limit_store_cleanup'`.

- [ ] **Step 3: Implement the minimal helper module**

Create `lib/product_limit_store_cleanup.js`:

```js
const PRODUCT_LIMIT_REASON_PATTERNS = ['商店试用期', '最多只能使用1000个产品列表'];

function matchesProductLimitFailureReason(reason = '') {
  const text = String(reason || '').replace(/\s+/g, '');
  return PRODUCT_LIMIT_REASON_PATTERNS.every((pattern) => text.includes(pattern));
}

function normalizeStoreName(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/-(菲律宾|马来|泰国|越南|新加坡|印尼)$/u, '')
    .trim();
}

function dedupeLimitStoreRecords(records = []) {
  const counts = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || !matchesProductLimitFailureReason(record.reason || record.failureReason)) {
      continue;
    }
    const storeName = normalizeStoreName(record.storeName || record.shopName);
    if (!storeName) {
      continue;
    }
    counts.set(storeName, (counts.get(storeName) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([storeName, failureCount]) => ({ storeName, failureCount }));
}

function buildLimitStoreSummary({
  scannedFailureRecords = 0,
  matchedStores = [],
  results = [],
  failedItems = [],
} = {}) {
  const skippedStores = results
    .filter((item) => item && item.skipped)
    .map((item) => ({
      storeName: item.storeName || '',
      reason: item.reason || '已跳过',
    }));
  const processedStoreCount = results.filter((item) => item && !item.skipped && !item.error).length;
  const unpublishedCount = results.reduce((total, item) => total + Math.max(0, Number(item && item.unpublishedCount) || 0), 0);
  return {
    mode: 'product-limit-store-unpublish',
    scannedFailureRecords: Math.max(0, Number(scannedFailureRecords) || 0),
    matchedStores: Array.isArray(matchedStores) ? matchedStores : [],
    matchedStoreCount: Array.isArray(matchedStores) ? matchedStores.length : 0,
    processedStoreCount,
    unpublishedCount,
    skippedStores,
    failedItems: Array.isArray(failedItems) ? failedItems : [],
    results: Array.isArray(results) ? results : [],
  };
}

module.exports = {
  PRODUCT_LIMIT_REASON_PATTERNS,
  matchesProductLimitFailureReason,
  normalizeStoreName,
  dedupeLimitStoreRecords,
  buildLimitStoreSummary,
};
```

- [ ] **Step 4: Run the pure-helper test and verify it passes**

Run:

```bash
node tests/product-limit-store-cleanup-module.test.js
```

Expected: PASS with `product limit store cleanup module checks passed`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add lib/product_limit_store_cleanup.js tests/product-limit-store-cleanup-module.test.js
git commit -m "feat: add product limit cleanup rules"
```

## Task 2: Product-Management CLI and Browser Flow Guardrails

**Files:**
- Create: `tests/product-management-cli.test.js`
- Modify: `lib/product_limit_store_cleanup.js`
- Create: `miaoshou_product_management.js`

- [ ] **Step 1: Write the failing CLI/source-guard test**

Create `tests/product-management-cli.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, '..', 'miaoshou_product_management.js');
const helperPath = path.join(__dirname, '..', 'lib', 'product_limit_store_cleanup.js');

assert.ok(fs.existsSync(scriptPath), 'Product management CLI should exist.');
assert.ok(fs.existsSync(helperPath), 'Product limit cleanup helper should exist.');

const script = fs.readFileSync(scriptPath, 'utf8');
const helper = fs.readFileSync(helperPath, 'utf8');

assert.ok(
  script.includes("const PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';"),
  'CLI should define the unpublish-limit-stores task.',
);
assert.ok(
  script.includes('function parseProductManagementArgs(argv = process.argv.slice(2))'),
  'CLI should expose a small parser for product-management flags.',
);
assert.ok(
  script.includes("case '--task':")
    && script.includes("case '--max-pages':")
    && script.includes("case '--dry-run':")
    && script.includes("case '--stores':"),
  'CLI parser should support task, max-pages, dry-run, and explicit stores.',
);
assert.ok(
  script.includes('runProductLimitStoreCleanup(options)'),
  'CLI should delegate the cleanup task to the helper module.',
);
assert.ok(
  script.includes('MIAOSHOU_PROGRESS'),
  'CLI should emit progress through the existing MIAOSHOU_PROGRESS channel.',
);

assert.ok(
  helper.includes('async function runProductLimitStoreCleanup')
    && helper.includes('async function scanProductLimitFailureStores')
    && helper.includes('async function cleanupLimitStoreProducts'),
  'Helper should expose the high-level scan and cleanup workflow.',
);
assert.ok(
  helper.indexOf('setZeroSalesFilter') < helper.indexOf('clickSearchProducts')
    && helper.indexOf('clickSearchProducts') < helper.indexOf('setPageSize100')
    && helper.indexOf('setPageSize100') < helper.indexOf('goToLastProductPage')
    && helper.indexOf('goToLastProductPage') < helper.indexOf('unpublishCurrentPageProducts'),
  'Browser flow must set sales 0-0, search, change page size to 100, go to last page, then down-shelve.',
);
assert.ok(
  helper.includes('销量')
    && helper.includes('0 到 0')
    && helper.includes('100条/页')
    && helper.includes('最后一页')
    && helper.includes('下架'),
  'Helper should contain the stable Chinese UI anchors for the protected workflow.',
);

console.log('product management CLI checks passed');
```

- [ ] **Step 2: Run the CLI/source-guard test and verify it fails**

Run:

```bash
node tests/product-management-cli.test.js
```

Expected: FAIL because `miaoshou_product_management.js` does not exist.

- [ ] **Step 3: Extend `lib/product_limit_store_cleanup.js` with browser workflow functions**

Append these functions before `module.exports`, then add them to `module.exports`:

```js
function emitProgress(event = {}) {
  process.stderr.write(`MIAOSHOU_PROGRESS ${JSON.stringify(event)}\n`);
}

async function waitForVisibleText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (target) => document.body && document.body.innerText.includes(target),
    { timeout },
    text,
  );
}

async function clickByText(page, text, { exact = false, timeout = 15000 } = {}) {
  await page.waitForFunction(
    ({ target, exactMatch }) => {
      const nodes = Array.from(document.querySelectorAll('button, a, span, div, li, label'));
      const match = nodes.find((node) => {
        const value = (node.innerText || node.textContent || '').trim();
        return exactMatch ? value === target : value.includes(target);
      });
      if (match) {
        match.scrollIntoView({ block: 'center', inline: 'center' });
        match.click();
        return true;
      }
      return false;
    },
    { timeout },
    { target: text, exactMatch: exact },
  );
}

async function fillFirstVisibleInputNearText(page, labelText, value) {
  await page.waitForFunction(
    ({ label, nextValue }) => {
      const all = Array.from(document.querySelectorAll('body *'));
      const labelNode = all.find((node) => (node.innerText || node.textContent || '').trim().includes(label));
      if (!labelNode) {
        return false;
      }
      const container = labelNode.closest('.ant-form-item, .ant-row, .ant-col, div') || document.body;
      const input = container.querySelector('input');
      if (!input) {
        return false;
      }
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = String(nextValue);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { timeout: 15000 },
    { label: labelText, nextValue: value },
  );
}

async function scanProductLimitFailureStores(page, { maxPages = 5 } = {}) {
  await page.goto('https://erp.91miaoshou.com/tiktok/move_collect/history?status=fail', { waitUntil: 'networkidle2' });
  await waitForVisibleText(page, '发布记录');
  await clickByText(page, '发布失败');
  const records = [];
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    emitProgress({ phase: 'scan', phaseLabel: '扫描发布失败记录', completed: pageIndex - 1, total: maxPages, totalCount: maxPages });
    await waitForVisibleText(page, '店铺名称');
    const pageRecords = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.ant-table-row, tr, [class*="table"] [class*="row"]'));
      return rows.map((row) => {
        const text = row.innerText || row.textContent || '';
        const storeMatch = text.match(/([A-Z][A-Z0-9 ]+\sPH)/);
        return {
          storeName: storeMatch ? storeMatch[1].trim() : '',
          reason: text,
        };
      }).filter((item) => item.storeName && item.reason);
    });
    records.push(...pageRecords);
    const hasNext = await page.evaluate(() => {
      const next = Array.from(document.querySelectorAll('button, li')).find((node) => /下一页/.test(node.getAttribute('aria-label') || node.innerText || ''));
      return Boolean(next && !next.disabled && !next.className.includes('disabled'));
    });
    if (!hasNext || pageIndex >= maxPages) {
      break;
    }
    await clickByText(page, '下一页');
  }
  return {
    scannedFailureRecords: records.length,
    matchedStores: dedupeLimitStoreRecords(records),
  };
}

async function selectExactStore(page, storeName) {
  await waitForVisibleText(page, '店铺产品');
  await fillFirstVisibleInputNearText(page, '店铺', storeName);
  await page.keyboard.press('Enter');
  await waitForVisibleText(page, `${storeName}-菲律宾`);
  await clickByText(page, `${storeName}-菲律宾`);
}

async function setZeroSalesFilter(page) {
  await clickByText(page, '更多筛选');
  await fillFirstVisibleInputNearText(page, '销量', 0);
  await page.keyboard.press('Tab');
  await page.keyboard.type('0');
  emitProgress({ phase: 'filter', phaseLabel: '已设置销量 0 到 0', detailName: '销量 0 到 0' });
}

async function clickSearchProducts(page) {
  await clickByText(page, '搜索');
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 }).catch(() => {});
}

async function setPageSize100(page) {
  await clickByText(page, '条/页');
  await clickByText(page, '100条/页', { exact: true });
  await waitForVisibleText(page, '100条/页');
}

async function goToLastProductPage(page) {
  await waitForVisibleText(page, '100条/页');
  await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('li, button'))
      .map((node) => ({ node, text: (node.innerText || node.textContent || '').trim() }))
      .filter((item) => /^\d+$/.test(item.text));
    const last = pages[pages.length - 1];
    if (last) {
      last.node.scrollIntoView({ block: 'center', inline: 'center' });
      last.node.click();
    }
  });
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 }).catch(() => {});
  emitProgress({ phase: 'last-page', phaseLabel: '已进入最后一页', detailName: '最后一页' });
}

async function verifySafeProductPage(page, storeName) {
  const visibleText = await page.evaluate(() => document.body ? document.body.innerText : '');
  return visibleText.includes(storeName)
    && visibleText.includes('100条/页')
    && visibleText.includes('销量')
    && !/销量\s*[1-9]/.test(visibleText);
}

async function unpublishCurrentPageProducts(page) {
  await clickByText(page, '全选');
  await clickByText(page, '下架');
  await waitForVisibleText(page, '提示');
  await waitForVisibleText(page, '成功', 60000);
  const visibleText = await page.evaluate(() => document.body ? document.body.innerText : '');
  const totalMatch = visibleText.match(/总计[:：]\s*(\d+)/);
  return totalMatch ? Number(totalMatch[1]) : 0;
}

async function cleanupLimitStoreProducts(page, storeName) {
  await page.goto('https://erp.91miaoshou.com/tiktok/item/item', { waitUntil: 'networkidle2' });
  await selectExactStore(page, storeName);
  await setZeroSalesFilter(page);
  await clickSearchProducts(page);
  await setPageSize100(page);
  await goToLastProductPage(page);
  const safe = await verifySafeProductPage(page, storeName);
  if (!safe) {
    return { storeName, unpublishedCount: 0, skipped: true, reason: '无法确认店铺、销量 0 到 0、100条/页或最后一页状态' };
  }
  const unpublishedCount = await unpublishCurrentPageProducts(page);
  return { storeName, unpublishedCount };
}

async function runProductLimitStoreCleanup({ page, maxPages = 5, dryRun = false, stores = [] } = {}) {
  if (!page) {
    throw new Error('Product management cleanup requires a Puppeteer page.');
  }
  const scan = stores.length > 0
    ? { scannedFailureRecords: stores.length, matchedStores: stores.map((storeName) => ({ storeName: normalizeStoreName(storeName), failureCount: 1 })) }
    : await scanProductLimitFailureStores(page, { maxPages });
  if (dryRun) {
    return buildLimitStoreSummary({ scannedFailureRecords: scan.scannedFailureRecords, matchedStores: scan.matchedStores, results: [] });
  }
  const results = [];
  for (const [index, store] of scan.matchedStores.entries()) {
    emitProgress({
      phase: 'cleanup',
      phaseLabel: '下架商品上限店铺',
      completed: index,
      total: scan.matchedStores.length,
      totalCount: scan.matchedStores.length,
      detailName: store.storeName,
    });
    try {
      results.push(await cleanupLimitStoreProducts(page, store.storeName));
    } catch (error) {
      results.push({ storeName: store.storeName, unpublishedCount: 0, skipped: true, reason: error.message || String(error) });
    }
  }
  emitProgress({
    phase: 'complete',
    phaseLabel: '商品上限店铺下架完成',
    completed: scan.matchedStores.length,
    total: scan.matchedStores.length,
    totalCount: scan.matchedStores.length,
    overallPercent: 100,
  });
  return buildLimitStoreSummary({
    scannedFailureRecords: scan.scannedFailureRecords,
    matchedStores: scan.matchedStores,
    results,
  });
}
```

Update the export block to include:

```js
  emitProgress,
  scanProductLimitFailureStores,
  cleanupLimitStoreProducts,
  runProductLimitStoreCleanup,
```

- [ ] **Step 4: Create the CLI entrypoint**

Create `miaoshou_product_management.js`:

```js
const puppeteer = require('puppeteer-core');
const {
  runProductLimitStoreCleanup,
} = require('./lib/product_limit_store_cleanup');

const PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';
const DEFAULT_BROWSER_WINDOW_WIDTH = 1600;
const DEFAULT_BROWSER_WINDOW_HEIGHT = 1100;

function parseProductManagementArgs(argv = process.argv.slice(2)) {
  const options = {
    task: PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES,
    maxPages: 5,
    dryRun: false,
    stores: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--task':
        options.task = argv[index + 1] || options.task;
        index += 1;
        break;
      case '--max-pages':
        options.maxPages = Math.max(1, Number.parseInt(argv[index + 1], 10) || options.maxPages);
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--stores':
        options.stores = String(argv[index + 1] || '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
        index += 1;
        break;
      default:
        break;
    }
  }
  if (options.task !== PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES) {
    throw new Error(`Unsupported product management task: ${options.task}`);
  }
  return options;
}

function chromeExecutablePath() {
  return process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: false,
    executablePath: chromeExecutablePath(),
    defaultViewport: null,
    args: [
      '--start-maximized',
      `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
    ],
  });
}

async function main() {
  const options = parseProductManagementArgs();
  process.stderr.write(`MIAOSHOU_PROGRESS ${JSON.stringify({ phase: 'prepare', phaseLabel: '准备商品管理任务', total: 0, totalCount: 0 })}\n`);
  const browser = await launchBrowser();
  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    const summary = await runProductLimitStoreCleanup({ ...options, page });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES,
  parseProductManagementArgs,
};
```

- [ ] **Step 5: Run the CLI/source-guard test and verify it passes**

Run:

```bash
node tests/product-management-cli.test.js
```

Expected: PASS with `product management CLI checks passed`.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add lib/product_limit_store_cleanup.js miaoshou_product_management.js tests/product-management-cli.test.js
git commit -m "feat: add product management cleanup CLI"
```

## Task 3: Web Server Run Integration

**Files:**
- Create: `tests/product-management-server.test.js`
- Modify: `web_server.js`

- [ ] **Step 1: Write the failing server integration test**

Create `tests/product-management-server.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  serverSource.includes("const PRODUCT_MANAGEMENT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_product_management.js');"),
  'Server should define the product-management script path.',
);
assert.ok(
  serverSource.includes("const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';"),
  'Server should define the limit-store cleanup action.',
);
assert.ok(
  serverSource.includes('function normalizeProductManagementOptions(input = {})'),
  'Server should normalize product-management run options.',
);
assert.ok(
  /productManagement:\s*Boolean\(rawTasks\.productManagement\)/.test(serverSource),
  'Run task normalization should accept tasks.productManagement.',
);
assert.ok(
  serverSource.includes('if (tasks.productManagement)') && serverSource.includes('normalizeProductManagementOptions(input)'),
  'Product-management tasks should be routed through their own normalizer.',
);
assert.ok(
  serverSource.includes('function startProductManagementRun(options)'),
  'Server should have a dedicated product-management run starter.',
);
assert.ok(
  serverSource.includes('node miaoshou_product_management.js --task unpublish-limit-stores'),
  'Server command text should describe the product-management script and action.',
);
assert.ok(
  serverSource.includes("'--max-pages'")
    && serverSource.includes("'--dry-run'")
    && serverSource.includes("'--stores'"),
  'Server should pass max-pages, dry-run, and explicit stores to the CLI.',
);
assert.ok(
  serverSource.includes("productManagement: '商品管理'"),
  'Progress phase labels should include 商品管理.',
);
assert.ok(
  serverSource.includes('productManagementAction')
    && serverSource.includes('productManagementMaxPages')
    && serverSource.includes('productManagementDryRun')
    && serverSource.includes('productManagementStores'),
  'Serialized runs should include product-management metadata.',
);
assert.ok(
  serverSource.includes('product-limit-store-unpublish')
    && serverSource.includes('unpublishedCount'),
  'Server should preserve product-management summaries.',
);

console.log('product management server checks passed');
```

- [ ] **Step 2: Run the server test and verify it fails**

Run:

```bash
node tests/product-management-server.test.js
```

Expected: FAIL because `PRODUCT_MANAGEMENT_SCRIPT_PATH` is missing.

- [ ] **Step 3: Add server constants**

In `web_server.js`, near existing script constants, add:

```js
const PRODUCT_MANAGEMENT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_product_management.js');
const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';
const MAX_PRODUCT_MANAGEMENT_SCAN_PAGES = 50;
```

- [ ] **Step 4: Extend task normalization**

In `normalizeRunOptions`, update `tasks` construction:

```js
  const tasks = {
    collect: Boolean(rawTasks.collect),
    edit: collectRequested ? Boolean(rawTasks.edit) : rawTasks.edit !== false,
    flash: Boolean(rawTasks.flash),
    productManagement: Boolean(rawTasks.productManagement),
  };
```

Replace the empty-task check:

```js
  if (!tasks.collect && !tasks.edit && !tasks.flash && !tasks.productManagement) {
    throw new Error('请至少选择一个要执行的任务。');
  }
```

Add conflict validation after collection conflict validation:

```js
  if (tasks.productManagement && (tasks.collect || tasks.edit || tasks.flash)) {
    throw new Error('商品管理下架任务需要单独执行。');
  }
```

Add routing before the edit/flash logic:

```js
  if (tasks.productManagement) {
    return {
      ...normalizeProductManagementOptions(input),
      tasks,
      account,
    };
  }
```

- [ ] **Step 5: Add product-management option normalization**

Add after `normalizeCollectOptions`:

```js
function normalizeProductManagementAction(value = PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES) {
  const normalized = String(value || PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES).trim();
  if (normalized !== PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES) {
    throw new Error('不支持的商品管理任务。');
  }
  return normalized;
}

function normalizeProductManagementOptions(input = {}) {
  const stores = normalizeIdList(input.productManagementStores || input.stores);
  const maxPages = normalizeCollectInteger(
    input.productManagementMaxPages || input.maxPages,
    5,
    1,
    MAX_PRODUCT_MANAGEMENT_SCAN_PAGES,
    '发布记录扫描页数',
  );
  return {
    productManagementAction: normalizeProductManagementAction(input.productManagementAction || input.action),
    productManagementMaxPages: maxPages,
    productManagementDryRun: normalizeCollectBoolean(input.productManagementDryRun ?? input.dryRun, false),
    productManagementStores: stores,
  };
}
```

- [ ] **Step 6: Add product-management run starter**

Add before `startRun(options)`:

```js
function startProductManagementRun(options) {
  const args = [
    PRODUCT_MANAGEMENT_SCRIPT_PATH,
    '--task',
    options.productManagementAction,
    '--max-pages',
    String(options.productManagementMaxPages),
  ];
  if (options.productManagementDryRun) {
    args.push('--dry-run');
  }
  if (options.productManagementStores && options.productManagementStores.length > 0) {
    args.push('--stores', options.productManagementStores.join(','));
  }
  const command = `node miaoshou_product_management.js --task ${options.productManagementAction} --max-pages ${options.productManagementMaxPages}${options.productManagementDryRun ? ' --dry-run' : ''}${options.productManagementStores.length ? ` --stores ${options.productManagementStores.join(',')}` : ''}`;
  const accountSummary = options.account ? { id: options.account.id, label: maskPhoneText(options.account.label) } : null;
  const run = {
    id: randomUUID(),
    command,
    stdout: '',
    stderr: '',
    logs: [],
    count: 0,
    productManagementAction: options.productManagementAction,
    productManagementMaxPages: options.productManagementMaxPages,
    productManagementDryRun: options.productManagementDryRun,
    productManagementStores: options.productManagementStores,
    tasks: options.tasks || { productManagement: true, edit: false, flash: false, collect: false },
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    error: '',
    summary: null,
    account: accountSummary,
    captcha: null,
    progress: {
      phase: 'productManagement',
      phaseLabel: '商品管理',
      completed: 0,
      total: 0,
      totalCount: 0,
      overallPercent: 0,
    },
  };
  appendLog(run, 'system', `开始执行：${command}`);
  appendLog(run, 'system', `使用账号：${accountSummary ? accountSummary.label : '当前账号'}`);
  appendLog(run, 'system', '商品上限店铺下架：扫描发布失败记录，筛选销量 0 到 0，搜索后切换 100条/页，并下架最后一页商品。');
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: {
      ...buildChildProcessEnv(options.account),
      MIAOSHOU_RUN_ID: run.id,
    },
  });
  run.child = child;
  currentRun = run;
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    run.stdout += text;
    appendLog(run, 'stdout', text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    run.stderr += text;
    processStderrChunk(run, text);
  });
  child.on('error', (error) => {
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = 'error';
    run.error = error.message || String(error);
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    appendLog(run, 'stderr', run.error);
    rememberRun(run);
  });
  child.on('close', (code, signal) => {
    if (run.stderrLineBuffer) {
      processStderrChunk(run, '\n');
    }
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    run.summary = tryParseResult(run);
    if (finalizeStoppedRun(run)) {
      return;
    }
    const resultHasErrors = summaryHasErrors(run.summary);
    run.status = code === 0 && !resultHasErrors && !signal ? 'success' : 'error';
    if (run.status === 'success') {
      updateRunProgress(run, {
        phase: 'complete',
        phaseLabel: '商品管理完成',
        completed: run.summary && Number.isFinite(Number(run.summary.processedStoreCount)) ? Number(run.summary.processedStoreCount) : 0,
        total: run.summary && Number.isFinite(Number(run.summary.matchedStoreCount)) ? Number(run.summary.matchedStoreCount) : 0,
        totalCount: run.summary && Number.isFinite(Number(run.summary.matchedStoreCount)) ? Number(run.summary.matchedStoreCount) : 0,
        overallPercent: 100,
      });
      appendLog(run, 'system', '商品上限店铺下架完成。');
    } else {
      run.error = getSummaryErrorMessage(run.summary) || extractProcessErrorMessage(run.stderr) || `退出码：${code}`;
      appendLog(run, 'stderr', `商品上限店铺下架失败：${run.error}`);
    }
    rememberRun(run);
  });
  return run;
}
```

- [ ] **Step 7: Route product-management runs**

At the top of `startRun(options)`, add:

```js
  if (options.tasks && options.tasks.productManagement) {
    return startProductManagementRun(options);
  }
```

- [ ] **Step 8: Serialize and remember product-management metadata**

In `serializeRun(run)`, add:

```js
    productManagementAction: run.productManagementAction || '',
    productManagementMaxPages: run.productManagementMaxPages || 0,
    productManagementDryRun: Boolean(run.productManagementDryRun),
    productManagementStores: run.productManagementStores || [],
```

In `rememberRun(run)`, add the same fields to the history item.

- [ ] **Step 9: Extend progress labels and summary error handling**

In the phase-label map used by `formatRunStatusLog`, add:

```js
    productManagement: '商品管理',
```

In `summaryHasErrors(summary)`, before the generic error count check, add:

```js
  if (summary && summary.mode === 'product-limit-store-unpublish') {
    return Number(summary.failedItems && summary.failedItems.length) > 0;
  }
```

In `getSummaryErrorMessage(summary)`, add:

```js
  if (summary && summary.mode === 'product-limit-store-unpublish' && summary.failedItems && summary.failedItems.length > 0) {
    return `商品管理失败 ${summary.failedItems.length} 项`;
  }
```

- [ ] **Step 10: Run the server test and verify it passes**

Run:

```bash
node tests/product-management-server.test.js
```

Expected: PASS with `product management server checks passed`.

- [ ] **Step 11: Commit Task 3**

Run:

```bash
git add web_server.js tests/product-management-server.test.js
git commit -m "feat: route product management runs"
```

## Task 4: Frontend Product Management Module

**Files:**
- Create: `tests/product-management-ui.test.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Write the failing UI guard test**

Create `tests/product-management-ui.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("products: '商品管理'"),
  'The products page title should become 商品管理.',
);
assert.ok(
  appSource.includes('<a-menu-item key="products">商品管理</a-menu-item>')
    && !appSource.includes('<a-menu-item key="products">编辑商品</a-menu-item>'),
  'Top navigation should show 商品管理 instead of 编辑商品.',
);
assert.ok(
  appSource.includes("const productManagementActiveTab = ref('edit')")
    && appSource.includes("const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores'"),
  'Product page should have inner product-management tabs and cleanup action constant.',
);
assert.ok(
  appSource.includes('<a-tabs v-model:active-key="productManagementActiveTab" class="product-management-tabs">')
    && appSource.includes('<a-tab-pane key="edit" tab="编辑商品">')
    && appSource.includes('<a-tab-pane key="limitStores" tab="商品上限店铺下架">'),
  'Product management page should contain 编辑商品 and 商品上限店铺下架 tabs.',
);
assert.ok(
  appSource.includes('productLimitForm')
    && appSource.includes('productLimitTaskSummary')
    && appSource.includes('productLimitPreviewStores')
    && appSource.includes('startProductLimitCleanupRun')
    && appSource.includes('tasks: { productManagement: true, edit: false, flash: false, collect: false }'),
  'UI should provide state, summary, preview, starter, and payload for the limit-store cleanup.',
);
assert.ok(
  appSource.includes('商店试用期')
    && appSource.includes('最多只能使用1000个产品列表')
    && appSource.includes('销量 0 到 0')
    && appSource.includes('100条/页')
    && appSource.includes('最后一页'),
  'UI copy should explain the exact destructive scope.',
);
assert.ok(
  appSource.includes('run.tasks && run.tasks.productManagement'),
  'Run page matching should route product-management runs to 商品管理.',
);
assert.ok(
  styles.includes('.product-management-tabs')
    && styles.includes('.limit-store-panel')
    && styles.includes('.limit-safety-list'),
  'Styles should support the new product-management tab layout.',
);

console.log('product management UI checks passed');
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
node tests/product-management-ui.test.js
```

Expected: FAIL because the top navigation still says `编辑商品`.

- [ ] **Step 3: Add product-management state and routing helpers**

In `public/app.js`, add after `PAGE_TITLES` existing `products` value:

```js
    products: '商品管理',
```

Add near constants:

```js
  const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';
```

Add helper:

```js
  function runHasProductManagementTask(run) {
    return Boolean(run && run.tasks && run.tasks.productManagement);
  }
```

Update `runMatchesPage(run, page)` to compute:

```js
    const hasProductManagement = runHasProductManagementTask(run);
```

and update products branch:

```js
    if (page === 'products') {
      return hasProductManagement || (hasEdit && !hasCollect && (!hasFlash || !flashPhaseOrResult));
    }
```

Update `historyPageForRun(run)` before flash/edit fallback:

```js
    if (runHasProductManagementTask(run)) {
      return 'products';
    }
```

Update `buildTaskText(run)` before edit task logic:

```js
    if (tasks.productManagement) {
      const summary = run.summary || {};
      if (summary.mode === 'product-limit-store-unpublish') {
        return `商品上限店铺下架（命中 ${summary.matchedStoreCount || 0} 个店铺，下架 ${summary.unpublishedCount || 0} 个商品）`;
      }
      return '商品上限店铺下架';
    }
```

- [ ] **Step 4: Add form state and payload**

Inside `setup()`, after `productForm`, add:

```js
      const productManagementActiveTab = ref('edit');
      const productLimitForm = reactive({
        maxPages: 5,
        dryRun: false,
        stores: '',
      });
```

Add computed summary after `productTaskSummary`:

```js
      const productLimitStoreList = computed(() => String(productLimitForm.stores || '')
        .split(/[\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean));

      const productLimitTaskSummary = computed(() => {
        const account = selectedAccountText.value;
        const explicitStores = productLimitStoreList.value.length;
        const sourceText = explicitStores > 0
          ? `手动指定 ${explicitStores} 个店铺`
          : `扫描发布失败记录前 ${Math.max(1, Number(productLimitForm.maxPages || 1))} 页`;
        return `使用 ${account}，${sourceText}，仅处理商店试用期 1000 产品列表上限店铺；店铺产品筛选销量 0 到 0，搜索后切换 100条/页，并下架最后一页商品。`;
      });

      const productLimitPreviewStores = computed(() => {
        const summary = runSummary.value || {};
        return summary.mode === 'product-limit-store-unpublish' && Array.isArray(summary.matchedStores)
          ? summary.matchedStores
          : [];
      });
```

Add payload function near `productPayload()`:

```js
      function productLimitPayload() {
        return {
          tasks: {
            collect: false,
            edit: false,
            flash: false,
            productManagement: true,
          },
          productManagementAction: PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES,
          productManagementMaxPages: Math.max(1, Number(productLimitForm.maxPages || 1)),
          productManagementDryRun: Boolean(productLimitForm.dryRun),
          productManagementStores: productLimitStoreList.value,
        };
      }
```

Add starter after `startProductRun()`:

```js
      async function startProductLimitCleanupRun() {
        try {
          const payload = productLimitPayload();
          const confirmed = await confirmTaskStart({
            title: productLimitForm.dryRun ? '确认扫描商品上限店铺' : '确认下架商品上限店铺',
            summary: productLimitTaskSummary.value,
            details: [
              '失败原因必须同时包含“商店试用期”和“最多只能使用1000个产品列表”。',
              '店铺产品必须先设置销量 0 到 0 并点击搜索。',
              '搜索结果加载后才切换 100条/页，只下架最后一页商品。',
            ],
          });
          if (!confirmed) {
            return;
          }
          loading.value = true;
          await requestJson('/api/run', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refreshStatus();
          showSuccess(productLimitForm.dryRun ? '扫描任务已开始。' : '商品上限店铺下架任务已开始。');
        } catch (error) {
          showError(error);
        } finally {
          loading.value = false;
        }
      }
```

Return from `setup()`:

```js
        productManagementActiveTab,
        productLimitForm,
        productLimitTaskSummary,
        productLimitStoreList,
        startProductLimitCleanupRun,
```

- [ ] **Step 5: Update nav and product template**

Change top menu item:

```html
<a-menu-item key="products">商品管理</a-menu-item>
```

Wrap the existing product edit card content in tabs. Replace:

```html
<a-card v-if="currentPage === 'products'" title="编辑商品" class="soft-card task-card product-panel">
```

with:

```html
<a-card v-if="currentPage === 'products'" title="商品管理" class="soft-card task-card product-panel">
  <a-tabs v-model:active-key="productManagementActiveTab" class="product-management-tabs">
    <a-tab-pane key="edit" tab="编辑商品">
```

Close the edit tab immediately before the existing product card closing `</a-card>` and add:

```html
    </a-tab-pane>
    <a-tab-pane key="limitStores" tab="商品上限店铺下架">
      <section class="limit-store-panel">
        <a-alert
          type="warning"
          show-icon
          message="只下架商品上限店铺的零销量商品"
          description="系统会匹配发布失败原因中的“商店试用期”和“最多只能使用1000个产品列表”，进入店铺产品后先筛选销量 0 到 0 并搜索，再切换 100条/页，只下架最后一页商品。"
        />
        <a-form layout="vertical" class="task-form">
          <a-row :gutter="16">
            <a-col :xs="24" :md="8">
              <a-form-item label="发布记录扫描页数">
                <a-input-number v-model:value="productLimitForm.maxPages" :min="1" :max="50" size="middle" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :md="8">
              <a-form-item label="运行方式">
                <a-switch v-model:checked="productLimitForm.dryRun" checked-children="只扫描" un-checked-children="扫描并下架" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="指定店铺（可选）" extra="每行一个店铺；留空时从发布失败记录自动识别。">
            <a-textarea v-model:value="productLimitForm.stores" :rows="4" placeholder="X SEVEN SHOP PH" />
          </a-form-item>
        </a-form>
        <div class="limit-safety-list">
          <a-tag color="red">匹配发布失败</a-tag>
          <a-tag color="orange">销量 0 到 0</a-tag>
          <a-tag color="blue">搜索后 100条/页</a-tag>
          <a-tag color="purple">最后一页</a-tag>
          <a-tag color="green">执行下架</a-tag>
        </div>
        <div class="task-preview">
          <p>{{ productLimitTaskSummary }}</p>
        </div>
        <a-list
          v-if="productLimitPreviewStores.length"
          class="limit-store-preview-list"
          size="small"
          :data-source="productLimitPreviewStores"
          bordered
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta :title="item.storeName" :description="'命中失败记录 ' + item.failureCount + ' 条'" />
            </a-list-item>
          </template>
        </a-list>
        <a-button type="primary" size="large" :loading="loading" :disabled="isRunning" @click="startProductLimitCleanupRun">
          {{ productLimitForm.dryRun ? '扫描上限店铺' : '开始下架' }}
        </a-button>
      </section>
    </a-tab-pane>
  </a-tabs>
```

- [ ] **Step 6: Adjust hero buttons**

In the page hero actions, change the product start button condition so the old `开始商品任务` only shows on the edit tab:

```html
<a-button
  v-if="currentPage === 'products' && productManagementActiveTab === 'edit'"
  type="primary"
  size="large"
  :loading="loading"
  :disabled="isRunning"
  @click="startProductRun"
>开始商品任务</a-button>
```

Add a second hero button for limit-store tab:

```html
<a-button
  v-if="currentPage === 'products' && productManagementActiveTab === 'limitStores'"
  type="primary"
  size="large"
  :loading="loading"
  :disabled="isRunning"
  @click="startProductLimitCleanupRun"
>{{ productLimitForm.dryRun ? '扫描上限店铺' : '开始下架' }}</a-button>
```

Leave the queue button visible only on the edit tab:

```html
v-if="currentPage === 'products' && productManagementActiveTab === 'edit'"
```

- [ ] **Step 7: Add CSS**

Append to `public/styles.css`:

```css
.product-management-tabs {
  width: 100%;
}

.product-management-tabs .ant-tabs-nav {
  margin-bottom: 18px;
}

.limit-store-panel {
  display: grid;
  gap: 18px;
}

.limit-safety-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.limit-store-preview-list {
  background: var(--app-card);
  border-radius: 8px;
}
```

- [ ] **Step 8: Run the UI test and verify it passes**

Run:

```bash
node tests/product-management-ui.test.js
```

Expected: PASS with `product management UI checks passed`.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add public/app.js public/styles.css tests/product-management-ui.test.js
git commit -m "feat: add product management UI"
```

## Task 5: Skill Update

**Files:**
- Modify: `/Users/zhenggaiping/.codex/skills/miaoshou-unpublish-duplicate-color-failures/SKILL.md`
- Modify: `/Users/zhenggaiping/.codex/skills/miaoshou-unpublish-duplicate-color-failures/agents/openai.yaml`

- [ ] **Step 1: Replace `SKILL.md` content**

Use `apply_patch` to replace the skill body with:

```md
---
name: miaoshou-unpublish-duplicate-color-failures
description: Use when operating Miaoshou Auto Tool 商品管理 for product-limit cleanup: identifying publish failures caused by 商店试用期 and 最多只能使用1000个产品列表, then safely down-shelving zero-sales products from affected TikTok stores.
---

# Miaoshou Product Limit Store Cleanup

## Overview

Use `商品管理 > 商品上限店铺下架` to clean stores that cannot publish because the trial-period product list limit is full. This workflow is a standalone product-management operation, not a duplicate-Color failure fix.

## Matching Rule

Only treat a publish failure as a product-limit store when the failure reason contains both:

- `商店试用期`
- `最多只能使用1000个产品列表`

Deduplicate matching `店铺名称` values before processing.

## Cleanup Workflow

1. Open the local workbench and go to `商品管理 > 商品上限店铺下架`.
2. Scan Miaoshou ERP `发布记录 > 发布失败` or run with explicit store names when recovering a known store.
3. Review matched stores before destructive cleanup.
4. For each store, open Miaoshou ERP `店铺产品`.
5. Select the exact store in the `店铺` selector.
6. Open `更多筛选`.
7. Set `销量` minimum to `0` and maximum to `0`.
8. Click `搜索`.
9. After the filtered result list loads, change page size to `100条/页`.
10. Navigate to the last page.
11. Select all products on that last page.
12. Execute `下架` and wait for the result dialog.

## Safety Rules

- Never down-shelve products unless the visible list is filtered to the exact store and `销量 0 到 0`.
- The `搜索` step must happen before changing to `100条/页`.
- Only down-shelve the last page of the filtered zero-sales list, because those are the earliest listed products in this workflow.
- Skip the store if the exact store, zero-sales filter, `100条/页`, or last-page state cannot be confirmed.
- Do not use `删除` or `删除选中`.
- Redact account identifiers and never record passwords or OTPs.

## UI Anchors

| Area | Stable labels |
| --- | --- |
| Local workbench | `商品管理`, `商品上限店铺下架`, `扫描上限店铺`, `开始下架` |
| Publish records | `发布记录`, `发布失败`, `商店试用期`, `最多只能使用1000个产品列表`, `店铺名称` |
| Store products | `店铺产品`, `店铺`, `更多筛选`, `销量`, `搜索`, `100条/页` |
| Take-down | `全选`, `下架`, `提示`, `总计`, `成功`, `失败` |
```

- [ ] **Step 2: Update `agents/openai.yaml`**

Replace with:

```yaml
interface:
  display_name: "Miaoshou Limit Store Cleanup"
  short_description: "Down-shelve zero-sales items for limited stores"
  default_prompt: "Use $miaoshou-unpublish-duplicate-color-failures to run the Miaoshou 商品上限店铺下架 workflow."
```

- [ ] **Step 3: Validate the skill**

Run:

```bash
/Users/zhenggaiping/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 /Users/zhenggaiping/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/zhenggaiping/.codex/skills/miaoshou-unpublish-duplicate-color-failures
```

Expected: PASS with `Skill is valid!`.

- [ ] **Step 4: Scan for obsolete wording**

Run:

```bash
rg -n '规格名称|Color|duplicate|Duplicate Color|库存' /Users/zhenggaiping/.codex/skills/miaoshou-unpublish-duplicate-color-failures
```

Expected: no matches.

## Task 6: Full Verification

**Files:**
- Verify all touched project files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node tests/product-limit-store-cleanup-module.test.js
node tests/product-management-cli.test.js
node tests/product-management-server.test.js
node tests/product-management-ui.test.js
```

Expected: all four commands exit 0 and print their `... checks passed` messages.

- [ ] **Step 2: Run syntax check**

Run:

```bash
npm run check
```

Expected: exit 0. It should check `miaoshou_auto.js`, `miaoshou_flash_sale.js`, `miaoshou_1688_collect.js`, and `web_server.js`.

If `npm run check` does not include `miaoshou_product_management.js`, update `package.json`:

```json
"check": "node --check miaoshou_auto.js && node --check miaoshou_flash_sale.js && node --check miaoshou_1688_collect.js && node --check miaoshou_product_management.js && node --check web_server.js"
```

Then rerun:

```bash
npm run check
```

Expected: exit 0.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: exit 0 with `All N test files passed via run-all.js.`

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff -- public/app.js public/styles.css web_server.js miaoshou_product_management.js lib/product_limit_store_cleanup.js tests/product-limit-store-cleanup-module.test.js tests/product-management-cli.test.js tests/product-management-server.test.js tests/product-management-ui.test.js package.json
```

Expected: diff only includes the planned product-management cleanup changes.

- [ ] **Step 5: Commit final implementation**

Run:

```bash
git add public/app.js public/styles.css web_server.js miaoshou_product_management.js lib/product_limit_store_cleanup.js tests/product-limit-store-cleanup-module.test.js tests/product-management-cli.test.js tests/product-management-server.test.js tests/product-management-ui.test.js package.json
git commit -m "feat: add product management limit-store cleanup"
```

Do not stage unrelated dirty files already present in the workspace.
