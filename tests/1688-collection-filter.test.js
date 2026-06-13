const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildSearchUrl,
  DEFAULT_1688_HOME_URL,
  DEFAULT_COLLECT_OPTIONS,
  COMMON_COLLECT_CLAIMED_PATH,
  COMMON_COLLECT_FETCH_ITEM_PATH,
  buildCollectLinkRetryOptions,
  collectSourceLinksWithMiaoshouApi,
  detectShopeeAccessBlock,
  evaluateCandidate,
  buildPurchasePriceWithFreight,
  extractFreightPriceFromText,
  extractProductUnitPriceFromText,
  isMiaoshouServiceUnavailableError,
  normalizeOptions,
  normalizeSearchCandidateRecords,
  normalizeSourceLinks,
  parseArgs,
  parseSearchCardPrice,
  parseWeightFromText,
  resolveSearchOfferUrl,
  selectDetailProductTitle,
  splitTerms,
} = require('../miaoshou_1688_collect');

const collectScriptSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_1688_collect.js'), 'utf8');

assert.strictEqual(DEFAULT_1688_HOME_URL, 'https://www.1688.com', 'Collection should warm up on the 1688 home page.');
assert.ok(
  collectScriptSource.includes('await page.goto(DEFAULT_1688_HOME_URL'),
  'Collection runs should open 1688.com before searching from the home page.',
);
assert.ok(
  collectScriptSource.includes('async function searchKeywordFromHome(page, keyword)'),
  'Collection runs should search keywords from the 1688 home page input.',
);
assert.ok(
  collectScriptSource.includes('await searchKeywordFromHome(page, keyword)'),
  'Collection loops should use the 1688 home page search helper.',
);
assert.ok(
  !collectScriptSource.includes('await page.goto(buildSearchUrl(keyword)'),
  'Collection loops should not directly navigate to 1688 search result URLs.',
);
assert.ok(
  collectScriptSource.includes('collectSourceLinksWithMiaoshouApi'),
  'Collection runs should collect approved source links through Miaoshou Open API.',
);
assert.ok(
  collectScriptSource.includes(COMMON_COLLECT_FETCH_ITEM_PATH),
  'Collection runs should call the common collection-box source-link endpoint.',
);
assert.ok(
  collectScriptSource.includes(COMMON_COLLECT_CLAIMED_PATH),
  'Collection runs should call the common collection-box platform claim endpoint.',
);
assert.ok(
  !collectScriptSource.includes('--load-extension='),
  'Collection browser launches should no longer rely on the Miaoshou Chrome extension.',
);
assert.ok(
  !collectScriptSource.includes('await collectCurrentDetailPage'),
  'Collection runs should not mark success by clicking a browser plugin button.',
);
assert.ok(
  collectScriptSource.includes('if (options.links.length === 0)'),
  'Direct detail-link collection should open the detail page before applying price/title filters.',
);
assert.ok(
  collectScriptSource.includes('skipFilters: toBoolean(input.skipFilters || input.collectSkipFilters, DEFAULT_COLLECT_OPTIONS.skipFilters)')
    && collectScriptSource.includes("if (!options.skipFilters && detailDecision.decision !== 'collect')"),
  'Direct detail-link collection should be able to skip automatic price, score, exclusion and safe-mode filters.',
);

assert.strictEqual(DEFAULT_COLLECT_OPTIONS.count, 10, 'Default collection count should be 10.');
assert.strictEqual(DEFAULT_COLLECT_OPTIONS.maxPriceCny, 10, 'Default max purchase price should be 10 CNY.');
assert.deepStrictEqual(DEFAULT_COLLECT_OPTIONS.keywords, [], 'Default keywords should be empty.');
assert.deepStrictEqual(DEFAULT_COLLECT_OPTIONS.preferredTerms, [], 'Default preferred terms should be empty.');
assert.deepStrictEqual(DEFAULT_COLLECT_OPTIONS.excludedTerms, [], 'Default excluded terms should be empty.');
assert.strictEqual(DEFAULT_COLLECT_OPTIONS.safeMode, false, 'Safe mode should be disabled by default.');
assert.strictEqual(DEFAULT_COLLECT_OPTIONS.minScore, 50, 'Default minimum score should be 50.');

