const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../miaoshou_auto.js');
const { parseArgs } = require('../lib/cli_args.js');

const webSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'cli_args.js'), 'utf8');

assert.strictEqual(
  typeof auto.applyBuyOneTakeOneOfferToPreparedItem,
  'function',
  'Buy 1 Take 1 helper should be exported for regression tests.',
);

const singleSkuItem = {
  title: 'Soft Makeup Sponge',
  imgUrls: ['https://img.example/main.jpg'],
  skuPropertyList: [
    {
      attrId: 'color',
      attrName: 'Color',
      attrValueList: [
        {
          attrValueId: 'default',
          attrValue: 'Pink',
          imgUrl: 'https://img.example/pink.jpg',
          supplementarySkuImageUrls: ['https://img.example/pink-extra.jpg'],
        },
      ],
    },
  ],
  skuMap: {
    ';default;': {
      itemNum: 'SKU-1',
      originPrice: '8.5',
      weight: 0.12,
      stock: '66',
      shopIdToWarehouseIdAndStockMap: {
        shopA: { warehouseA: '66' },
      },
    },
  },
};

const singleSkuResult = auto.applyBuyOneTakeOneOfferToPreparedItem(singleSkuItem, {
  enabled: true,
  maxTitleLength: 180,
});
const singleSkuOfferValue = singleSkuResult.itemInfo.skuPropertyList[0].attrValueList[1];
const singleSkuOfferSku = singleSkuResult.itemInfo.skuMap[`;${singleSkuOfferValue.attrValueId};`];

assert.strictEqual(singleSkuResult.applied, true);
assert.strictEqual(singleSkuResult.itemInfo.title, 'Buy 1 Take 1 Soft Makeup Sponge');
assert.strictEqual(singleSkuOfferValue.attrValue, 'Buy 1 Take 1');
assert.strictEqual(singleSkuOfferValue.imgUrl, 'https://img.example/pink.jpg');
assert.deepStrictEqual(singleSkuOfferValue.supplementarySkuImageUrls, ['https://img.example/pink-extra.jpg']);
assert.ok(singleSkuOfferValue.attrValueId && singleSkuOfferValue.attrValueId !== 'default');
assert.strictEqual(Number(singleSkuOfferSku.originPrice), 16.15);
assert.strictEqual(Number(singleSkuOfferSku.weight), 0.24);
assert.strictEqual(singleSkuOfferSku.itemNum, 'SKU-1-B1T1');
assert.deepStrictEqual(
  singleSkuOfferSku.shopIdToWarehouseIdAndStockMap,
  { shopA: { warehouseA: '66' } },
  'Offer SKU should preserve the default SKU warehouse stock mapping.',
);

const customMarkupResult = auto.applyBuyOneTakeOneOfferToPreparedItem(singleSkuItem, {
  enabled: true,
  maxTitleLength: 180,
  priceMarkupPercent: 100,
});
const customMarkupOfferValue = customMarkupResult.itemInfo.skuPropertyList[0].attrValueList[1];
const customMarkupOfferSku = customMarkupResult.itemInfo.skuMap[`;${customMarkupOfferValue.attrValueId};`];
assert.strictEqual(
  Number(customMarkupOfferSku.originPrice),
  17,
  'Buy 1 Take 1 price should use base price plus the configured markup percent.',
);

const mainImageFallbackResult = auto.applyBuyOneTakeOneOfferToPreparedItem({
  title: 'Hair Clip',
  imgUrls: ['https://img.example/main-only.jpg'],
  skuPropertyList: [
    {
      attrName: 'Specification',
      attrValueList: [
        { attrValueId: 'default', attrValue: 'Default' },
      ],
    },
  ],
  skuMap: {
    ';default;': {
      itemNum: 'SKU-2',
      originPrice: '3',
      weight: 0.05,
    },
  },
}, {
  enabled: true,
  maxTitleLength: 180,
});

assert.strictEqual(
  mainImageFallbackResult.itemInfo.skuPropertyList[0].attrValueList[1].imgUrl,
  'https://img.example/main-only.jpg',
  'Offer spec image should use the main image when the default spec has no image.',
);

const disabledResult = auto.applyBuyOneTakeOneOfferToPreparedItem(singleSkuItem, {
  enabled: false,
  maxTitleLength: 180,
});
assert.strictEqual(disabledResult.applied, false);
assert.deepStrictEqual(disabledResult.itemInfo, singleSkuItem);

const multiSkuResult = auto.applyBuyOneTakeOneOfferToPreparedItem({
  title: 'Two Shade Lip Tint',
  imgUrls: ['https://img.example/main.jpg'],
  skuPropertyList: [
    {
      attrName: 'Color',
      attrValueList: [
        { attrValueId: 'red', attrValue: 'Red' },
        { attrValueId: 'pink', attrValue: 'Pink' },
      ],
    },
  ],
  skuMap: {
    ';red;': { originPrice: '4', weight: 0.03 },
    ';pink;': { originPrice: '4', weight: 0.03 },
  },
}, {
  enabled: true,
  maxTitleLength: 180,
});
assert.strictEqual(multiSkuResult.applied, false);
assert.strictEqual(multiSkuResult.reason, 'multiple_skus');
assert.strictEqual(Object.keys(multiSkuResult.itemInfo.skuMap).length, 2);
assert.strictEqual(multiSkuResult.itemInfo.title, 'Two Shade Lip Tint');

