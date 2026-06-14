const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sourcePriceWeight = require('../lib/source_price_weight.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof sourcePriceWeight.extractFirstValidPriceFromText,
  'function',
  'Source price extraction should live in the source_price_weight module.',
);
assert.strictEqual(
  typeof sourcePriceWeight.extractFreightPriceFromText,
  'function',
  'Source freight extraction should live in the source_price_weight module.',
);
assert.strictEqual(
  typeof sourcePriceWeight.resolveGrossWeightFromText,
  'function',
  'Source weight extraction should live in the source_price_weight module.',
);

assert.strictEqual(
  sourcePriceWeight.extractFirstValidPriceFromText('起批2件 运费 ¥3.80 价格 ¥8.33'),
  8.33,
  'Price extraction should ignore freight amounts before the product price.',
);
assert.strictEqual(
  sourcePriceWeight.extractFreightPriceFromText('起批2件 运费 ¥3.80 价格 ¥8.33'),
  3.8,
  'Freight extraction should keep explicit 运费 amounts.',
);

const packagingAndNetContentHtml = [
  '商品属性',
  '净含量',
  '50g (g/ml)',
  '商品资质证书',
  '包装信息',
  '商品件重尺',
  '重量(g)',
  '120',
].join('\n');
const packagingResult = sourcePriceWeight.resolveGrossWeightFromText(packagingAndNetContentHtml, {
  packageSource: 'test_package_weight',
  grossSource: 'test_gross',
  netSource: 'test_net',
});

assert.ok(packagingResult, 'Packaging source HTML should resolve a weight.');
assert.strictEqual(packagingResult.weightKg, 0.12);
assert.strictEqual(packagingResult.source, 'test_package_weight');

assert.strictEqual(sourcePriceWeight.applySourcePriceExtraCny(12.34, 1.25), 13.59);
assert.strictEqual(sourcePriceWeight.addSkuWeightPaddingKg(0.1, null, 30), 0.13);

assert.ok(
  autoSource.includes("require('./lib/source_price_weight')"),
  'miaoshou_auto.js should import source price and weight helpers from lib/source_price_weight.js.',
);

console.log('source price weight module checks passed');