const amazonOptions = normalizeOptions({
  source: 'amazon',
  amazonMode: 'links',
  links: 'B08N5WRWNW https://www.amazon.com/dp/B0C123ABCD?tag=x',
  amazonMaxPriceUsd: '35.5',
  amazonMinRating: '4.2',
  amazonMinReviewCount: '100',
});
assert.strictEqual(amazonOptions.source, 'amazon', 'Collection source normalization should accept Amazon.');
assert.strictEqual(amazonOptions.amazonMode, 'links', 'Amazon link/ASIN mode should be accepted.');
assert.deepStrictEqual(
  amazonOptions.amazonLinks.map((item) => item.url),
  ['https://www.amazon.com/dp/B08N5WRWNW', 'https://www.amazon.com/dp/B0C123ABCD'],
  'Amazon links and ASINs should normalize to canonical Amazon product URLs.',
);
assert.strictEqual(amazonOptions.amazonMaxPriceUsd, 35.5, 'Amazon max price should parse as USD.');
assert.strictEqual(amazonOptions.amazonMinRating, 4.2, 'Amazon minimum rating should parse.');
assert.strictEqual(amazonOptions.amazonMinReviewCount, 100, 'Amazon minimum review count should parse.');

const amazonArgs = parseArgs([
  '--source', 'amazon',
  '--amazon-mode', 'keyword',
  '--keywords', 'wireless charger',
  '--count', '3',
  '--amazon-max-price-usd', '29.99',
  '--amazon-min-rating', '4',
  '--amazon-min-review-count', '50',
]);
assert.strictEqual(amazonArgs.source, 'amazon', 'CLI should accept --source amazon.');
assert.strictEqual(amazonArgs.amazonMode, 'keyword', 'CLI should accept --amazon-mode keyword.');
assert.deepStrictEqual(amazonArgs.keywords, ['wireless charger'], 'Amazon keyword CLI input should parse through shared keywords.');
assert.strictEqual(amazonArgs.amazonMaxPriceUsd, 29.99, 'CLI should pass Amazon max price.');
assert.strictEqual(amazonArgs.amazonMinRating, 4, 'CLI should pass Amazon minimum rating.');
assert.strictEqual(amazonArgs.amazonMinReviewCount, 50, 'CLI should pass Amazon minimum review count.');

assert.ok(
  collectScriptSource.includes("const COLLECT_SOURCE_AMAZON = 'amazon'")
    && collectScriptSource.includes('normalizeAmazonProductInputs')
    && collectScriptSource.includes('collectAmazonCandidatesFromKeywords')
    && collectScriptSource.includes('async function runAmazonCollection'),
  'Collection script should define and route Amazon browser collection.',
);
assert.ok(
  collectScriptSource.includes('AMAZON_CLAIM_INITIAL_DELAY_MS')
    && collectScriptSource.includes('buildCollectLinkRetryOptions(COLLECT_SOURCE_AMAZON)')
    && collectScriptSource.includes('candidateUrls')
    && collectScriptSource.includes('Amazon 搜索页已读取'),
  'Amazon collection should batch submit candidates and use a longer Miaoshou claim wait instead of failing quickly per item.',
);
assert.ok(
  collectScriptSource.includes("require('./lib/collection_dedupe_store')")
    && collectScriptSource.includes('filterRecentCollectionDuplicates')
    && collectScriptSource.includes('markCollectedItems')
    && collectScriptSource.includes('跳过最近 7 天已采集商品'),
  'Collection script should skip source products collected during the last 7 days and record successful collection results.',
);
assert.ok(
  collectScriptSource.includes('extractAmazonProductDetail')
    && collectScriptSource.includes('async function enrichAmazonCandidatesWithDetails')
    && collectScriptSource.includes('Amazon 详情已补全')
    && collectScriptSource.includes('weightText: candidate.weightText')
    && collectScriptSource.includes('weightGrams: candidate.weightGrams'),
  'Amazon collection should enrich search candidates from product detail pages before recording titles and weights.',
);
assert.ok(
  collectScriptSource.includes('filterAmazonCandidatesWithDetailPrices')
    && collectScriptSource.includes('missing_amazon_detail_price')
    && collectScriptSource.includes('避免妙手来源价格为空'),
  'Amazon collection should skip candidates whose detail page has no standard price before submitting to Miaoshou.',
);

