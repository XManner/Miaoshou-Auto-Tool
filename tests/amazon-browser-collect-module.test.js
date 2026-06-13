const assert = require('assert');
const amazonCollect = require('../lib/amazon_browser_collect');

const searchUrl = amazonCollect.buildAmazonSearchUrl('wireless charger stand');
assert.strictEqual(
  searchUrl,
  'https://www.amazon.com/s?k=wireless+charger+stand',
  'Amazon keyword search URLs should target amazon.com.',
);

assert.strictEqual(amazonCollect.parseAmazonPrice('$1,234.50'), 1234.5);
assert.strictEqual(amazonCollect.parseAmazonPrice('$19'), 19);
assert.strictEqual(amazonCollect.parseAmazonPrice(''), null);

assert.strictEqual(amazonCollect.parseAmazonRating('4.6 out of 5 stars'), 4.6);
assert.strictEqual(amazonCollect.parseAmazonRating('Rated 3.9 stars'), 3.9);
assert.strictEqual(amazonCollect.parseAmazonRating('No rating'), null);

assert.strictEqual(amazonCollect.parseAmazonReviewCount('1,234 ratings'), 1234);
assert.strictEqual(amazonCollect.parseAmazonReviewCount('87'), 87);
assert.strictEqual(amazonCollect.parseAmazonReviewCount(''), null);

assert.deepStrictEqual(
  amazonCollect.parseAmazonWeight('Item Weight 10 ounces'),
  { weightGrams: 283.5, weightText: '283.5g' },
  'Amazon item weights in ounces should convert to grams.',
);
assert.deepStrictEqual(
  amazonCollect.parseAmazonWeight('Package Weight 1.2 pounds'),
  { weightGrams: 544.3, weightText: '544.3g' },
  'Amazon package weights in pounds should convert to grams.',
);
assert.deepStrictEqual(
  amazonCollect.parseAmazonWeight('Product Dimensions 5 x 2 x 1 inches'),
  { weightGrams: null, weightText: '' },
  'Amazon dimensions without a weight should not be treated as product weight.',
);

const normalized = amazonCollect.normalizeAmazonCandidateRecords([
  {
    asin: 'B0C123ABCD',
    title: 'Wireless Charger Stand for Desk',
    url: '/dp/B0C123ABCD/ref=sxin',
    priceText: '$19.99',
    ratingText: '4.6 out of 5 stars',
    reviewText: '1,234 ratings',
    imageUrl: 'https://m.media-amazon.com/images/I/example.jpg',
  },
  {
    asin: 'B0SPONSORED',
    title: 'Sponsored Charger',
    url: 'https://www.amazon.com/dp/B0SPONSORED',
    sponsored: true,
  },
  {
    asin: '',
    title: 'Missing ASIN',
    url: 'https://www.amazon.com/not-a-product',
  },
], { keyword: 'charger' });

assert.deepStrictEqual(
  normalized,
  [
    {
      source: 'amazon',
      marketplace: 'US',
      asin: 'B0C123ABCD',
      url: 'https://www.amazon.com/dp/B0C123ABCD',
      title: 'Wireless Charger Stand for Desk',
      priceUsd: 19.99,
      rating: 4.6,
      reviewCount: 1234,
      imageUrl: 'https://m.media-amazon.com/images/I/example.jpg',
      keyword: 'charger',
      reason: 'Amazon search candidate',
    },
  ],
  'Amazon raw records should normalize to collectable organic candidates.',
);

const detailMerged = amazonCollect.normalizeAmazonDetailRecord({
  title: 'CeraVe Moisturizing Cream, 19 Ounce',
  priceText: '$17.06',
  detailText: 'Item Weight 1.39 pounds Product Dimensions 3.6 x 3.6 x 8 inches',
}, {
  asin: 'B00TTD9BRC',
  title: 'B00TTD9BRC',
  url: 'https://www.amazon.com/dp/B00TTD9BRC',
  priceUsd: null,
});
assert.deepStrictEqual(
  {
    title: detailMerged.title,
    priceUsd: detailMerged.priceUsd,
    weightGrams: detailMerged.weightGrams,
    weightText: detailMerged.weightText,
  },
  {
    title: 'CeraVe Moisturizing Cream, 19 Ounce',
    priceUsd: 17.06,
    weightGrams: 630.5,
    weightText: '630.5g',
  },
  'Amazon detail metadata should replace ASIN fallback titles and add product weight.',
);

