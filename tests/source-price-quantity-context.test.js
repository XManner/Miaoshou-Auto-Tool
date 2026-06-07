const assert = require('assert');
const auto = require('../miaoshou_auto.js');

assert.strictEqual(
  typeof auto.extractFirstValidPriceFromText,
  'function',
  'Price extraction helper should be exported for regression tests.',
);

const quantityContextHtml = [
  '{"price":"2000"}',
  '2000件以内 承诺48小时发货',
  '¥8.33',
  '运费 ¥3.8起',
].join(' ');

assert.strictEqual(
  auto.extractFirstValidPriceFromText(quantityContextHtml),
  8.33,
  'Quantity text such as 2000件以内 must not be treated as a product unit price.',
);

assert.strictEqual(
  auto.extractFreightPriceFromText(quantityContextHtml),
  3.8,
  'Freight extraction should still read the explicit 运费 price.',
);

const moqFreightTemplateHtml = [
  '运费模板 起批量2，承诺48小时发货',
  '现货价格 ¥8.33',
].join(' ');

assert.strictEqual(
  auto.extractFirstValidPriceFromText(moqFreightTemplateHtml),
  8.33,
  'MOQ quantity near 运费模板 must not replace the visible unit price.',
);

assert.strictEqual(
  auto.extractFreightPriceFromText(moqFreightTemplateHtml),
  null,
  'MOQ quantity near 运费模板 must not be treated as freight and added to source price.',
);

const freightBeforePriceHtml = [
  '起批2件',
  '运费 ¥3.80',
  '价格 ¥8.33',
].join(' ');

assert.strictEqual(
  auto.extractFirstValidPriceFromText(freightBeforePriceHtml),
  8.33,
  'Currency amounts labelled as freight must not be used as the product unit price.',
);

assert.strictEqual(
  auto.extractFreightPriceFromText(freightBeforePriceHtml),
  3.8,
  'Explicit freight price should still be extracted when it is separate from MOQ text.',
);

const freightOnlyBeforePriceHtml = [
  '运费 ¥3.80',
  '价格 ¥8.33',
].join(' ');

assert.strictEqual(
  auto.extractFirstValidPriceFromText(freightOnlyBeforePriceHtml),
  8.33,
  'Freight currency amount must not be selected as the product unit price even without MOQ text.',
);

assert.strictEqual(
  auto.extractFreightPriceFromText(freightOnlyBeforePriceHtml),
  3.8,
  'Freight extraction should still keep the explicit freight amount.',
);

const reviewCountBeforePriceHtml = [
  '{"price":"50"}',
  '50+人好评',
  '100+人已加购',
  '承诺48小时发货',
  '¥2.80',
  '运费 ¥2.8起',
].join(' ');

assert.strictEqual(
  auto.extractFirstValidPriceFromText(reviewCountBeforePriceHtml),
  2.8,
  'Review and cart-count text such as 50+人好评 must not be treated as a product unit price.',
);

assert.strictEqual(
  auto.extractFreightPriceFromText(reviewCountBeforePriceHtml),
  2.8,
  'Freight extraction should still read the explicit freight price near review counts.',
);

console.log('source price quantity context checks passed');