const amazonRetryOptions = buildCollectLinkRetryOptions('amazon');
assert.strictEqual(amazonRetryOptions.source, 'amazon', 'Amazon collect-link retry options should preserve source.');
assert.ok(
  amazonRetryOptions.claimInitialDelayMs > 30000
    && amazonRetryOptions.claimRetryCount > 6
    && amazonRetryOptions.claimRetryDelayMs >= 10000,
  'Amazon collect-link retry options should wait longer than the 1688 default because Miaoshou processes Amazon links more slowly.',
);

assert.deepStrictEqual(
  splitTerms('防晒帽, 防晒冰袖，遮阳伞\n防晒面罩'),
  ['防晒帽', '防晒冰袖', '遮阳伞', '防晒面罩'],
  'Terms should split on Chinese punctuation, commas, and newlines.',
);

const searchUrl = buildSearchUrl('防晒帽');
assert.ok(
  searchUrl.includes('keywords=%B7%C0%C9%B9%C3%B1'),
  '1688 search URLs should encode Chinese keywords as GBK to avoid mojibake.',
);
assert.ok(
  !searchUrl.includes('%E9%98%B2%E6%99%92%E5%B8%BD'),
  '1688 search URLs should not use UTF-8 keyword encoding for the legacy search page.',
);
assert.strictEqual(
  resolveSearchOfferUrl({
    rawUrl: 'http://detail.m.1688.com/page/index.html?offerId=1045281033953&trace_log=normal',
    metadataText: '',
  }),
  'https://detail.1688.com/offer/1045281033953.html',
  'Mobile search-result offer URLs should resolve to desktop detail pages.',
);
assert.strictEqual(
  resolveSearchOfferUrl({
    rawUrl: 'https://dj.1688.com/ci_king?a=1',
    metadataText: 'data-aplus-report=sw_expo@^object_id@673532698422^object_type@offer',
  }),
  'https://detail.1688.com/offer/673532698422.html',
  'Ad search-result cards should resolve detail URLs from object_id metadata.',
);
assert.strictEqual(
  resolveSearchOfferUrl({
    rawUrl: '',
    metadataText: 'data-renderkey=1_4_normal_b2b-22175071575324842f_771413041900',
  }),
  'https://detail.1688.com/offer/771413041900.html',
  'Search-result cards should resolve detail URLs from data-renderkey offer IDs.',
);
assert.strictEqual(
  resolveSearchOfferUrl({
    rawUrl: '',
    metadataText: 'object_type@suggest^targetKeyword@防晒帽',
  }),
  '',
  'Blank raw URLs should not become the 1688 detail root page.',
);
assert.strictEqual(
  resolveSearchOfferUrl({
    rawUrl: '',
    metadataText: 'data-offer-id="923280275684"',
  }),
  'https://detail.1688.com/offer/923280275684.html',
  'Search-result cards should resolve detail URLs from data-offer-id attributes.',
);
assert.strictEqual(
  parseSearchCardPrice(`瑞雅防晒帽
¥
2
.69
限时价`),
  2.69,
  'Search-result card prices should parse when 1688 splits yuan and decimals across lines.',
);

