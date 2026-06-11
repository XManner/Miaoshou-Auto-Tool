const assert = require('assert');
const fs = require('fs');
const path = require('path');
const itemSelection = require('../lib/item_selection.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof itemSelection.normalizeItemSelectionMode,
  'function',
  'Item selection helpers should live in lib/item_selection.',
);
assert.strictEqual(itemSelection.normalizeItemSelectionMode('all'), 'all');
assert.strictEqual(itemSelection.normalizeItemSelectionMode('oops'), 'range');
assert.strictEqual(itemSelection.hasItemRangeSelection({ itemStartIndex: 2 }), true);
assert.strictEqual(itemSelection.hasItemRangeSelection({}), false);

assert.deepStrictEqual(
  itemSelection.normalizeItemRangeSelection({ startIndex: 3, endIndex: 5 }),
  { startIndex: 3, endIndex: 5, count: 3, offset: 2 },
);
assert.deepStrictEqual(
  itemSelection.selectItemsByItemRange(
    Array.from({ length: 6 }, (_, index) => ({ detailId: String(index + 1) })),
    { startIndex: 2, endIndex: 4 },
  ).map((item) => item.detailId),
  ['2', '3', '4'],
);
assert.deepStrictEqual(
  itemSelection.buildDefaultEditSearchParams({ itemSelectionMode: 'all' }),
  {
    pageNo: 0,
    pageSize: 50,
    maxPages: 10,
    detailIds: [],
    itemSelectionMode: 'all',
  },
);

assert.ok(
  autoSource.includes("require('./lib/item_selection')"),
  'miaoshou_auto.js should import item selection helpers from lib/item_selection.js.',
);

console.log('item selection module checks passed');
