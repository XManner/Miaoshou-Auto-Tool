const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../miaoshou_auto.js');

const webSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'cli_args.js'), 'utf8');

assert.strictEqual(
  typeof auto.addSkuWeightPaddingKg,
  'function',
  'Weight padding helper should be exported for regression tests.',
);

assert.strictEqual(auto.addSkuWeightPaddingKg(0.1, null, 30), 0.13);
assert.strictEqual(auto.addSkuWeightPaddingKg(0.1, null, 0), 0.1);
assert.strictEqual(auto.addSkuWeightPaddingKg(0.1, null, 125), 0.225);

assert.ok(
  appSource.includes('v-model:value="productForm.weightPaddingGrams"'),
  'Run page should expose a weight padding number input.',
);
assert.ok(
  appSource.includes('weightPaddingGrams: 30'),
  'Weight padding input should default to 30g unless the environment overrides it.',
);
assert.ok(
  appSource.includes('weightPaddingGrams: Number(productForm.weightPaddingGrams || 0)'),
  'Run page should send the custom weight padding to /api/run.',
);
assert.ok(
  webSource.includes("'--weight-padding-grams'"),
  'Web server should pass the custom weight padding to miaoshou_auto.js.',
);
assert.ok(
  cliSource.includes("arg === '--weight-padding-grams'"),
  'CLI should accept --weight-padding-grams.',
);
assert.ok(
  autoSource.includes('skuWeightPaddingGrams'),
  'Automation should carry skuWeightPaddingGrams through the edit workflow.',
);

console.log('weight padding input checks passed');