assert.strictEqual(
  parseSearchCardPrice('3000件以内 承诺48小时发货 运费 ¥2.50 起 VSEA净澈脱毛膏 ¥1.98'),
  1.98,
  'Search-result card prices should ignore shipping quantity promises and freight before the product price.',
);

assert.ok(
  Number.isNaN(parseSearchCardPrice('3000件以内 承诺48小时发货 库存199441盒')),
  'Search-result card prices should not fall back to quantity or stock numbers when no product price is visible.',
);

assert.strictEqual(
  selectDetailProductTitle({
    candidates: [
      '义乌寰玲伦妆品有限公司',
      '防晒帽女夏户外防紫外线空顶帽 - 阿里巴巴',
      '义乌市寰玲伦妆品有限公司',
    ],
    fallbackTitle: 'https://detail.1688.com/offer/827489758146.html',
  }),
  '防晒帽女夏户外防紫外线空顶帽',
  'Detail-page title extraction should prefer the real product title over shop or company names.',
);

assert.strictEqual(
  extractProductUnitPriceFromText('运费 ¥3.70 起 价格 ¥2.00 限时价 已售 2.9万件'),
  2,
  'Detail-page unit price extraction should not pick a freight amount before the product price.',
);

assert.strictEqual(
  extractFreightPriceFromText('价格 ¥2.00 退货包运费 运费 ¥3.70 起 48小时发货'),
  3.7,
  'Detail-page freight extraction should read explicit freight prices.',
);

assert.strictEqual(
  buildPurchasePriceWithFreight(2, 3.7),
  5.7,
  'Collection purchase price should include freight for history display and max-price filtering.',
);

const modernSearchCandidates = normalizeSearchCandidateRecords([
  {
    title: '',
    rawUrl: '',
    metadataText: 'class=offer-card | data-offer-id="923280275684"',
    sourceText: `新品
瑞雅防晒帽 女夏户外防紫外线空顶帽
防晒 空顶帽 锦纶
¥
2
.69
限时价 已售2.9万+件
义乌市瑞雅服饰厂`,
  },
], '防晒帽', DEFAULT_COLLECT_OPTIONS);

assert.strictEqual(modernSearchCandidates.length, 1, 'Modern 1688 search cards should be accepted as candidates.');
assert.strictEqual(modernSearchCandidates[0].url, 'https://detail.1688.com/offer/923280275684.html');
assert.strictEqual(modernSearchCandidates[0].price, 2.69);
assert.match(modernSearchCandidates[0].title, /瑞雅防晒帽/, 'Modern 1688 search cards should read the product title line.');

const detailOnlyCandidates = normalizeSearchCandidateRecords([
  {
    title: '挑好货',
    rawUrl: 'https://www.1688.com/',
    metadataText: '',
    sourceText: '挑好货',
  },
  {
    title: '防晒帽 大帽檐',
    rawUrl: '',
    metadataText: 'object_type@suggest^targetKeyword@防晒帽',
    sourceText: '防晒帽\n大帽檐',
  },
  {
    title: '户外防晒帽女夏季遮阳帽',
    rawUrl: 'https://detail.1688.com/offer/923280275684.html',
    metadataText: '',
    sourceText: '户外防晒帽女夏季遮阳帽\n¥\n2\n.69\n已售2.9万件',
  },
], '防晒帽', {
  ...DEFAULT_COLLECT_OPTIONS,
  maxCandidates: 1,
});

assert.strictEqual(detailOnlyCandidates.length, 1, 'Non-product navigation and suggestion records should not consume candidate slots.');
assert.strictEqual(detailOnlyCandidates[0].url, 'https://detail.1688.com/offer/923280275684.html');