const missingDetailPrice = amazonCollect.normalizeAmazonDetailRecord({
  title: 'Search-priced product with hidden detail price',
  priceText: '',
  detailText: 'Item Weight 10 ounces',
}, {
  asin: 'B0MISSPRCE',
  title: 'Search-priced product',
  url: 'https://www.amazon.com/dp/B0MISSPRCE',
  priceUsd: 18.88,
});
assert.deepStrictEqual(
  {
    priceUsd: missingDetailPrice.priceUsd,
    detailPriceUsd: missingDetailPrice.detailPriceUsd,
    hasDetailPrice: missingDetailPrice.hasDetailPrice,
  },
  {
    priceUsd: 18.88,
    detailPriceUsd: null,
    hasDetailPrice: false,
  },
  'Amazon detail enrichment should distinguish search-page prices from detail-page prices.',
);

const detailPriceFilter = amazonCollect.filterAmazonCandidatesWithDetailPrices([
  detailMerged,
  missingDetailPrice,
]);
assert.deepStrictEqual(
  detailPriceFilter.accepted.map((item) => item.asin),
  ['B00TTD9BRC'],
  'Amazon candidates without a detail-page price should not be submitted to Miaoshou.',
);
assert.deepStrictEqual(
  detailPriceFilter.skipped.map((item) => item.reason),
  ['missing_amazon_detail_price'],
  'Amazon candidates skipped for missing detail prices should have a clear reason.',
);

const filtered = amazonCollect.filterAmazonCandidates([
  normalized[0],
  { ...normalized[0], url: 'https://www.amazon.com/dp/B0C123ABCD?tag=duplicate' },
  {
    ...normalized[0],
    asin: 'B0EXPENSIV',
    url: 'https://www.amazon.com/dp/B0EXPENSIV',
    title: 'Expensive Charger',
    priceUsd: 99.99,
  },
  {
    ...normalized[0],
    asin: 'B0LOWRATED',
    url: 'https://www.amazon.com/dp/B0LOWRATED',
    title: 'Low Rated Charger',
    rating: 3.2,
  },
  {
    ...normalized[0],
    asin: 'B0LOWCOUNT',
    url: 'https://www.amazon.com/dp/B0LOWCOUNT',
    title: 'Few Reviews Charger',
    reviewCount: 8,
  },
  {
    ...normalized[0],
    asin: 'B0BLOCKED1',
    url: 'https://www.amazon.com/dp/B0BLOCKED1',
    title: 'Brand Replica Charger',
  },
], {
  count: 5,
  amazonMaxPriceUsd: 30,
  amazonMinRating: 4,
  amazonMinReviewCount: 100,
  excludedTerms: ['replica'],
});

assert.deepStrictEqual(
  filtered.accepted.map((item) => item.asin),
  ['B0C123ABCD'],
  'Filtering should keep only candidates that pass price, rating, review, excluded-term, and dedupe checks.',
);
assert.deepStrictEqual(
  filtered.skipped.map((item) => item.reason),
  [
    'duplicate_asin',
    'price_above_max',
    'rating_below_min',
    'review_count_below_min',
    'excluded_term: replica',
  ],
  'Filtering should explain every rejected Amazon candidate.',
);

assert.strictEqual(
  amazonCollect.detectAmazonAccessBlock('Robot Check Enter the characters you see below', 'https://www.amazon.com/errors/validateCaptcha'),
  true,
  'Amazon robot/CAPTCHA pages should be detected.',
);
assert.strictEqual(
  amazonCollect.detectAmazonAccessBlock('Amazon.com results for charger', 'https://www.amazon.com/s?k=charger'),
  false,
  'Normal Amazon search pages should not be treated as blocked.',
);

console.log('amazon browser collect module checks passed');
