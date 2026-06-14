const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dedupe = require('../lib/collection_dedupe_store');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaoshou-collection-dedupe-'));
const filePath = path.join(tempDir, 'dedupe.json');
const now = '2026-06-11T12:00:00.000Z';

assert.strictEqual(
  dedupe.buildCollectionDedupeKey({ asin: 'B00F97FHAW' }, 'amazon'),
  'amazon:B00F97FHAW',
  'Amazon dedupe keys should use ASIN.',
);
assert.strictEqual(
  dedupe.buildCollectionDedupeKey({ url: 'https://www.amazon.com/dp/B00F97FHAW?tag=abc' }, 'amazon'),
  'amazon:B00F97FHAW',
  'Amazon product URLs should normalize to the ASIN key.',
);
assert.strictEqual(
  dedupe.buildCollectionDedupeKey({ url: 'https://detail.1688.com/offer/923280275684.html?spm=abc' }, '1688'),
  '1688:923280275684',
  '1688 dedupe keys should use offer ID.',
);
assert.strictEqual(
  dedupe.buildCollectionDedupeKey({ url: 'https://shopee.com.my/Sunscreen-Hat-i.123.456?sp_atk=abc' }, 'shopee'),
  'shopee:shopee.com.my:123:456',
  'Shopee dedupe keys should use host, shop ID, and item ID.',
);

assert.deepStrictEqual(
  dedupe.loadCollectionDedupeRecords({ filePath }),
  [],
  'Missing dedupe store should load as an empty list.',
);

const marked = dedupe.markCollectedItems([
  { asin: 'B00F97FHAW', url: 'https://www.amazon.com/dp/B00F97FHAW', title: 'CeraVe Moisturizer' },
], {
  source: 'amazon',
  filePath,
  collectedAt: now,
  runId: 'run-1',
});
assert.deepStrictEqual(
  marked.map((item) => item.key),
  ['amazon:B00F97FHAW'],
  'Successful Amazon items should be written to the dedupe store.',
);

const filteredRecent = dedupe.filterRecentCollectionDuplicates([
  { asin: 'B00F97FHAW', url: 'https://www.amazon.com/dp/B00F97FHAW' },
  { asin: 'B07NEWITEM', url: 'https://www.amazon.com/dp/B07NEWITEM' },
], {
  source: 'amazon',
  filePath,
  now: '2026-06-15T12:00:00.000Z',
  windowDays: 7,
});
assert.deepStrictEqual(
  filteredRecent.accepted.map((item) => item.asin),
  ['B07NEWITEM'],
  'Items collected within the dedupe window should be skipped.',
);
assert.deepStrictEqual(
  filteredRecent.duplicates.map((item) => item.dedupeKey),
  ['amazon:B00F97FHAW'],
  'Skipped duplicates should include the dedupe key.',
);
assert.match(
  filteredRecent.duplicates[0].reason,
  /最近 7 天已采集/,
  'Skipped duplicates should explain the 7-day reason.',
);

const filteredOld = dedupe.filterRecentCollectionDuplicates([
  { asin: 'B00F97FHAW', url: 'https://www.amazon.com/dp/B00F97FHAW' },
], {
  source: 'amazon',
  filePath,
  now: '2026-06-20T12:00:00.000Z',
  windowDays: 7,
});
assert.deepStrictEqual(
  filteredOld.accepted.map((item) => item.asin),
  ['B00F97FHAW'],
  'Items outside the dedupe window should be allowed again.',
);

dedupe.saveCollectionDedupeRecords([
  {
    key: 'amazon:B00F97FHAW',
    source: 'amazon',
    url: 'https://www.amazon.com/dp/B00F97FHAW',
    collectedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    key: '1688:923280275684',
    source: '1688',
    url: 'https://detail.1688.com/offer/923280275684.html',
    collectedAt: now,
  },
], { filePath, now, windowDays: 7 });
assert.deepStrictEqual(
  dedupe.loadCollectionDedupeRecords({ filePath }).map((item) => item.key),
  ['1688:923280275684'],
  'Saving should prune records older than the configured window.',
);

fs.writeFileSync(filePath, '{not valid json', 'utf8');
assert.deepStrictEqual(
  dedupe.loadCollectionDedupeRecords({ filePath }),
  [],
  'Corrupt dedupe store should not break collection startup.',
);

console.log('collection dedupe store checks passed');
