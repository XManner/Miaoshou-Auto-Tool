const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sourceItemLinks = require('../lib/source_item_links.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof sourceItemLinks.extractPrimaryProductImageUrl,
  'function',
  'Primary product image extraction should live in source_item_links.',
);
assert.strictEqual(
  typeof sourceItemLinks.extractSourceProductUrl,
  'function',
  'Source product URL extraction should live in source_item_links.',
);
assert.strictEqual(
  typeof sourceItemLinks.uniqueUrlList,
  'function',
  'URL normalization and dedupe should live in source_item_links.',
);
assert.strictEqual(
  typeof sourceItemLinks.collectSkuImageUrlsFromPropertyList,
  'function',
  'SKU image URL collection should live in source_item_links.',
);

assert.deepStrictEqual(
  sourceItemLinks.uniqueUrlList([
    'https://cdn.example.com/a.jpg?x=1#hero',
    'https://cdn.example.com/a.jpg?x=2',
    '',
    'not a url?x=1#frag',
  ]),
  [
    'https://cdn.example.com/a.jpg',
    'not a url',
  ],
  'URL dedupe should strip query and hash consistently.',
);

assert.strictEqual(
  sourceItemLinks.extractPrimaryProductImageUrl(
    {
      thumbnail: 'https://img.example.com/thumb.jpg',
    },
    {
      imgUrls: ['https://img.example.com/main.jpg?spm=1#top'],
      notes: '<p><img src="https://img.example.com/detail.jpg?x=1"></p>',
    },
  ),
  'https://img.example.com/main.jpg',
  'Primary image should prefer itemInfo.imgUrls before notes and item thumbnails.',
);

const item = {
  url: 'https://example.com/non-source.html',
  nested: {
    text: 'backup https://detail.1688.com/offer/222.html?trace=abc',
  },
};
const itemInfo = {
  notes: '<a href="https://detail.1688.com/offer/111.html?spm=a">source</a>',
};

assert.strictEqual(
  sourceItemLinks.extractSourceProductUrl(item, itemInfo),
  'https://detail.1688.com/offer/111.html',
  'Source URL extraction should prefer 1688 links from notes/free text over non-source direct URLs.',
);

assert.deepStrictEqual(
  sourceItemLinks.collectSkuImageUrlsFromPropertyList([
    {
      attrValueList: [
        {
          imgUrl: 'https://img.example.com/sku-main.jpg?x=1',
          supplementarySkuImageUrls: [
            'https://img.example.com/sku.jpg?x=1',
            'https://img.example.com/sku.jpg?x=2',
          ],
        },
      ],
    },
  ]),
  ['https://img.example.com/sku-main.jpg', 'https://img.example.com/sku.jpg'],
  'SKU image URL collection should include attr value main images and normalize supplementary SKU images.',
);

assert.ok(
  autoSource.includes("require('./lib/source_item_links')"),
  'miaoshou_auto.js should import source link helpers from lib/source_item_links.js.',
);

console.log('source item links module checks passed');