const productTitleFromCardText = normalizeSearchCandidateRecords([
  {
    title: '江西犀瑞制造有限公司',
    rawUrl: 'http://gzshuermei.1688.com/',
    metadataText: 'object_type@offer^offerId@1034519688287',
    sourceText: `犀瑞迷你脱毛刀女士专用防刮伤除毛器便携私密唇毛刮毛刀原厂直销
¥0.86
售10万+件
江西犀瑞制造有限公司`,
  },
], '防晒帽', DEFAULT_COLLECT_OPTIONS);

assert.strictEqual(productTitleFromCardText.length, 1);
assert.strictEqual(
  productTitleFromCardText[0].title,
  '犀瑞迷你脱毛刀女士专用防刮伤除毛器便携私密唇毛刮毛刀原厂直销',
  'Company link text should not override the product title line from the card.',
);

const parsed = parseArgs([
  '--keywords', '防晒帽,防晒冰袖',
  '--count', '8',
  '--max-price', '9.5',
  '--preferred-terms', '防晒帽,冰袖',
  '--excluded-terms', '防晒霜,喷雾',
  '--min-score', '70',
  '--safe-mode', 'false',
  '--headless', 'true',
  '--links', 'https://detail.1688.com/offer/923280275684.html\nhttps://detail.1688.com/offer/923280275685.html',
]);

assert.deepStrictEqual(parsed.keywords, ['防晒帽', '防晒冰袖']);
assert.strictEqual(parsed.count, 8);
assert.strictEqual(parsed.maxPriceCny, 9.5);
assert.deepStrictEqual(parsed.preferredTerms, ['防晒帽', '冰袖']);
assert.deepStrictEqual(parsed.excludedTerms, ['防晒霜', '喷雾']);
assert.strictEqual(parsed.minScore, 70);
assert.strictEqual(parsed.safeMode, false);
assert.strictEqual(parsed.headless, true);
assert.deepStrictEqual(parsed.links, [
  'https://detail.1688.com/offer/923280275684.html',
  'https://detail.1688.com/offer/923280275685.html',
]);
assert.deepStrictEqual(
  normalizeSourceLinks('https://shopee.com.my/Sunscreen-Hat-i.123.456?sp_atk=abc'),
  ['https://shopee.com.my/Sunscreen-Hat-i.123.456'],
  'Miaoshou source-link collection should accept normalized Shopee product links.',
);
const shopeeParsed = parseArgs([
  '--source', 'shopee',
  '--shopee-site', 'my',
  '--shopee-max-price', '25',
  '--shopee-max-moq', '3',
  '--keywords', 'sunscreen hat',
]);
assert.strictEqual(shopeeParsed.source, 'shopee', 'Collection CLI should accept Shopee as an automatic source.');
assert.strictEqual(shopeeParsed.shopeeSite, 'my', 'Shopee automatic collection should accept Malaysia site.');
assert.strictEqual(shopeeParsed.shopeeMaxPrice, 25, 'Shopee maximum display price should be parsed.');
assert.strictEqual(shopeeParsed.shopeeMaxMoq, 3, '1688 maximum MOQ for Shopee matching should be parsed.');
assert.strictEqual(
  detectShopeeAccessBlock({
    url: 'https://shopee.com.my/verify/traffic/error?next=https%3A%2F%2Fshopee.com.my%2Fsearch',
    title: 'Shopee Malaysia | Free Shipping Across Malaysia',
    bodyText: 'Page Unavailable Looks like you’re not logged in yet. Log InBack to Home Page',
  }),
  'Shopee 要求登录或流量验证；请在自动化 Chrome 窗口登录 Shopee 后重试。',
  'Shopee access-block pages should fail with an actionable login/verification message.',
);
assert.strictEqual(
  detectShopeeAccessBlock({
    url: 'https://shopee.com.my/buyer/login?next=https%3A%2F%2Fshopee.com.my%2Fsearch',
    title: 'Login',
    bodyText: 'Log In Password Forgot Password',
  }),
  'Shopee 登录还未完成；请在自动化 Chrome 窗口完成登录后等待程序继续。',
  'Shopee login pages should keep the browser waiting instead of continuing to zero-result extraction.',
);
assert.ok(
  collectScriptSource.includes('async function runShopeeCollection'),
  'Collection script should implement the Shopee automatic collection workflow.',
);
assert.ok(
  collectScriptSource.includes('await assertShopeeSearchAccessible(page)'),
  'Shopee automatic collection should stop immediately when search redirects to login or traffic verification.',
);
assert.ok(
  collectScriptSource.includes('async function waitForShopeeAccessRecovery')
    && collectScriptSource.includes('等待你在打开的 Shopee 窗口完成登录或验证'),
  'Shopee automatic collection should keep the browser open long enough for manual login or verification recovery.',
);
assert.ok(
  collectScriptSource.includes('const DEFAULT_SHOPEE_ACCESS_RECOVERY_TIMEOUT_MS = 600000;')
    && collectScriptSource.includes('await hasShopeeSearchCandidates(page)'),
  'Shopee login recovery should wait longer and only continue after real search candidates appear.',
);

