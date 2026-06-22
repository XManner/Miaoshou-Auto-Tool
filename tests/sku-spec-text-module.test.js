const assert = require('assert');
const fs = require('fs');
const path = require('path');
const skuSpecText = require('../lib/sku_spec_text.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof skuSpecText.sanitizeSkuSpecText,
  'function',
  'SKU spec text helpers should live in lib/sku_spec_text.js.',
);
assert.strictEqual(
  skuSpecText.sanitizeSkuSpecText(
    'Premium factory wholesale Black Waterproof Mascara Shade #01',
    20,
  ),
  'Black Mascara #01',
  'SKU spec sanitizer should keep meaningful variant tokens and drop low-value marketing words.',
);
assert.strictEqual(
  skuSpecText.sanitizeSkuSpecText(
    'Matte Red Lipstick (for export only, purchase implies acceptance)',
    40,
  ),
  'Matte Red Lipstick',
  'SKU spec sanitizer should remove policy/disclaimer bracket text.',
);
assert.strictEqual(
  skuSpecText.resolveFallbackSpecTranslation('红色'),
  'Red',
  'Known Chinese SKU values should use safe fallback translations.',
);

const translated = skuSpecText.translateSkuPropertyListWithFallbackMap([
  {
    attrName: '颜色',
    attrValueList: [
      { attrValue: '红色' },
      { attrValue: '红色' },
    ],
  },
]);
assert.deepStrictEqual(
  translated[0].attrValueList.map((item) => item.attrValue),
  ['#1 Red', '#2 Red'],
  'Duplicate translated SKU values should be disambiguated with stable indexes.',
);
assert.strictEqual(
  translated[0].attrName,
  'Color',
  'Known Chinese SKU names should use safe fallback translations.',
);

const duplicatePropertyNames = skuSpecText.translateSkuPropertyListWithFallbackMap([
  {
    attrName: '颜色',
    attrValueList: [
      { attrValue: '红色' },
      { attrValue: '蓝色' },
    ],
  },
  {
    attrName: '颜色',
    attrValueList: [
      { attrValue: '2 pieces' },
      { attrValue: '4 pieces' },
    ],
  },
]);
assert.deepStrictEqual(
  duplicatePropertyNames.map((property) => property.attrName),
  ['Color', 'Quantity'],
  'Duplicate translated SKU property names should be renamed to safe unique names.',
);

const duplicatePropertyNamesWithChineseQuantity = skuSpecText.ensureUniqueSkuPropertyNames([
  { attrName: 'Color', attrValueList: [{ attrValue: 'Red' }] },
  { attrName: 'Color', attrValueList: [{ attrValue: '2个' }, { attrValue: '4个' }] },
]);
assert.deepStrictEqual(
  duplicatePropertyNamesWithChineseQuantity.map((property) => property.attrName),
  ['Color', 'Quantity'],
  'Duplicate SKU property names with Chinese quantity values should prefer Quantity.',
);

assert.deepStrictEqual(
  skuSpecText.collectSkuTextsForTranslation([
    {
      attrName: '颜色',
      attrValueList: [
        { attrValue: '红色' },
        { attrValue: '红色' },
      ],
    },
  ]),
  ['颜色', '红色'],
  'SKU translation collection should dedupe repeated source texts.',
);
assert.deepStrictEqual(
  skuSpecText.parseSpecTranslationEntries({ map: { '颜色': 'Color' } }),
  [{ source: '颜色', target: 'Color' }],
  'Translation parser should accept map-shaped AI responses.',
);
assert.ok(
  autoSource.includes("require('./lib/sku_spec_text')"),
  'miaoshou_auto.js should import SKU spec text helpers from lib/sku_spec_text.js.',
);

console.log('sku spec text module checks passed');
