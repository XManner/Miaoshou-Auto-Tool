const assert = require('assert');
const auto = require('../miaoshou_auto.js');

assert.strictEqual(
  typeof auto.resolveGrossWeightFromText,
  'function',
  'Source weight resolver should be exported for regression tests.',
);

const packagingAndNetContentHtml = [
  '商品属性',
  '净含量',
  '50g (g/ml)',
  '产品规格',
  '韩纪视黄醇抚纹抗皱精华霜50g/瓶',
  '商品资质证书',
  '包装信息',
  '商品件重尺',
  '重量(g)',
  '120',
].join('\n');

const packagingResult = auto.resolveGrossWeightFromText(packagingAndNetContentHtml, {
  packageSource: 'test_package_weight',
  grossSource: 'test_gross',
  netSource: 'test_net',
});

assert.ok(packagingResult, 'Should resolve a weight from source HTML.');
assert.strictEqual(
  packagingResult.weightKg,
  0.12,
  'Packaging 信息里的重量(g) should take priority over 净含量.',
);
assert.strictEqual(
  packagingResult.source,
  'test_package_weight',
  'Packaging weight should be marked as the source.',
);

const netContentOnlyHtml = [
  '商品属性',
  '净含量',
  '50g (g/ml)',
  '产品规格',
  '韩纪视黄醇抚纹抗皱精华霜50g/瓶',
].join('\n');

const netResult = auto.resolveGrossWeightFromText(netContentOnlyHtml, {
  packageSource: 'test_package_weight',
  grossSource: 'test_gross',
  netSource: 'test_net',
});

assert.ok(netResult, 'Should fall back to net content when no packaging weight exists.');
assert.strictEqual(
  netResult.weightKg,
  0.05,
  '净含量 should be used as the base weight when packaging weight is missing.',
);
assert.strictEqual(
  netResult.source,
  'test_net',
  'Net content should be marked as the fallback source.',
);

console.log('source weight priority checks passed');