const safeAccessory = evaluateCandidate({
  title: '户外防晒帽女夏季遮阳帽空顶帽骑车防紫外线',
  price: 6.8,
  shopName: '义乌户外用品厂',
}, DEFAULT_COLLECT_OPTIONS);

assert.strictEqual(safeAccessory.decision, 'collect', 'Safe sunscreen accessories should be collectable.');
assert.ok(safeAccessory.score >= DEFAULT_COLLECT_OPTIONS.minScore, 'Collectable candidate should meet score threshold.');

const cosmetic = evaluateCandidate({
  title: 'SPF50 防晒霜美白防晒乳隔离霜',
  price: 8.8,
}, { ...DEFAULT_COLLECT_OPTIONS, safeMode: true });

assert.strictEqual(cosmetic.decision, 'reject', 'Safe mode should reject regulated sunscreen cosmetics.');
assert.match(cosmetic.reason, /安全模式|排除词|高风险/, 'Rejected cosmetics should explain the safety reason.');

const tooExpensive = evaluateCandidate({
  title: '夏季防晒冰袖男女户外骑行袖套',
  price: 12,
}, DEFAULT_COLLECT_OPTIONS);

assert.strictEqual(tooExpensive.decision, 'reject', 'Candidates above the max purchase price should be rejected.');
assert.match(tooExpensive.reason, /价格/, 'Over-price candidates should explain the price reason.');

const customRejected = evaluateCandidate({
  title: '户外防晒帽儿童遮阳帽',
  price: 5,
}, {
  ...DEFAULT_COLLECT_OPTIONS,
  excludedTerms: ['儿童'],
});

assert.strictEqual(customRejected.decision, 'reject', 'User-defined excluded terms should reject matching candidates.');

assert.deepStrictEqual(
  parseWeightFromText('包装信息 重量(g) 120 净含量 30ml'),
  { weightGrams: 120, weightText: '120g' },
  'Collection details should read product package weight from 1688 text.',
);

assert.deepStrictEqual(
  parseWeightFromText('商品规格 单件重量 0.25kg 适合户外防晒'),
  { weightGrams: 250, weightText: '250g' },
  'Collection details should normalize kilogram weights to grams.',
);

assert.strictEqual(
  isMiaoshouServiceUnavailableError(new Error('妙手接口返回非 JSON 内容：502 Bad Gateway 502 Bad Gateway nginx')),
  true,
  'Miaoshou 502 HTML responses should be treated as service outages.',
);

assert.strictEqual(
  isMiaoshouServiceUnavailableError(new Error('妙手接口 HTTP 503：Service Unavailable')),
  true,
  'Miaoshou 503 responses should be treated as service outages.',
);

