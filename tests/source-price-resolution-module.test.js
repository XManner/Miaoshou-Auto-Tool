const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sourcePriceResolution = require('../lib/source_price_resolution.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof sourcePriceResolution.buildResolvedSourcePriceFromLookup,
  'function',
  'Resolved source price decisions should live in source_price_resolution.',
);
assert.strictEqual(
  typeof sourcePriceResolution.shouldOverwriteSuspiciousOriginPrice,
  'function',
  'Suspicious source price overwrite decisions should live in source_price_resolution.',
);
assert.strictEqual(
  typeof sourcePriceResolution.extractRepresentativeOriginPrice,
  'function',
  'Representative source price extraction should live in source_price_resolution.',
);

const highResolvedFallback = sourcePriceResolution.buildResolvedSourcePriceFromLookup({
  lookup: {
    matched: true,
    unitPriceCny: 20,
    freightPriceCny: 120,
  },
  source: '1688_source_url',
  itemInfo: {
    originPrice: '5.50',
    skuMap: {
      sku1: { originPrice: '5.50' },
    },
  },
});

assert.strictEqual(
  highResolvedFallback.sourcePriceCny,
  5.5,
  'Resolved source prices above the direct-use guard should fall back to the current product source price.',
);
assert.strictEqual(
  highResolvedFallback.source,
  'fallback_current_source_price_after_high_resolved_guard',
);

const lowLookupPadding = sourcePriceResolution.buildResolvedSourcePriceFromLookup({
  lookup: {
    matched: true,
    unitPriceCny: 2.25,
    freightPriceCny: null,
  },
  source: '1688_image',
  lowPricePaddingThresholdCny: 3,
  lowPricePaddingCny: 3,
});

assert.strictEqual(lowLookupPadding.sourcePriceCny, 5.25);
assert.strictEqual(lowLookupPadding.freightPriceCny, 3);
assert.strictEqual(lowLookupPadding.source, '1688_image_plus_low_price_padding');

assert.strictEqual(
  sourcePriceResolution.shouldOverwriteSuspiciousOriginPrice(180, 30),
  true,
  'A very high current source price should be overwritten by a sane forced price.',
);
assert.strictEqual(
  sourcePriceResolution.shouldOverwriteSuspiciousOriginPrice(80, 30),
  false,
  'A current source price below the direct-use guard should not be overwritten by suspicion logic.',
);

assert.deepStrictEqual(
  sourcePriceResolution.buildSkuOriginPriceSnapshot({
    sku1: { originPrice: '9.999' },
    sku2: { originPrice: '' },
  }),
  [
    ['sku1', 10],
    ['sku2', null],
  ],
  'SKU source price snapshots should normalize prices consistently.',
);

assert.ok(
  autoSource.includes("require('./lib/source_price_resolution')"),
  'miaoshou_auto.js should import source price decision helpers from lib/source_price_resolution.js.',
);

console.log('source price resolution module checks passed');
