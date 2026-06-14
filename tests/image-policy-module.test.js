const assert = require('assert');
const fs = require('fs');
const path = require('path');
const imagePolicy = require('../lib/image_policy.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

const main1 = 'https://img.example.com/main-1.jpg?x-oss-process=image/resize#hash';
const main1Clean = 'https://img.example.com/main-1.jpg';
const main2 = 'https://img.example.com/main-2.png';
const note1 = 'https://img.example.com/detail-1.jpg';
const coupon = 'https://img.example.com/follow-gift-coupon.jpg';
const whiteDetail = 'https://img.example.com/white-detail.png';

assert.strictEqual(
  typeof imagePolicy.buildStrictCleanImagePlan,
  'function',
  'Image policy helpers should live in lib/image_policy.js.',
);
assert.strictEqual(
  imagePolicy.normalizeImageUrl(main1),
  main1Clean,
  'Image URL normalization should strip query strings and hashes.',
);
assert.strictEqual(
  imagePolicy.isMiaoshouSupportedMainImageUrl('https://img.example.com/a.jpeg?size=large'),
  true,
  'JPG/JPEG/PNG images should be supported for Miaoshou main images.',
);
assert.strictEqual(
  imagePolicy.isMiaoshouSupportedMainImageUrl('https://img.example.com/a.webp'),
  false,
  'Unsupported image formats should be rejected for Miaoshou main images.',
);
assert.strictEqual(
  imagePolicy.isLikelyNoisyDetailImageUrl(main1),
  true,
  'Detail image URLs with processing/watermark query parameters should be treated as noisy.',
);
assert.strictEqual(
  imagePolicy.isLikelyIrrelevantImageUrl(coupon),
  true,
  'Coupon/follow-shop banner URLs should be treated as irrelevant.',
);
assert.strictEqual(
  imagePolicy.shouldForceMainImagesByImageSet(
    ['https://img.example.com/a.jpg?__r__=1', 'https://img.example.com/b.jpg?__r__=2'],
    [main1Clean],
  ),
  true,
  'Noisy detail image sets should force detail notes to use main images.',
);
assert.strictEqual(
  imagePolicy.buildImageOnlyNotesHtml([main1, main1Clean, main2]),
  `<p><img src="${main1Clean}"></p>\n<p><img src="${main2}"></p>`,
  'Detail HTML builder should dedupe normalized URLs and render image-only paragraphs.',
);

const verdictMap = new Map([
  [imagePolicy.normalizeImageUrl(coupon), { isRelevant: false, reason: 'coupon' }],
  [imagePolicy.normalizeImageUrl(whiteDetail), { isRelevant: true, visualProfile: { whiteRatio: 0.72 } }],
  [imagePolicy.normalizeImageUrl(note1), { isRelevant: true, visualProfile: { whiteRatio: 0.12 } }],
]);
const itemInfo = {
  imgUrls: [main1, 'https://img.example.com/unsupported.webp', main2],
  notes: [
    `<p><img src="${coupon}"></p>`,
    `<p><img src="${note1}"></p>`,
    `<p><img src="${whiteDetail}"></p>`,
  ].join(''),
  detailImageUrls: [note1],
  productImages: [whiteDetail],
};
const imagePlan = imagePolicy.buildStrictCleanImagePlan(itemInfo, verdictMap);

assert.deepStrictEqual(
  imagePlan.mainImageUrls,
  [main1Clean, main2, note1],
  'Clean image plan should keep supported relevant main images, strip URL noise, and supplement safe detail images when needed.',
);
assert.ok(
  !imagePlan.detailImageUrls.includes(coupon),
  'Clean image plan should remove irrelevant detail images.',
);

const replacementPool = imagePolicy.buildSkuImageReplacementPool({
  itemInfo,
  imagePlan,
  verdictMap,
});
assert.strictEqual(
  replacementPool[0],
  imagePolicy.normalizeImageUrl(whiteDetail),
  'SKU image replacement pool should prefer relevant white-background candidates.',
);

const skuList = imagePolicy.applySkuImagePolicyToPropertyList([
  {
    attrName: 'Color',
    attrValueList: [
      { attrValue: 'Red', supplementarySkuImageUrls: [coupon] },
      { attrValue: 'Blue', supplementarySkuImageUrls: [main2] },
    ],
  },
], { itemInfo, imagePlan, verdictMap });

assert.deepStrictEqual(
  skuList[0].attrValueList.map((value) => value.supplementarySkuImageUrls),
  [[whiteDetail], [main2]],
  'SKU image policy should replace irrelevant SKU images and keep already-safe ones.',
);
assert.ok(
  autoSource.includes("require('./lib/image_policy')"),
  'miaoshou_auto.js should import image policy helpers from lib/image_policy.js.',
);

console.log('image policy module checks passed');