const alreadyPrefixed = auto.applyBuyOneTakeOneOfferToPreparedItem({
  ...singleSkuItem,
  title: 'Buy 1 Take 1 Soft Makeup Sponge',
}, {
  enabled: true,
  maxTitleLength: 180,
});
assert.strictEqual(alreadyPrefixed.itemInfo.title, 'Buy 1 Take 1 Soft Makeup Sponge');

assert.strictEqual(parseArgs(['--buy-one-take-one']).buyOneTakeOne, true);
assert.strictEqual(parseArgs(['--buy-one-take-one', 'false']).buyOneTakeOne, false);
assert.strictEqual(parseArgs([]).buyOneTakeOne, false);
assert.strictEqual(parseArgs([]).buyOneTakeOnePriceMarkupPercent, 90);
assert.strictEqual(
  parseArgs(['--buy-one-take-one-price-markup-percent', '90']).buyOneTakeOnePriceMarkupPercent,
  90,
);

assert.ok(
  appSource.includes('buyOneTakeOne: false'),
  'Product form should default Buy 1 Take 1 to off.',
);
assert.ok(
  appSource.includes('buyOneTakeOnePriceMarkupPercent: 90'),
  'Product form should default Buy 1 Take 1 markup percent to 90.',
);
assert.ok(
  appSource.includes('v-model:value="productForm.buyOneTakeOne"'),
  'Run page should expose Buy 1 Take 1 as a button-style choice.',
);
assert.ok(
  appSource.includes('v-if="productForm.buyOneTakeOne"')
    && appSource.includes('v-model:value="productForm.buyOneTakeOnePriceMarkupPercent"')
    && appSource.includes('加价比例'),
  'Run page should reveal a markup percent input only when Buy 1 Take 1 is enabled.',
);
assert.ok(
  appSource.includes('label="单 SKU 增加买一送一规格" class="form-section form-section-offer"'),
  'Buy 1 Take 1 should live in a managed form grid section instead of the one-column default.',
);
assert.ok(
  /label="单 SKU 增加买一送一规格"[\s\S]*class="medium-radio-group"[\s\S]*<a-radio-button :value="false">不添加<\/a-radio-button>[\s\S]*<a-radio-button :value="true">添加<\/a-radio-button>/.test(appSource),
  'Buy 1 Take 1 should use the same medium radio button style as the other product switches.',
);
assert.ok(
  styles.includes('.form-section-offer') && /\.form-section-offer\s*\{[\s\S]*grid-column:\s*span 6;/.test(styles),
  'Buy 1 Take 1 form section should span enough grid columns to prevent button overlap.',
);
assert.ok(
  /@media \(max-width:\s*1180px\)[\s\S]*\.form-section-offer[\s\S]*grid-column:\s*1 \/ -1;/.test(styles),
  'Buy 1 Take 1 form section should become full width on narrow screens.',
);
assert.ok(
  !appSource.includes('v-model:checked="productForm.buyOneTakeOne"'),
  'Buy 1 Take 1 should not use a checkbox UI.',
);
assert.ok(
  appSource.includes('buyOneTakeOne: Boolean(productForm.buyOneTakeOne)'),
  'Run page should send the Buy 1 Take 1 flag to /api/run.',
);
assert.ok(
  appSource.includes('buyOneTakeOnePriceMarkupPercent: Number(productForm.buyOneTakeOnePriceMarkupPercent || 90)'),
  'Run page should send the Buy 1 Take 1 markup percent to /api/run.',
);
assert.ok(
  webSource.includes('buyOneTakeOne'),
  'Web server should normalize and store the Buy 1 Take 1 flag.',
);
assert.ok(
  webSource.includes("'--buy-one-take-one'"),
  'Web server should pass the Buy 1 Take 1 flag to miaoshou_auto.js.',
);
assert.ok(
  webSource.includes('buyOneTakeOnePriceMarkupPercent')
    && webSource.includes("'--buy-one-take-one-price-markup-percent'"),
  'Web server should normalize, store, and pass the Buy 1 Take 1 markup percent.',
);
assert.ok(
  cliSource.includes("arg === '--buy-one-take-one'"),
  'CLI should accept --buy-one-take-one.',
);
assert.ok(
  cliSource.includes("arg === '--buy-one-take-one-price-markup-percent'"),
  'CLI should accept --buy-one-take-one-price-markup-percent.',
);
assert.ok(
  autoSource.includes('buyOneTakeOne'),
  'Automation should carry buyOneTakeOne through the edit workflow.',
);

console.log('buy one take one edit checks passed');
