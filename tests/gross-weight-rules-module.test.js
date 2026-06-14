const assert = require('assert');
const fs = require('fs');
const path = require('path');
const grossWeightRules = require('../lib/gross_weight_rules.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof grossWeightRules.chooseGrossWeightKg,
  'function',
  'Gross weight decision helpers should live in lib/gross_weight_rules.',
);
assert.strictEqual(grossWeightRules.clampGrossWeightKg(0.004, null), 0.01);
assert.strictEqual(grossWeightRules.normalizeWeightUnitToKg(120, 'g'), 0.12);
assert.strictEqual(grossWeightRules.isGrossWeightTooHighForDirectUse(8), true);

assert.strictEqual(
  grossWeightRules.chooseGrossWeightKg({
    currentWeightKg: 8,
    estimatedGrossWeightKg: 0.18,
    estimateSource: '1688_source_url_gross',
  }),
  0.18,
  'Very high current weights should be replaced by 1688/source estimates.',
);
assert.strictEqual(
  grossWeightRules.chooseGrossWeightKg({
    currentWeightKg: 0.1,
    estimatedGrossWeightKg: 0.105,
    estimateConfidence: 'medium',
  }),
  0.1,
  'Small vision-estimate differences should keep the current weight.',
);
assert.strictEqual(
  grossWeightRules.resolveFallbackWeight(
    {},
    {
      sku1: { weight: '' },
      sku2: { weight: 0.07 },
    },
  ),
  0.07,
  'Fallback weight should use the first valid SKU weight when item weight is missing.',
);

assert.ok(
  autoSource.includes("require('./lib/gross_weight_rules')"),
  'miaoshou_auto.js should import gross weight helpers from lib/gross_weight_rules.js.',
);

console.log('gross weight rules module checks passed');
