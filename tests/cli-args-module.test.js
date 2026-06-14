const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../lib/cli_args.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof parseArgs,
  'function',
  'CLI argument parsing should live in lib/cli_args.js.',
);

assert.strictEqual(
  parseArgs([]).command,
  'search',
  'Empty CLI args should keep the legacy search command.',
);

const quickRun = parseArgs([
  '--count', '6',
  '--publish', 'false',
  '--item-selection-mode', 'all',
  '--source-price-extra', '1.25',
  '--weight-padding-grams', '45',
]);

assert.strictEqual(quickRun.command, 'run-default');
assert.strictEqual(quickRun.count, 6);
assert.strictEqual(quickRun.publish, false);
assert.strictEqual(quickRun.itemSelectionMode, 'all');
assert.strictEqual(quickRun.sourcePriceExtraCny, 1.25);
assert.strictEqual(quickRun.skuWeightPaddingGrams, 45);

const editPublish = parseArgs([
  'edit-publish',
  '--site', 'PH',
  '--detail-ids', '1, 2,,3',
  '--shop-ids', 'shopA,shopB',
  '--target-sites', 'MY,TH',
  '--group-sites', 'PH,MY,TH',
  '--item-start-index', '3',
  '--item-end-index', '5',
]);

assert.strictEqual(editPublish.command, 'edit-publish');
assert.strictEqual(editPublish.site, 'PH');
assert.deepStrictEqual(editPublish.detailIds, ['1', '2', '3']);
assert.deepStrictEqual(editPublish.shopIds, ['shopA', 'shopB']);
assert.deepStrictEqual(editPublish.targetSites, ['MY', 'TH']);
assert.deepStrictEqual(editPublish.groupSites, ['PH', 'MY', 'TH']);
assert.strictEqual(editPublish.itemStartIndex, 3);
assert.strictEqual(editPublish.itemEndIndex, 5);

assert.throws(
  () => parseArgs(['--item-start-index', '0']),
  /开始序号必须是 1 到/,
  'CLI range indexes should reuse item range validation.',
);

assert.ok(
  autoSource.includes("require('./lib/cli_args')"),
  'miaoshou_auto.js should import parseArgs from lib/cli_args.js.',
);

console.log('cli args module checks passed');
