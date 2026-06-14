const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../miaoshou_auto.js');

const webSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'cli_args.js'), 'utf8');

assert.strictEqual(
  typeof auto.normalizeItemRangeSelection,
  'function',
  'Item range helper should be exported for regression tests.',
);
assert.strictEqual(
  typeof auto.selectItemsByItemRange,
  'function',
  'Item range selector should be exported for regression tests.',
);
assert.strictEqual(
  typeof auto.normalizeItemSelectionMode,
  'function',
  'Item selection mode helper should be exported for regression tests.',
);
assert.strictEqual(
  typeof auto.buildDefaultEditSearchParams,
  'function',
  'Default edit search param helper should be exported for regression tests.',
);

assert.strictEqual(auto.normalizeItemSelectionMode('all'), 'all');
assert.strictEqual(auto.normalizeItemSelectionMode('range'), 'range');
assert.strictEqual(auto.normalizeItemSelectionMode('unexpected'), 'range');

assert.deepStrictEqual(
  auto.normalizeItemRangeSelection({ count: 3 }),
  { startIndex: 1, endIndex: 3, count: 3, offset: 0 },
  'Old count-only runs should still select the first N products.',
);
assert.deepStrictEqual(
  auto.normalizeItemRangeSelection({ startIndex: 5, endIndex: 10 }),
  { startIndex: 5, endIndex: 10, count: 6, offset: 4 },
  'A 5-10 range should select six products starting from the fifth product.',
);
assert.deepStrictEqual(
  auto.normalizeItemRangeSelection({ startIndex: 15, endIndex: 15 }),
  { startIndex: 15, endIndex: 15, count: 1, offset: 14 },
  'A 15-15 range should select only the fifteenth product.',
);
assert.throws(
  () => auto.normalizeItemRangeSelection({ startIndex: 10, endIndex: 5 }),
  /结束序号不能小于开始序号|end/i,
  'Invalid reversed ranges should be rejected.',
);

const items = Array.from({ length: 20 }, (_, index) => ({ detailId: String(index + 1) }));
assert.deepStrictEqual(
  auto.selectItemsByItemRange(items, { startIndex: 5, endIndex: 10 }).map((item) => item.detailId),
  ['5', '6', '7', '8', '9', '10'],
  'Selector should keep only the requested range.',
);
assert.deepStrictEqual(
  auto.selectItemsByItemRange(items, { startIndex: 15, endIndex: 15 }).map((item) => item.detailId),
  ['15'],
  'Selector should support editing one product by entering the same start and end index.',
);
assert.deepStrictEqual(
  auto.buildDefaultEditSearchParams({ itemSelectionMode: 'range', itemStartIndex: 5, itemEndIndex: 10 }),
  {
    pageNo: 0,
    pageSize: 10,
    maxPages: 1,
    detailIds: [],
    itemSelectionMode: 'range',
    itemStartIndex: 5,
    itemEndIndex: 10,
  },
  'Range mode should load enough products and then keep only the requested range.',
);
assert.deepStrictEqual(
  auto.buildDefaultEditSearchParams({ itemSelectionMode: 'all' }),
  {
    pageNo: 0,
    pageSize: 50,
    maxPages: 10,
    detailIds: [],
    itemSelectionMode: 'all',
  },
  'All mode should scan all available collect-box products up to the configured safety limit.',
);

assert.ok(
  appSource.includes('v-model:value="productForm.itemStartIndex"'),
  'Run page should expose an item range start input.',
);
assert.ok(
  appSource.includes('<a-radio-button value="range">'),
  'Run page should expose a range selection mode.',
);
assert.ok(
  appSource.includes('<a-radio-button value="all">'),
  'Run page should expose an all-products selection mode.',
);
assert.ok(
  appSource.indexOf('<a-radio-button value="range">') < appSource.indexOf('<a-radio-button value="all">'),
  'Range mode should appear before all-products mode in the product page.',
);
assert.ok(
  appSource.includes("itemSelectionMode: 'all'"),
  'All-products mode should be selected by default.',
);
assert.ok(
  appSource.includes('v-model:value="productForm.count"'),
  'Run page should expose an item count input.',
);
assert.ok(
  appSource.includes('itemSelectionMode: productForm.itemSelectionMode'),
  'Run page should send the selected item selection mode to /api/run.',
);
assert.ok(
  appSource.includes("itemStartIndex: productForm.itemSelectionMode === 'all' ? 0 : start"),
  'Run page should send the item start index to /api/run.',
);
assert.ok(
  appSource.includes("itemEndIndex: productForm.itemSelectionMode === 'all' ? 0 : start + count - 1"),
  'Run page should send the item end index to /api/run.',
);
assert.ok(
  webSource.includes("'--item-start-index'"),
  'Web server should pass the item start index to miaoshou_auto.js.',
);
assert.ok(
  webSource.includes("'--item-selection-mode'"),
  'Web server should pass the item selection mode to miaoshou_auto.js.',
);
assert.ok(
  webSource.includes("'--item-end-index'"),
  'Web server should pass the item end index to miaoshou_auto.js.',
);
assert.ok(
  cliSource.includes("arg === '--item-selection-mode'"),
  'CLI should accept --item-selection-mode.',
);
assert.ok(
  cliSource.includes("arg === '--item-start-index'"),
  'CLI should accept --item-start-index.',
);
assert.ok(
  cliSource.includes("arg === '--item-end-index'"),
  'CLI should accept --item-end-index.',
);

console.log('edit item range checks passed');