assert.strictEqual(
  isMiaoshouServiceUnavailableError(new Error('妙手接口失败 fail：存在未采集成功的产品')),
  false,
  'Pending collection responses should still use claim retry instead of service-outage abort.',
);

assert.ok(
  /catch \(error\) \{[\s\S]{0,800}isMiaoshouServiceUnavailableError\(error\)[\s\S]{0,800}throw error/.test(collectScriptSource),
  'Collection loops should stop immediately when Miaoshou service returns 502/503/504.',
);

(async () => {
  const calls = [];
  const apiResult = await collectSourceLinksWithMiaoshouApi([
    'https://detail.1688.com/offer/923280275684.html',
  ], {
    request: async (apiPath, requestOptions) => {
      calls.push({ path: apiPath, body: requestOptions.body });
      if (apiPath === COMMON_COLLECT_FETCH_ITEM_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            sourceItemIdAndDetailIdMap: {
              923280275684: 666001,
            },
          },
        };
      }
      if (apiPath === COMMON_COLLECT_CLAIMED_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            platformCollectBoxDetailIdMap: {
              tiktok: {
                666001: 888001,
              },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${apiPath}`);
    },
  });

  assert.deepStrictEqual(
    calls,
    [
      {
        path: COMMON_COLLECT_FETCH_ITEM_PATH,
        body: {
          collectLinks: ['https://detail.1688.com/offer/923280275684.html'],
        },
      },
      {
        path: COMMON_COLLECT_CLAIMED_PATH,
        body: {
          detailSerialNumberPlatformList: [
            {
              detailId: 666001,
              platform: 'tiktok',
              serialNumber: 1,
            },
          ],
        },
      },
    ],
    'API collection should fetch source links first and then claim common details to TikTok.',
  );
  assert.strictEqual(apiResult.commonCollectBoxDetailIds[0], 666001);
  assert.deepStrictEqual(apiResult.platformCollectBoxDetailIdMap.tiktok, { 666001: 888001 });

  const amazonCalls = [];
  const amazonApiResult = await collectSourceLinksWithMiaoshouApi([
    'https://www.amazon.com/dp/B00F97FHAW?tag=abc',
  ], {
    source: 'amazon',
    request: async (apiPath, requestOptions) => {
      amazonCalls.push({ path: apiPath, body: requestOptions.body });
      if (apiPath === COMMON_COLLECT_FETCH_ITEM_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            sourceItemIdAndDetailIdMap: {
              B00F97FHAW: 669001,
            },
          },
        };
      }
      if (apiPath === COMMON_COLLECT_CLAIMED_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            platformCollectBoxDetailIdMap: {
              tiktok: {
                669001: 889001,
              },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${apiPath}`);
    },
  });
  assert.deepStrictEqual(
    amazonCalls[0],
    {
      path: COMMON_COLLECT_FETCH_ITEM_PATH,
      body: {
        collectLinks: ['https://www.amazon.com/dp/B00F97FHAW'],
      },
    },
    'Amazon collection should submit normalized amazon.com product links instead of filtering them out as non-1688 links.',
  );
  assert.strictEqual(amazonApiResult.commonCollectBoxDetailIds[0], 669001);

  const retryCalls = [];
  const retryResult = await collectSourceLinksWithMiaoshouApi([
    'https://detail.1688.com/offer/923280275684.html',
  ], {
    claimRetryDelayMs: 0,
    request: async (apiPath, requestOptions) => {
      retryCalls.push({ path: apiPath, body: requestOptions.body });
      if (apiPath === COMMON_COLLECT_FETCH_ITEM_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            sourceItemIdAndDetailIdMap: {
              923280275684: 777001,
            },
          },
        };
      }
      if (apiPath === COMMON_COLLECT_CLAIMED_PATH && retryCalls.filter((call) => call.path === COMMON_COLLECT_CLAIMED_PATH).length === 1) {
        throw new Error('妙手接口失败 fail：存在未采集成功的产品');
      }
      if (apiPath === COMMON_COLLECT_CLAIMED_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            platformCollectBoxDetailIdMap: {
              tiktok: {
                777001: 999001,
              },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${apiPath}`);
    },
  });

  assert.strictEqual(
    retryCalls.filter((call) => call.path === COMMON_COLLECT_CLAIMED_PATH).length,
    2,
    'API collection should retry TikTok claim while Miaoshou is still collecting the source product.',
  );
  assert.deepStrictEqual(retryResult.platformCollectBoxDetailIdMap.tiktok, { 777001: 999001 });

  const fetchGatewayRetryCalls = [];
  const fetchGatewayRetryResult = await collectSourceLinksWithMiaoshouApi([
    'https://detail.1688.com/offer/923280275684.html',
  ], {
    fetchServiceRetryCount: 1,
    fetchServiceRetryDelayMs: 0,
    request: async (apiPath, requestOptions) => {
      fetchGatewayRetryCalls.push({ path: apiPath, body: requestOptions.body });
      if (
        apiPath === COMMON_COLLECT_FETCH_ITEM_PATH
        && fetchGatewayRetryCalls.filter((call) => call.path === COMMON_COLLECT_FETCH_ITEM_PATH).length === 1
      ) {
        throw new Error('妙手接口返回非 JSON 内容：502 Bad Gateway 502 Bad Gateway nginx');
      }
      if (apiPath === COMMON_COLLECT_FETCH_ITEM_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            sourceItemIdAndDetailIdMap: {
              923280275684: 779001,
            },
          },
        };
      }
      if (apiPath === COMMON_COLLECT_CLAIMED_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            platformCollectBoxDetailIdMap: {
              tiktok: {
                779001: 999003,
              },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${apiPath}`);
    },
  });

  assert.strictEqual(
    fetchGatewayRetryCalls.filter((call) => call.path === COMMON_COLLECT_FETCH_ITEM_PATH).length,
    2,
    'API collection should only make the configured low-frequency retry when Miaoshou source-link collection returns a gateway error.',
  );
  assert.deepStrictEqual(fetchGatewayRetryResult.platformCollectBoxDetailIdMap.tiktok, { 779001: 999003 });

  const gatewayRetryCalls = [];
  const gatewayRetryResult = await collectSourceLinksWithMiaoshouApi([
    'https://detail.1688.com/offer/923280275684.html',
  ], {
    claimServiceRetryCount: 1,
    claimServiceRetryDelayMs: 0,
    request: async (apiPath, requestOptions) => {
      gatewayRetryCalls.push({ path: apiPath, body: requestOptions.body });
      if (apiPath === COMMON_COLLECT_FETCH_ITEM_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            sourceItemIdAndDetailIdMap: {
              923280275684: 778001,
            },
          },
        };
      }
      if (
        apiPath === COMMON_COLLECT_CLAIMED_PATH
        && gatewayRetryCalls.filter((call) => call.path === COMMON_COLLECT_CLAIMED_PATH).length === 1
      ) {
        throw new Error('妙手接口返回非 JSON 内容：502 Bad Gateway 502 Bad Gateway nginx');
      }
      if (apiPath === COMMON_COLLECT_CLAIMED_PATH) {
        return {
          result: 'success',
          code: 'success',
          data: {
            platformCollectBoxDetailIdMap: {
              tiktok: {
                778001: 999002,
              },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${apiPath}`);
    },
  });

  assert.strictEqual(
    gatewayRetryCalls.filter((call) => call.path === COMMON_COLLECT_CLAIMED_PATH).length,
    2,
    'API collection should only make the configured low-frequency retry when Miaoshou claim returns a gateway error.',
  );
  assert.deepStrictEqual(gatewayRetryResult.platformCollectBoxDetailIdMap.tiktok, { 778001: 999002 });

  console.log('1688 collection filter checks passed');
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
