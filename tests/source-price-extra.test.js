const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../miaoshou_auto.js');

const webSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'cli_args.js'), 'utf8');
const lookupSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'source_1688_lookup.js'), 'utf8');
const obsoleteCookieEnvRead = ['process.env.ALI1688', 'COOKIE'].join('_');
const obsoleteCookieHeader = ['Cookie', ': cookie'].join('');

assert.strictEqual(
  typeof auto.applySourcePriceExtraCny,
  'function',
  'Source price extra helper should be exported for regression tests.',
);

assert.strictEqual(auto.applySourcePriceExtraCny(12.34, 1.25), 13.59);
assert.strictEqual(auto.applySourcePriceExtraCny('9.999', '0.50'), 10.5);
assert.strictEqual(auto.applySourcePriceExtraCny(12.34, 0), 12.34);
assert.strictEqual(auto.applySourcePriceExtraCny('', 2), '');

const guardedHighLookupPrice = auto.buildResolvedSourcePriceFromLookup({
  lookup: {
    matched: true,
    unitPriceCny: 20,
    freightPriceCny: 120,
  },
  source: '1688_source_url',
  itemInfo: {
    originPrice: '5.50',
    skuMap: {
      sku1: {
        originPrice: '5.50',
      },
    },
  },
});

assert.strictEqual(
  guardedHighLookupPrice.sourcePriceCny,
  5.5,
  'Resolved source prices above 100 CNY should fall back to the product current source price.',
);
assert.strictEqual(
  guardedHighLookupPrice.source,
  'fallback_current_source_price_after_high_resolved_guard',
  'High resolved source price fallback should expose a clear source reason.',
);

assert.strictEqual(
  typeof auto.cleanSkuMap,
  'function',
  'SKU cleanup helper should be exported for final source price guard regression tests.',
);

const guardedFinalSkuMap = auto.cleanSkuMap(
  {
    sku1: {
      originPrice: '7.00',
      weight: 0.06,
    },
  },
  {
    originPrice: '7.00',
    price: '7.00',
    skuPropertyList: [],
  },
  0.06,
  {
    forcedOriginPrice: 106,
    forceOriginPriceOverwrite: true,
    addWeightPadding: false,
  },
);

assert.strictEqual(
  Number(guardedFinalSkuMap.sku1.originPrice),
  7,
  'Final SKU source price above 100 CNY should fall back to the pre-edit SKU source price.',
);

const guardedFinalSkuMapAfterExtra = auto.cleanSkuMap(
  {
    sku1: {
      originPrice: '98.00',
      weight: 0.06,
    },
  },
  {
    originPrice: '98.00',
    price: '98.00',
    skuPropertyList: [],
  },
  0.06,
  {
    sourcePriceExtraCny: 10,
    addWeightPadding: false,
  },
);

assert.strictEqual(
  Number(guardedFinalSkuMapAfterExtra.sku1.originPrice),
  98,
  'Source price extra should not push final SKU source price above the 100 CNY guard.',
);

assert.ok(
  appSource.includes('v-model:value="productForm.sourcePriceExtraCny"'),
  'Run page should expose a source price extra number input.',
);
assert.ok(
  appSource.includes('sourcePriceExtraCny: Number(productForm.sourcePriceExtraCny || 0)'),
  'Run page should send the source price extra amount to /api/run.',
);
assert.ok(
  webSource.includes("'--source-price-extra'"),
  'Web server should pass the source price extra amount to miaoshou_auto.js.',
);
assert.ok(
  cliSource.includes("arg === '--source-price-extra'"),
  'CLI should accept --source-price-extra.',
);
assert.ok(
  autoSource.includes('sourcePriceExtraCny'),
  'Automation should carry sourcePriceExtraCny through the edit workflow.',
);
assert.ok(
  lookupSource.includes('headers: build1688RequestHeaders()')
    && !autoSource.includes(obsoleteCookieEnvRead)
    && !lookupSource.includes(obsoleteCookieEnvRead)
    && !autoSource.includes(obsoleteCookieHeader)
    && !lookupSource.includes(obsoleteCookieHeader),
  'Edit workflow 1688 price/weight lookup should not rely on the obsolete 1688 cookie setting.',
);

console.log('source price extra checks passed');
