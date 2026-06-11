const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source1688Lookup = require('../lib/source_1688_lookup.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

async function run() {
  assert.strictEqual(
    typeof source1688Lookup.tryResolve1688UnitAndFreightBySourceUrl,
    'function',
    '1688 source-url price lookup should live in source_1688_lookup.',
  );
  assert.strictEqual(
    typeof source1688Lookup.tryResolve1688GrossWeightByImage,
    'function',
    '1688 image weight lookup should live in source_1688_lookup.',
  );
  assert.strictEqual(
    typeof source1688Lookup.extractFirst1688OfferUrl,
    'function',
    '1688 offer URL extraction should live in source_1688_lookup.',
  );

  assert.strictEqual(
    source1688Lookup.is1688AntiBotBlocked('captcha x5secdata', ''),
    true,
    '1688 anti-bot markers should be detected from page text.',
  );
  assert.strictEqual(
    source1688Lookup.extractFirst1688OfferUrl('go https://detail.1688.com/offer/123456.html?spm=a more'),
    'https://detail.1688.com/offer/123456.html?spm=a',
    'First 1688 offer URL should be normalized with URL parsing.',
  );
  assert.strictEqual(source1688Lookup.isLikely1688Url('https://detail.1688.com/offer/1.html'), true);
  assert.strictEqual(source1688Lookup.isLikely1688Url('https://example.com/offer/1.html'), false);
  assert.strictEqual(source1688Lookup.estimateDomesticFreightByWeight(0.12), 3.1);

  const sourceUrl = 'https://detail.1688.com/offer/111.html?trace=source';
  const offerUrl = 'https://detail.1688.com/offer/222.html?spm=abc';
  const priceCalls = [];
  const priceResult = await source1688Lookup.tryResolve1688UnitAndFreightBySourceUrl({
    sourceUrl,
    fetchText: async (url) => {
      priceCalls.push(url);
      if (url === sourceUrl) {
        return {
          ok: true,
          status: 200,
          finalUrl: sourceUrl,
          text: `商品入口 ${offerUrl}`,
        };
      }
      if (url === offerUrl) {
        return {
          ok: true,
          status: 200,
          finalUrl: offerUrl,
          text: '起批2件 运费 ¥2.50 价格 ¥8.88',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  assert.deepStrictEqual(priceCalls, [sourceUrl, offerUrl]);
  assert.strictEqual(priceResult.matched, true);
  assert.strictEqual(priceResult.source, '1688_source_url');
  assert.strictEqual(priceResult.unitPriceCny, 8.88);
  assert.strictEqual(priceResult.freightPriceCny, 2.5);

  const imageUrl = 'https://img.example.test/product.jpg';
  const expectedSearchUrl = `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageAddress=${encodeURIComponent(imageUrl)}`;
  const weightOfferUrl = 'https://detail.1688.com/offer/333.html';
  const weightCalls = [];
  const weightResult = await source1688Lookup.tryResolve1688GrossWeightByImage({
    imageUrl,
    fetchText: async (url) => {
      weightCalls.push(url);
      if (url === expectedSearchUrl) {
        return {
          ok: true,
          status: 200,
          finalUrl: expectedSearchUrl,
          text: `search result ${weightOfferUrl}`,
        };
      }
      if (url === weightOfferUrl) {
        return {
          ok: true,
          status: 200,
          finalUrl: weightOfferUrl,
          text: '商品详情 毛重 120g 现货',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  assert.deepStrictEqual(weightCalls, [expectedSearchUrl, weightOfferUrl]);
  assert.strictEqual(weightResult.matched, true);
  assert.strictEqual(weightResult.weightKg, 0.12);
  assert.strictEqual(weightResult.source, '1688_image_search_gross');

  assert.ok(
    autoSource.includes("require('./lib/source_1688_lookup')"),
    'miaoshou_auto.js should import 1688 lookup helpers from lib/source_1688_lookup.js.',
  );

  console.log('source 1688 lookup module checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
