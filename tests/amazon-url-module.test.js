const assert = require('assert');
const amazonUrl = require('../lib/amazon_url');

assert.strictEqual(
  amazonUrl.extractAmazonAsin('B0C123ABCD'),
  'B0C123ABCD',
  'Raw ASIN input should be accepted.',
);

assert.strictEqual(
  amazonUrl.extractAmazonAsin('https://www.amazon.com/dp/B0C123ABCD?th=1&psc=1'),
  'B0C123ABCD',
  'Amazon /dp URLs should expose the ASIN.',
);

assert.strictEqual(
  amazonUrl.extractAmazonAsin('https://www.amazon.com/gp/product/B08N5WRWNW/ref=sxin_16_pa_sp_search_thematic'),
  'B08N5WRWNW',
  'Amazon /gp/product URLs should expose the ASIN.',
);

assert.strictEqual(
  amazonUrl.extractAmazonAsin('https://www.amazon.com/exec/obidos/ASIN/059035342X'),
  '059035342X',
  'Amazon /exec/obidos/ASIN URLs should expose the ASIN.',
);

assert.strictEqual(
  amazonUrl.extractAmazonAsin('https://www.amazon.com/sspa/click?url=%2Fdp%2FB09XYZ1234%3Fpsc%3D1'),
  'B09XYZ1234',
  'Sponsored click URLs should expose the nested product ASIN.',
);

assert.strictEqual(
  amazonUrl.normalizeAmazonProductUrl('https://www.amazon.com/gp/product/B08N5WRWNW/ref=abc'),
  'https://www.amazon.com/dp/B08N5WRWNW',
  'Amazon product URLs should normalize to canonical /dp/{ASIN}.',
);

assert.strictEqual(
  amazonUrl.isLikelyAmazonProductUrl('https://www.amazon.com/dp/B08N5WRWNW'),
  true,
  'amazon.com product URLs should be recognized.',
);

assert.strictEqual(
  amazonUrl.isLikelyAmazonProductUrl('https://www.amazon.co.uk/dp/B08N5WRWNW'),
  false,
  'The first version should only accept amazon.com links.',
);

assert.deepStrictEqual(
  amazonUrl.normalizeAmazonProductInputs([
    'B08N5WRWNW',
    'https://www.amazon.com/dp/B08N5WRWNW?tag=abc',
    'https://www.amazon.com/dp/B0C123ABCD',
    'not-an-asin',
  ]),
  [
    {
      input: 'B08N5WRWNW',
      asin: 'B08N5WRWNW',
      url: 'https://www.amazon.com/dp/B08N5WRWNW',
    },
    {
      input: 'https://www.amazon.com/dp/B0C123ABCD',
      asin: 'B0C123ABCD',
      url: 'https://www.amazon.com/dp/B0C123ABCD',
    },
  ],
  'Amazon product inputs should normalize, dedupe by ASIN, and skip invalid inputs.',
);

console.log('amazon url module checks passed');
