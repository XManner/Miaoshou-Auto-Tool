const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const iconv = require('iconv-lite');
const puppeteer = require('puppeteer-core');
const {
  normalizeAmazonProductInputs,
  splitAmazonProductInputs,
} = require('./lib/amazon_url');
const {
  collectAmazonCandidatesFromKeywords,
  extractAmazonProductDetail,
  filterAmazonCandidatesWithDetailPrices,
} = require('./lib/amazon_browser_collect');
const {
  DEFAULT_DEDUPE_WINDOW_DAYS,
  filterRecentCollectionDuplicates,
  markCollectedItems,
} = require('./lib/collection_dedupe_store');

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_BROWSER_WINDOW_WIDTH = 1600;
const DEFAULT_BROWSER_WINDOW_HEIGHT = 1100;
const DEFAULT_1688_HOME_URL = 'https://www.1688.com';
const COLLECT_SOURCE_1688 = '1688';
const COLLECT_SOURCE_SHOPEE = 'shopee';
const COLLECT_SOURCE_AMAZON = 'amazon';
const SHOPEE_SITE_CONFIG = {
  my: { label: '马来西亚', origin: 'https://shopee.com.my' },
  ph: { label: '菲律宾', origin: 'https://shopee.ph' },
  th: { label: '泰国', origin: 'https://shopee.co.th' },
};
const MIAOSHOU_EXTENSION_ID = 'ecofkipcicjifkppbgnkaghcfofmpkia';
const COMMON_COLLECT_FETCH_ITEM_PATH = '/open/v1/product/common_collect_box/common_collect_box/fetch_item';
const COMMON_COLLECT_CLAIMED_PATH = '/open/v1/product/common_collect_box/common_collect_box/claimed';
const DEFAULT_COLLECTION_PLATFORM = 'tiktok';
const DEFAULT_CLAIM_RETRY_COUNT = 6;
const DEFAULT_CLAIM_RETRY_DELAY_MS = 5000;
const DEFAULT_CLAIM_INITIAL_DELAY_MS = 30000;
const AMAZON_CLAIM_INITIAL_DELAY_MS = 120000;
const AMAZON_CLAIM_RETRY_COUNT = 24;
const AMAZON_CLAIM_RETRY_DELAY_MS = 15000;
const DEFAULT_FETCH_SERVICE_RETRY_COUNT = 1;
const DEFAULT_FETCH_SERVICE_RETRY_DELAY_MS = 60000;
const DEFAULT_CLAIM_SERVICE_RETRY_COUNT = 1;
const DEFAULT_CLAIM_SERVICE_RETRY_DELAY_MS = 60000;
const DEFAULT_SHOPEE_ACCESS_RECOVERY_TIMEOUT_MS = 600000;
const DEFAULT_SHOPEE_ACCESS_RECOVERY_POLL_MS = 5000;
const DEFAULT_KEYWORDS = [];
const DEFAULT_PREFERRED_TERMS = [];
const DEFAULT_EXCLUDED_TERMS = [];
const SAFE_MODE_HARD_REJECT_TERMS = [
  '防晒霜',
  '防晒喷雾',
  '防晒乳',
  '防晒液',
  '隔离霜',
  '素颜霜',
  '美白',
  '祛斑',
  '淡斑',
  '祛痘',
  '修复疤痕',
  '治疗',
  'spf',
  'pa+++',
  '孕妇',
  '婴儿',
  '宝宝',
  '儿童',
  '大牌同款',
  '香奈儿',
  '迪奥',
  '兰蔻',
  '资生堂',
];
const SAFE_ACCESSORY_TERMS = [
  '防晒帽',
  '遮阳帽',
  '空顶帽',
  '冰袖',
  '袖套',
  '防晒面罩',
  '防晒口罩',
  '遮阳伞',
  '防晒披肩',
  '防晒衣',
  '骑行面罩',
];

const DEFAULT_COLLECT_OPTIONS = {
  source: COLLECT_SOURCE_1688,
  amazonMode: 'keyword',
  amazonMarketplace: 'us',
  amazonMaxPriceUsd: 10000,
  amazonMinRating: 0,
  amazonMinReviewCount: 0,
  amazonLinks: [],
  amazonRawInputs: [],
  shopeeSite: 'my',
  shopeeMaxPrice: 10000,
  shopeeMaxMoq: 3,
  keywords: DEFAULT_KEYWORDS,
  count: 10,
  maxPriceCny: 10,
  preferredTerms: DEFAULT_PREFERRED_TERMS,
  excludedTerms: DEFAULT_EXCLUDED_TERMS,
  minScore: 50,
  safeMode: false,
  skipFilters: false,
  headless: false,
  maxCandidates: 80,
  links: [],
};

function splitTerms(value = '') {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitTerms(item))
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[,，、\n\r\t]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function normalizeNumber(value, fallback, { min = -Infinity, max = Infinity, label = '数字' } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的数字。`);
  }
  return Number(parsed.toFixed(2));
}

function normalizeCollectSource(value = COLLECT_SOURCE_1688) {
  const normalized = String(value || COLLECT_SOURCE_1688).trim().toLowerCase();
  if (normalized === COLLECT_SOURCE_SHOPEE) {
    return COLLECT_SOURCE_SHOPEE;
  }
  if (normalized === COLLECT_SOURCE_AMAZON) {
    return COLLECT_SOURCE_AMAZON;
  }
  return COLLECT_SOURCE_1688;
}

function normalizeAmazonMode(value = '', hasLinks = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'links' || normalized === 'link' || normalized === 'asin') {
    return 'links';
  }
  if (normalized === 'keyword' || normalized === 'keywords' || normalized === 'search') {
    return 'keyword';
  }
  return hasLinks ? 'links' : 'keyword';
}

function normalizeAmazonMarketplace(value = 'us') {
  const normalized = String(value || 'us').trim().toLowerCase();
  return normalized === 'us' ? 'us' : 'us';
}

function normalizeShopeeSite(value = 'my') {
  const normalized = String(value || 'my').trim().toLowerCase();
  return SHOPEE_SITE_CONFIG[normalized] ? normalized : 'my';
}

function normalizeOptions(input = {}) {
  const source = normalizeCollectSource(input.source || input.collectSource);
  const keywords = splitTerms(input.keywords).length > 0
    ? splitTerms(input.keywords)
    : DEFAULT_KEYWORDS;
  const preferredTerms = splitTerms(input.preferredTerms).length > 0
    ? splitTerms(input.preferredTerms)
    : DEFAULT_PREFERRED_TERMS;
  const excludedTerms = splitTerms(input.excludedTerms).length > 0
    ? splitTerms(input.excludedTerms)
    : DEFAULT_EXCLUDED_TERMS;
  const rawLinks = input.links || input.collectLinks;
  const amazonRawInputs = splitAmazonProductInputs(rawLinks);
  const amazonLinks = normalizeAmazonProductInputs(rawLinks);
  const links = source === COLLECT_SOURCE_AMAZON
    ? amazonLinks.map((item) => item.url)
    : normalizeSourceLinks(rawLinks);

  return {
    source,
    amazonMode: normalizeAmazonMode(input.amazonMode || input.collectAmazonMode, amazonLinks.length > 0),
    amazonMarketplace: normalizeAmazonMarketplace(input.amazonMarketplace || input.collectAmazonMarketplace),
    amazonMaxPriceUsd: normalizeNumber(input.amazonMaxPriceUsd || input.collectAmazonMaxPriceUsd, DEFAULT_COLLECT_OPTIONS.amazonMaxPriceUsd, {
      min: 0,
      max: 100000,
      label: 'Amazon 最高展示价',
    }),
    amazonMinRating: normalizeNumber(input.amazonMinRating || input.collectAmazonMinRating, DEFAULT_COLLECT_OPTIONS.amazonMinRating, {
      min: 0,
      max: 5,
      label: 'Amazon 最低评分',
    }),
    amazonMinReviewCount: Math.round(normalizeNumber(input.amazonMinReviewCount || input.collectAmazonMinReviewCount, DEFAULT_COLLECT_OPTIONS.amazonMinReviewCount, {
      min: 0,
      max: 10000000,
      label: 'Amazon 最低评论数',
    })),
    amazonLinks,
    amazonRawInputs,
    shopeeSite: normalizeShopeeSite(input.shopeeSite || input.collectShopeeSite),
    shopeeMaxPrice: normalizeNumber(input.shopeeMaxPrice || input.collectShopeeMaxPrice, DEFAULT_COLLECT_OPTIONS.shopeeMaxPrice, {
      min: 0.01,
      max: 100000,
      label: 'Shopee 最高展示价',
    }),
    shopeeMaxMoq: Math.round(normalizeNumber(input.shopeeMaxMoq || input.collectShopeeMaxMoq, DEFAULT_COLLECT_OPTIONS.shopeeMaxMoq, {
      min: 1,
      max: 1000,
      label: '1688 最大起批量',
    })),
    keywords,
    count: Math.round(normalizeNumber(input.count, DEFAULT_COLLECT_OPTIONS.count, {
      min: 1,
      max: 100,
      label: '采集数量',
    })),
    maxPriceCny: normalizeNumber(input.maxPriceCny, DEFAULT_COLLECT_OPTIONS.maxPriceCny, {
      min: 0.01,
      max: 10000,
      label: '最高采购价',
    }),
    preferredTerms,
    excludedTerms,
    minScore: Math.round(normalizeNumber(input.minScore, DEFAULT_COLLECT_OPTIONS.minScore, {
      min: 0,
      max: 100,
      label: '最低评分',
    })),
    requireKeywordMatch: input.requireKeywordMatch === undefined && input.collectRequireKeywordMatch === undefined
      ? source === COLLECT_SOURCE_1688 && links.length === 0
      : toBoolean(input.requireKeywordMatch ?? input.collectRequireKeywordMatch, true),
    safeMode: toBoolean(input.safeMode, DEFAULT_COLLECT_OPTIONS.safeMode),
    skipFilters: toBoolean(input.skipFilters || input.collectSkipFilters, DEFAULT_COLLECT_OPTIONS.skipFilters),
    headless: toBoolean(input.headless, DEFAULT_COLLECT_OPTIONS.headless),
    maxCandidates: Math.round(normalizeNumber(input.maxCandidates, DEFAULT_COLLECT_OPTIONS.maxCandidates, {
      min: 1,
      max: 1000,
      label: '候选商品数量',
    })),
    links,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const input = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--keywords') {
      input.keywords = next;
      index += 1;
      continue;
    }
    if (arg === '--source' || arg === '--collect-source') {
      input.source = next;
      index += 1;
      continue;
    }
    if (arg === '--amazon-mode' || arg === '--collect-amazon-mode') {
      input.amazonMode = next;
      index += 1;
      continue;
    }
    if (arg === '--amazon-marketplace' || arg === '--collect-amazon-marketplace') {
      input.amazonMarketplace = next;
      index += 1;
      continue;
    }
    if (arg === '--amazon-max-price-usd' || arg === '--collect-amazon-max-price-usd') {
      input.amazonMaxPriceUsd = next;
      index += 1;
      continue;
    }
    if (arg === '--amazon-min-rating' || arg === '--collect-amazon-min-rating') {
      input.amazonMinRating = next;
      index += 1;
      continue;
    }
    if (arg === '--amazon-min-review-count' || arg === '--collect-amazon-min-review-count') {
      input.amazonMinReviewCount = next;
      index += 1;
      continue;
    }
    if (arg === '--shopee-site' || arg === '--collect-shopee-site') {
      input.shopeeSite = next;
      index += 1;
      continue;
    }
    if (arg === '--shopee-max-price' || arg === '--collect-shopee-max-price') {
      input.shopeeMaxPrice = next;
      index += 1;
      continue;
    }
    if (arg === '--shopee-max-moq' || arg === '--collect-shopee-max-moq') {
      input.shopeeMaxMoq = next;
      index += 1;
      continue;
    }
    if (arg === '--count') {
      input.count = next;
      index += 1;
      continue;
    }
    if (arg === '--max-price' || arg === '--max-price-cny') {
      input.maxPriceCny = next;
      index += 1;
      continue;
    }
    if (arg === '--preferred-terms') {
      input.preferredTerms = next;
      index += 1;
      continue;
    }
    if (arg === '--excluded-terms') {
      input.excludedTerms = next;
      index += 1;
      continue;
    }
    if (arg === '--min-score') {
      input.minScore = next;
      index += 1;
      continue;
    }
    if (arg === '--safe-mode') {
      input.safeMode = next;
      index += 1;
      continue;
    }
    if (arg === '--skip-filters' || arg === '--collect-skip-filters') {
      input.skipFilters = next;
      index += 1;
      continue;
    }
    if (arg === '--headless') {
      input.headless = next;
      index += 1;
      continue;
    }
    if (arg === '--max-candidates') {
      input.maxCandidates = next;
      index += 1;
      continue;
    }
    if (arg === '--links' || arg === '--collect-links') {
      input.links = next;
      index += 1;
    }
  }
  return normalizeOptions(input);
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function parsePrice(value) {
  if (value === undefined || value === null || value === '') {
    return NaN;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  const match = String(value).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : NaN;
}

function normalizeCurrencyCny(value) {
  const price = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(price) ? price : null;
}

function roundCurrency(value) {
  return Number(Number(value).toFixed(2));
}

function isSuspiciousProductPriceContext(text = '', start = 0, end = start) {
  const rawText = String(text || '');
  const before = rawText.slice(Math.max(0, start - 32), start);
  const after = rawText.slice(end, Math.min(rawText.length, end + 32));
  const around = `${before}${after}`;

  if (/(?:运费|邮费|快递费|配送费|shipping|freight|postage|delivery)\s*$/i.test(before)) {
    return true;
  }

  return /(已售|销量|成交|库存|评价|评论|好评|加购|浏览|粉丝|关注|起批|起订|起购|件以内|个以内|只以内|支以内|片以内|条以内|盒以内|包以内|瓶以内|套以内)/i
    .test(around)
    && !/(价格|现货价|批发价|限时价|新人价|拿货价|采购价|finalPrice|offerPrice|discountPrice|referencePrice|salePrice|unitPrice)/i.test(around);
}

function extractProductUnitPriceFromText(text = '') {
  const rawText = String(text || '').replace(/,/g, '');
  const rangePatterns = [
    /(?:¥|￥)\s*(\d+(?:\.\d+)?)\s*(?:-|~|－|—|–|至|到)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)/gi,
    /"priceRange"\s*:\s*"?(\d+(?:\.\d+)?)\s*(?:-|~|－|—|–|至|到)\s*(\d+(?:\.\d+)?)"?/gi,
  ];

  for (const pattern of rangePatterns) {
    let match = pattern.exec(rawText);
    while (match) {
      const prices = [normalizeCurrencyCny(match[1]), normalizeCurrencyCny(match[2])]
        .filter((price) => price !== null && price >= 0.01 && price <= 100000);
      if (prices.length > 0 && !isSuspiciousProductPriceContext(rawText, match.index, match.index + match[0].length)) {
        return Math.min(...prices);
      }
      match = pattern.exec(rawText);
    }
  }

  const patterns = [
    /(?:价格|现货价|现货价格|批发价|限时价|新人价|拿货价|采购价)[^¥￥0-9]{0,20}(?:¥|￥)?\s*(\d+(?:\.\d+)?)/gi,
    /"(?:finalPrice|offerPrice|discountPrice|referencePrice|salePrice|unitPrice|price)"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi,
    /(?:¥|￥)\s*(\d+(?:\.\d+)?)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(rawText);
    while (match) {
      const price = normalizeCurrencyCny(match[1]);
      const matchEnd = match.index + match[0].length;
      if (
        price !== null
        && price >= 0.01
        && price <= 100000
        && !isSuspiciousProductPriceContext(rawText, match.index, matchEnd)
      ) {
        return price;
      }
      match = pattern.exec(rawText);
    }
  }

  return null;
}

function extractFreightPriceFromText(text = '') {
  const rawText = String(text || '').replace(/,/g, '');
  if (/(包邮|免运费|免邮|free\s*shipping|shipping\s*free)/i.test(rawText)) {
    return 0;
  }

  const patterns = [
    /"(?:postFee|freight|shippingFee|deliveryFee)"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi,
    /(?:运费|邮费|快递费|配送费|shipping|freight|postage|delivery)[^¥￥0-9]{0,12}(?:¥|￥)?\s*(\d+(?:\.\d+)?)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(rawText);
    while (match) {
      const freight = normalizeCurrencyCny(match[1]);
      const around = rawText.slice(Math.max(0, match.index - 18), match.index + match[0].length + 18);
      if (
        freight !== null
        && freight >= 0
        && freight <= 30
        && !/(运费模板|邮费模板|快递模板|配送模板|起批|起订|起购)/i.test(around)
      ) {
        return freight;
      }
      match = pattern.exec(rawText);
    }
  }

  return null;
}

function buildPurchasePriceWithFreight(unitPrice, freightPrice = null) {
  const unit = Number(unitPrice);
  if (!Number.isFinite(unit)) {
    return null;
  }
  const freight = Number(freightPrice);
  return roundCurrency(unit + (Number.isFinite(freight) ? freight : 0));
}

function formatWeightText(weightGrams) {
  const grams = Number(weightGrams);
  if (!Number.isFinite(grams) || grams <= 0) {
    return '';
  }
  return `${Number(grams.toFixed(1)).toString()}g`;
}

function parseWeightFromText(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:重量|单件重量|商品重量|包装重量|净重)\s*(?:\(?\s*g\s*\)?|（\s*g\s*）)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克)?/i,
    /(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克)\s*(?:重量|单件重量|商品重量|包装重量|净重)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    const unit = String(match[2] || '').toLowerCase();
    const weightGrams = /kg|千克|公斤/.test(unit) ? numeric * 1000 : numeric;
    return {
      weightGrams: Number(weightGrams.toFixed(1)),
      weightText: formatWeightText(weightGrams),
    };
  }

  return {
    weightGrams: null,
    weightText: '',
  };
}

function parseMinOrderQuantityFromText(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const patterns = [
    /起(?:批|订|售)(?:量)?\s*[:：]?\s*(\d{1,5})\s*(?:件|个|只|套|双|条|支|瓶)?/i,
    /(\d{1,5})\s*(?:件|个|只|套|双|条|支|瓶)\s*起(?:批|订|售)?/i,
    /最小起订量\s*[:：]?\s*(\d{1,5})/i,
    /MOQ\s*[:：]?\s*(\d{1,5})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function includesAny(text, terms = []) {
  const normalized = normalizeText(text);
  return terms.find((term) => normalized.includes(normalizeText(term)));
}

function compactKeywordText(value = '') {
  return normalizeText(value).replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

function buildKeywordMatchTerms(keyword = '') {
  const compactKeyword = compactKeywordText(keyword);
  if (!compactKeyword || compactKeyword === '详情链接') {
    return [];
  }
  const chineseOnly = compactKeyword.replace(/[^\u4e00-\u9fff]/g, '');
  if (chineseOnly && chineseOnly.length === compactKeyword.length) {
    if (chineseOnly.length <= 2) {
      return [chineseOnly];
    }
    if (chineseOnly.length === 3) {
      return [chineseOnly.slice(0, 2), chineseOnly.slice(2)];
    }
    return [chineseOnly.slice(0, 2), chineseOnly.slice(-2)];
  }
  return normalizeText(keyword)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((term) => compactKeywordText(term))
    .filter((term) => term.length >= 2 || /[\u4e00-\u9fff]/.test(term));
}

function isKeywordRelevantCandidate(candidate = {}, keyword = '') {
  const compactKeyword = compactKeywordText(keyword || candidate.keyword);
  if (!compactKeyword || compactKeyword === '详情链接') {
    return true;
  }
  const haystack = compactKeywordText([
    candidate.title,
    candidate.shopName,
    candidate.description,
    candidate.sourceText,
  ].filter(Boolean).join(' '));
  if (!haystack) {
    return false;
  }
  if (haystack.includes(compactKeyword)) {
    return true;
  }
  const terms = buildKeywordMatchTerms(keyword || candidate.keyword);
  return terms.length === 0 || terms.every((term) => haystack.includes(term));
}

function doesTextMatchKeyword(text = '', keyword = '') {
  const compactKeyword = compactKeywordText(keyword);
  if (!compactKeyword || compactKeyword === '详情链接') {
    return true;
  }
  const haystack = compactKeywordText(text);
  if (!haystack) {
    return false;
  }
  if (haystack.includes(compactKeyword)) {
    return true;
  }
  const terms = buildKeywordMatchTerms(keyword);
  return terms.length === 0 || terms.every((term) => haystack.includes(term));
}

function isLikely1688SearchSnapshot(snapshot = {}) {
  const url = String(snapshot.url || '');
  const bodyText = String(snapshot.bodyText || '');
  return /s\.1688\.com|offer_search|selloffer/i.test(url)
    || (
      Number(snapshot.offerLikeCount || 0) > 0
      && /(综合|销量|价格|起订量|找货源|所在地区|商家特色|经营模式|已售)/.test(bodyText)
    );
}

async function get1688SearchPageSnapshot(page) {
  return page.evaluate(() => {
    const searchInput = document.querySelector([
      'input[name="keywords"]',
      'input[name="keyword"]',
      'input[placeholder*="搜索"]',
      'input[placeholder*="请输入"]',
      'input[type="search"]',
      'input[type="text"]',
      'textarea',
    ].join(', '));
    return {
      url: window.location.href,
      title: document.title || '',
      inputValue: searchInput ? String(searchInput.value || searchInput.getAttribute('value') || '') : '',
      bodyText: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 1800) : '',
      offerLikeCount: document.querySelectorAll('[data-renderkey], [data-offer-id], [data-offerid], a[href*="/offer/"], img[alt]').length,
    };
  }).catch(() => ({
    url: page.url(),
    title: '',
    inputValue: '',
    bodyText: '',
    offerLikeCount: 0,
  }));
}

async function isKeywordSearchResultPage(page, keyword = '') {
  if (!page || page.isClosed()) {
    return false;
  }
  const snapshot = await get1688SearchPageSnapshot(page);
  return isLikely1688SearchSnapshot(snapshot)
    && doesTextMatchKeyword(`${snapshot.url} ${snapshot.title} ${snapshot.inputValue} ${snapshot.bodyText}`, keyword);
}

async function findKeywordSearchResultPage(browser, keyword = '', preferredPages = []) {
  const pages = [
    ...preferredPages,
    ...((await browser.pages().catch(() => [])) || []),
  ];
  const seen = new Set();
  for (const page of pages.filter(Boolean).reverse()) {
    if (seen.has(page)) {
      continue;
    }
    seen.add(page);
    if (await isKeywordSearchResultPage(page, keyword)) {
      return page;
    }
  }
  return null;
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeShopeeProductUrl(rawUrl = '') {
  if (!String(rawUrl || '').trim()) {
    return '';
  }
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!['shopee.com.my', 'shopee.ph', 'shopee.co.th'].includes(hostname)) {
      return '';
    }
    if (!/(?:-i\.\d+\.\d+|\/product\/\d+\/\d+)/i.test(url.pathname)) {
      return '';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function normalizeCollectableSourceUrl(rawUrl = '') {
  const normalized1688 = resolveSearchOfferUrl({ rawUrl, metadataText: rawUrl });
  if (normalized1688 && /^https?:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(normalized1688)) {
    return normalized1688;
  }
  return normalizeShopeeProductUrl(rawUrl);
}

function normalizeSourceLinks(value = []) {
  const rawLinks = Array.isArray(value)
    ? value.flatMap((item) => normalizeSourceLinks(item))
    : String(value || '')
      .split(/[\s,，、]+/)
      .map((item) => item.trim())
      .filter(Boolean);

  return unique(rawLinks
    .map((item) => normalizeCollectableSourceUrl(item))
    .filter(Boolean));
}

function scoreCandidate(candidate = {}, options = DEFAULT_COLLECT_OPTIONS) {
  const title = normalizeText(candidate.title);
  const shopName = normalizeText(candidate.shopName);
  const price = parsePrice(candidate.price);
  const preferredHit = includesAny(title, options.preferredTerms);
  const accessoryHit = includesAny(title, SAFE_ACCESSORY_TERMS);

  let demandFit = title.includes('防晒') || preferredHit ? 16 : 8;
  if (preferredHit) {
    demandFit = 20;
  }

  let contentFit = accessoryHit ? 18 : 10;
  if (/帽|面罩|口罩|冰袖|袖套|伞|披肩/.test(title)) {
    contentFit = 20;
  }

  let marginLogistics = 10;
  if (Number.isFinite(price)) {
    if (price <= options.maxPriceCny * 0.75) {
      marginLogistics = 20;
    } else if (price <= options.maxPriceCny) {
      marginLogistics = 17;
    }
  }

  let supplierQuality = shopName ? 14 : 10;
  if (/工厂|厂家|源头|义乌|户外|用品/.test(`${title} ${shopName}`)) {
    supplierQuality = 18;
  }

  let differentiation = 12;
  if (/可折叠|便携|加大|透气|冰感|骑行|户外|防紫外线/.test(title)) {
    differentiation = 18;
  }
  if (preferredHit && accessoryHit) {
    differentiation = Math.max(differentiation, 17);
  }

  return Math.min(100, demandFit + contentFit + marginLogistics + supplierQuality + differentiation);
}

function evaluateCandidate(candidate = {}, rawOptions = DEFAULT_COLLECT_OPTIONS) {
  const options = normalizeOptions(rawOptions);
  const title = String(candidate.title || '').trim();
  const haystack = `${title} ${candidate.shopName || ''} ${candidate.description || ''}`;
  if (!title) {
    return { decision: 'reject', score: 0, reason: '缺少商品标题。' };
  }

  const price = parsePrice(candidate.price);
  if (!Number.isFinite(price)) {
    return { decision: 'reject', score: 0, reason: '价格无法识别，先跳过。' };
  }
  if (price > options.maxPriceCny) {
    return { decision: 'reject', score: 0, reason: `价格 ${price} 元超过最高采购价 ${options.maxPriceCny} 元。` };
  }

  const customExcludedHit = includesAny(haystack, options.excludedTerms);
  if (customExcludedHit) {
    return { decision: 'reject', score: 0, reason: `命中排除词：${customExcludedHit}` };
  }

  const keyword = String(candidate.keyword || '').trim();
  if (options.requireKeywordMatch !== false && keyword && !isKeywordRelevantCandidate(candidate, keyword)) {
    return { decision: 'reject', score: 0, reason: `与当前关键词“${keyword}”不匹配。` };
  }

  if (options.safeMode) {
    const safeRejectHit = includesAny(haystack, SAFE_MODE_HARD_REJECT_TERMS);
    if (safeRejectHit) {
      return { decision: 'reject', score: 0, reason: `安全模式拦截高风险词：${safeRejectHit}` };
    }
  }

  const score = scoreCandidate({ ...candidate, price }, options);
  if (score < options.minScore) {
    return { decision: 'skip', score, reason: `评分 ${score} 低于最低评分 ${options.minScore}。` };
  }

  return {
    decision: 'collect',
    score,
    reason: `评分 ${score}，适合采集。`,
  };
}

function emitProgress(event = {}) {
  if (String(process.env.MIAOSHOU_PROGRESS || '') !== '1') {
    return;
  }
  process.stderr.write(`MIAOSHOU_PROGRESS ${JSON.stringify(event)}\n`);
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadMiaoshouConfig() {
  return require('./key.js');
}

function generateMiaoshouSign(appSecret, apiPath, timestamp, appKey, bodyJson = '') {
  const message = appSecret + apiPath + timestamp + appKey + bodyJson + appSecret;
  return crypto.createHmac('sha256', appSecret).update(message).digest('hex');
}

function buildMiaoshouUrl(apiPath, baseUrl) {
  return new URL(apiPath, baseUrl).toString();
}

async function parseMiaoshouJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    throw new Error(`妙手接口返回非 JSON 内容：${preview || response.statusText}`);
  }
}

async function requestMiaoshouApi(apiPath, { method = 'POST', body } = {}) {
  const { APP_ID, APP_SECRET, MS_URL } = loadMiaoshouConfig();
  const bodyJson = body === undefined ? '' : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(buildMiaoshouUrl(apiPath, MS_URL), {
    method,
    headers: {
      'x-app-key': APP_ID,
      'x-timestamp': String(timestamp),
      'x-sign': generateMiaoshouSign(APP_SECRET, apiPath, timestamp, APP_ID, bodyJson),
      'Content-Type': 'application/json',
    },
    ...(bodyJson ? { body: bodyJson } : {}),
  });
  const data = await parseMiaoshouJsonResponse(response);
  if (!response.ok) {
    throw new Error(`妙手接口 HTTP ${response.status}：${data && data.message ? data.message : response.statusText}`);
  }
  if (data && data.code && data.code !== 'success') {
    throw new Error(`妙手接口失败 ${data.code}：${data.message || '无错误信息'}`);
  }
  if (data && data.result === 'fail') {
    throw new Error(`妙手接口失败：${data.message || data.code || '无错误信息'}`);
  }
  return data;
}

function extractCommonCollectBoxDetailIds(fetchResult = {}) {
  const mapping = fetchResult
    && fetchResult.data
    && fetchResult.data.sourceItemIdAndDetailIdMap
    ? fetchResult.data.sourceItemIdAndDetailIdMap
    : {};
  return unique(Object.values(mapping)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0));
}

function buildClaimCommonCollectBoxBody(commonCollectBoxDetailIds = [], platform = DEFAULT_COLLECTION_PLATFORM) {
  return {
    detailSerialNumberPlatformList: commonCollectBoxDetailIds.map((detailId) => ({
      detailId,
      platform,
      serialNumber: 1,
    })),
  };
}

function isPendingMiaoshouCollectionError(error) {
  return /存在未采集成功的产品|未采集成功|采集中|正在采集/.test(String(error && error.message ? error.message : error));
}

function isMiaoshouServiceUnavailableError(error) {
  const message = String(error && error.message ? error.message : error);
  return /HTTP\s*(502|503|504)\b|502\s+Bad Gateway|503\s+Service Unavailable|504\s+Gateway Timeout|Bad Gateway|Service Unavailable|Gateway Timeout|nginx/i.test(message);
}

async function requestMiaoshouApiWithServiceRetry(apiPath, requestOptions, {
  request = requestMiaoshouApi,
  retryCount = 0,
  retryDelayMs = DEFAULT_FETCH_SERVICE_RETRY_DELAY_MS,
  label = '妙手接口',
  sleepFn = sleep,
} = {}) {
  let attempts = 0;

  while (true) {
    try {
      return await request(apiPath, requestOptions);
    } catch (error) {
      if (!isMiaoshouServiceUnavailableError(error) || attempts >= retryCount) {
        throw error;
      }
      attempts += 1;
      log(`${label} 暂时 502/网关异常，${Math.round(retryDelayMs / 1000)} 秒后低频重试（${attempts}/${retryCount}）。`);
      await sleepFn(retryDelayMs);
    }
  }
}

async function claimCommonCollectBoxDetailsWithRetry(commonCollectBoxDetailIds, {
  platform = DEFAULT_COLLECTION_PLATFORM,
  request = requestMiaoshouApi,
  retryCount = DEFAULT_CLAIM_RETRY_COUNT,
  retryDelayMs = DEFAULT_CLAIM_RETRY_DELAY_MS,
  serviceRetryCount = 0,
  serviceRetryDelayMs = DEFAULT_CLAIM_SERVICE_RETRY_DELAY_MS,
  sleepFn = sleep,
} = {}) {
  const body = buildClaimCommonCollectBoxBody(commonCollectBoxDetailIds, platform);
  let lastError = null;
  let pendingAttempts = 0;
  let serviceAttempts = 0;

  while (true) {
    try {
      return await request(COMMON_COLLECT_CLAIMED_PATH, {
        method: 'POST',
        body,
      });
    } catch (error) {
      lastError = error;

      if (isPendingMiaoshouCollectionError(error) && pendingAttempts < retryCount) {
        pendingAttempts += 1;
        log(`妙手公共采集箱仍在处理货源，${Math.round(retryDelayMs / 1000)} 秒后重试认领（${pendingAttempts}/${retryCount}）。`);
        await sleepFn(retryDelayMs);
        continue;
      }

      if (isMiaoshouServiceUnavailableError(error) && serviceAttempts < serviceRetryCount) {
        serviceAttempts += 1;
        log(`妙手认领接口暂时 502/网关异常，${Math.round(serviceRetryDelayMs / 1000)} 秒后低频重试认领（${serviceAttempts}/${serviceRetryCount}）。`);
        await sleepFn(serviceRetryDelayMs);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function collectSourceLinksWithMiaoshouApi(sourceLinks = [], {
  source = COLLECT_SOURCE_1688,
  platform = DEFAULT_COLLECTION_PLATFORM,
  request = requestMiaoshouApi,
  fetchServiceRetryCount = 0,
  fetchServiceRetryDelayMs = DEFAULT_FETCH_SERVICE_RETRY_DELAY_MS,
  claimInitialDelayMs = 0,
  claimRetryCount = DEFAULT_CLAIM_RETRY_COUNT,
  claimRetryDelayMs = DEFAULT_CLAIM_RETRY_DELAY_MS,
  claimServiceRetryCount = 0,
  claimServiceRetryDelayMs = DEFAULT_CLAIM_SERVICE_RETRY_DELAY_MS,
  sleepFn = sleep,
} = {}) {
  const collectSource = normalizeCollectSource(source);
  const collectLinks = collectSource === COLLECT_SOURCE_AMAZON
    ? normalizeAmazonProductInputs(sourceLinks).map((item) => item.url)
    : normalizeSourceLinks(sourceLinks);
  if (collectLinks.length === 0) {
    throw new Error('没有可采集的货源链接。');
  }
  if (collectLinks.length > 50) {
    throw new Error('通过货源链接采集货源接口单次最多支持 50 个链接。');
  }

  let fetchResult = null;
  try {
    fetchResult = await requestMiaoshouApiWithServiceRetry(COMMON_COLLECT_FETCH_ITEM_PATH, {
      method: 'POST',
      body: { collectLinks },
    }, {
      request,
      retryCount: fetchServiceRetryCount,
      retryDelayMs: fetchServiceRetryDelayMs,
      label: '妙手公共采集接口',
      sleepFn,
    });
  } catch (error) {
    if (isMiaoshouServiceUnavailableError(error)) {
      const wrapped = new Error(`妙手公共采集接口暂时不可用，未生成公共采集箱 ID。稍后可重试本商品。原始错误：${error.message || String(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
  const commonCollectBoxDetailIds = extractCommonCollectBoxDetailIds(fetchResult);
  if (commonCollectBoxDetailIds.length === 0) {
    throw new Error('妙手没有返回公共采集箱 ID，无法继续认领到 TikTok 采集箱。');
  }

  if (claimInitialDelayMs > 0) {
    const sourceHint = collectSource === COLLECT_SOURCE_AMAZON ? 'Amazon 货源通常处理较慢，' : '';
    log(`公共采集箱已生成：${commonCollectBoxDetailIds.join(', ')}，${sourceHint}等待 ${Math.round(claimInitialDelayMs / 1000)} 秒后认领到 ${platform} 采集箱。`);
    await sleepFn(claimInitialDelayMs);
  }

  let claimResult = null;
  try {
    claimResult = await claimCommonCollectBoxDetailsWithRetry(commonCollectBoxDetailIds, {
      platform,
      request,
      retryCount: claimRetryCount,
      retryDelayMs: claimRetryDelayMs,
      serviceRetryCount: claimServiceRetryCount,
      serviceRetryDelayMs: claimServiceRetryDelayMs,
      sleepFn,
    });
  } catch (error) {
    if (isMiaoshouServiceUnavailableError(error)) {
      const wrapped = new Error(`妙手认领接口暂时不可用，公共采集箱 ID 已生成：${commonCollectBoxDetailIds.join(', ')}。稍后可重试认领。原始错误：${error.message || String(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
    if (collectSource === COLLECT_SOURCE_AMAZON && isPendingMiaoshouCollectionError(error)) {
      const totalWaitSeconds = Math.round((claimInitialDelayMs + claimRetryCount * claimRetryDelayMs) / 1000);
      const wrapped = new Error(`Amazon 货源已进入妙手公共采集箱（ID：${commonCollectBoxDetailIds.join(', ')}），但妙手在约 ${totalWaitSeconds} 秒内仍未处理完成，暂时还不能认领到 TikTok 采集箱。原始错误：${error.message || String(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }

  return {
    status: 'success',
    message: `已通过妙手开放接口采集并认领到 ${platform} 采集箱。`,
    collectLinks,
    fetchResult,
    claimResult,
    commonCollectBoxDetailIds,
    platformCollectBoxDetailIdMap: claimResult
      && claimResult.data
      && claimResult.data.platformCollectBoxDetailIdMap
      ? claimResult.data.platformCollectBoxDetailIdMap
      : {},
  };
}

function buildCollectLinkRetryOptions(source = COLLECT_SOURCE_1688) {
  const collectSource = normalizeCollectSource(source);
  const amazonSource = collectSource === COLLECT_SOURCE_AMAZON;
  return {
    source: collectSource,
    fetchServiceRetryCount: DEFAULT_FETCH_SERVICE_RETRY_COUNT,
    fetchServiceRetryDelayMs: DEFAULT_FETCH_SERVICE_RETRY_DELAY_MS,
    claimInitialDelayMs: amazonSource ? AMAZON_CLAIM_INITIAL_DELAY_MS : DEFAULT_CLAIM_INITIAL_DELAY_MS,
    claimRetryCount: amazonSource ? AMAZON_CLAIM_RETRY_COUNT : DEFAULT_CLAIM_RETRY_COUNT,
    claimRetryDelayMs: amazonSource ? AMAZON_CLAIM_RETRY_DELAY_MS : DEFAULT_CLAIM_RETRY_DELAY_MS,
    claimServiceRetryCount: DEFAULT_CLAIM_SERVICE_RETRY_COUNT,
    claimServiceRetryDelayMs: DEFAULT_CLAIM_SERVICE_RETRY_DELAY_MS,
  };
}

function getChromeExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    fromEnv,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : '',
    `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    localAppData ? `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe` : '',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('没有找到可用的 Chrome。请确认已安装 Chrome 或 Edge。');
  }
  return found;
}

function compareVersionText(left = '', right = '') {
  const leftParts = String(left || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function readExtensionManifest(extensionDir = '') {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function collectExtensionCandidatesFromRoot(rootDir = '') {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return [];
  }

  const candidates = [];
  const profileDirs = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name));

  for (const profileDir of profileDirs) {
    for (const containerName of ['UnpackedExtensions', 'Extensions']) {
      const containerDir = path.join(profileDir, containerName);
      if (!fs.existsSync(containerDir)) {
        continue;
      }
      const extensionDirs = fs.readdirSync(containerDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          const extensionDir = path.join(containerDir, entry.name);
          const directManifest = readExtensionManifest(extensionDir);
          if (directManifest) {
            return [extensionDir];
          }
          return fs.readdirSync(extensionDir, { withFileTypes: true })
            .filter((versionEntry) => versionEntry.isDirectory())
            .map((versionEntry) => path.join(extensionDir, versionEntry.name));
        });

      for (const extensionDir of extensionDirs) {
        const manifest = readExtensionManifest(extensionDir);
        const manifestName = String(manifest && manifest.name ? manifest.name : '');
        if (!/跨境ERP|妙手|ERP助手|kuajing/i.test(`${manifestName} ${extensionDir}`)) {
          continue;
        }
        const stats = fs.statSync(extensionDir);
        candidates.push({
          path: extensionDir,
          version: String(manifest.version || ''),
          mtimeMs: stats.mtimeMs,
        });
      }
    }
  }

  return candidates;
}

function getMiaoshouExtensionPath() {
  const configuredPath = process.env.MIAOSHOU_ERP_EXTENSION_PATH || process.env.KUAJING_ERP_EXTENSION_PATH;
  if (configuredPath) {
    const manifest = readExtensionManifest(configuredPath);
    if (!manifest) {
      throw new Error(`妙手/跨境ERP 插件路径无效：${configuredPath}`);
    }
    return configuredPath;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const home = process.env.HOME || '';
  const roots = [
    home ? path.join(home, 'Library/Application Support/Google/Chrome') : '',
    home ? path.join(home, 'Library/Application Support/Google/Chrome Beta') : '',
    localAppData ? path.join(localAppData, 'Google/Chrome/User Data') : '',
    localAppData ? path.join(localAppData, 'Microsoft/Edge/User Data') : '',
  ].filter(Boolean);
  const candidates = roots.flatMap(collectExtensionCandidatesFromRoot);
  if (candidates.length === 0) {
    return '';
  }

  candidates.sort((left, right) => (
    compareVersionText(right.version, left.version)
    || right.mtimeMs - left.mtimeMs
  ));
  return candidates[0].path;
}

function profileDirFromExtensionPath(extensionPath = '') {
  const parts = String(extensionPath || '').split(path.sep);
  const markerIndex = parts.findIndex((part) => part === 'UnpackedExtensions' || part === 'Extensions');
  if (markerIndex <= 0) {
    return '';
  }
  return parts.slice(0, markerIndex).join(path.sep) || path.sep;
}

function copyDirectoryIfExists(sourceDir = '', targetDir = '') {
  if (!sourceDir || !targetDir || !fs.existsSync(sourceDir)) {
    return false;
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter: (source) => !/[\\/](LOCK|SingletonCookie|SingletonLock|SingletonSocket)$/.test(source),
  });
  return true;
}

function syncMiaoshouExtensionState(extensionPath = '', targetUserDataDir = getProfileDir()) {
  const sourceProfileDir = profileDirFromExtensionPath(extensionPath);
  const targetProfileDir = path.join(targetUserDataDir, 'Default');
  if (!sourceProfileDir || !targetProfileDir || path.resolve(sourceProfileDir) === path.resolve(targetProfileDir)) {
    return [];
  }

  const copied = [];
  const relativeDirs = [
    path.join('Local Extension Settings', MIAOSHOU_EXTENSION_ID),
    path.join('Sync Extension Settings', MIAOSHOU_EXTENSION_ID),
    path.join('IndexedDB', 'https_erp.91miaoshou.com_0.indexeddb.leveldb'),
  ];

  for (const relativeDir of relativeDirs) {
    const sourceDir = path.join(sourceProfileDir, relativeDir);
    const targetDir = path.join(targetProfileDir, relativeDir);
    if (copyDirectoryIfExists(sourceDir, targetDir)) {
      copied.push(relativeDir);
    }
  }
  return copied;
}

function safeProfileName(value = '') {
  return String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function getProfileDir() {
  const accountKey = process.env.MIAOSHOU_ACCOUNT_ID || process.env.MIAOSHOU_ACCOUNT_LABEL || 'default';
  return path.join(__dirname, '.miaoshou-browser', safeProfileName(accountKey));
}

async function maximizeBrowserWindow(page) {
  const session = await page.target().createCDPSession().catch(() => null);
  if (!session) {
    return;
  }
  try {
    const windowInfo = await session.send('Browser.getWindowForTarget').catch(() => null);
    const windowId = windowInfo && windowInfo.windowId;
    if (!Number.isFinite(windowId)) {
      return;
    }
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    }).catch(async () => {
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: 0,
          top: 0,
          width: DEFAULT_BROWSER_WINDOW_WIDTH,
          height: DEFAULT_BROWSER_WINDOW_HEIGHT,
        },
      }).catch(() => {});
    });
  } finally {
    await session.detach().catch(() => {});
  }
}

async function getBrowserWindowBounds(page) {
  if (!page || page.isClosed()) {
    return null;
  }

  const session = await page.target().createCDPSession().catch(() => null);
  if (!session) {
    return null;
  }

  try {
    const windowInfo = await session.send('Browser.getWindowForTarget').catch(() => null);
    const windowId = windowInfo && windowInfo.windowId;
    if (!Number.isFinite(windowId)) {
      return null;
    }
    return await session.send('Browser.getWindowBounds', { windowId }).catch(() => null);
  } finally {
    await session.detach().catch(() => {});
  }
}

async function ensureLargeBrowserViewport(page) {
  if (!page || page.isClosed()) {
    return;
  }

  await maximizeBrowserWindow(page);
  await sleep(300);

  const windowBounds = await getBrowserWindowBounds(page);
  const currentViewport = await page.evaluate(() => ({
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  })).catch(() => null);
  const viewportWidth = Math.max(
    DEFAULT_BROWSER_WINDOW_WIDTH,
    Math.floor(Number(windowBounds && windowBounds.width) || 0),
    Math.floor(Number(currentViewport && currentViewport.width) || 0),
  );
  const viewportHeight = Math.max(
    DEFAULT_BROWSER_WINDOW_HEIGHT,
    Math.floor(Number(currentViewport && currentViewport.height) || 0),
    Math.floor((Number(windowBounds && windowBounds.height) || 0) - 120),
  );

  await page.setViewport({
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
  }).catch(() => {});
}

function encode1688Keyword(value = '') {
  const bytes = iconv.encode(String(value || ''), 'gbk');
  return Array.from(bytes, (byte) => {
    const char = String.fromCharCode(byte);
    if (/^[A-Za-z0-9_.~-]$/.test(char)) {
      return char;
    }
    return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

function buildSearchUrl(keyword) {
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encode1688Keyword(keyword)}`;
}

function offerDetailUrl(offerId) {
  const id = String(offerId || '').match(/\d{6,}/)?.[0] || '';
  return id ? `https://detail.1688.com/offer/${id}.html` : '';
}

function extractOfferIdFromText(value = '') {
  const text = String(value || '');
  const patterns = [
    /\/offer\/(\d{6,})(?:\.html)?/i,
    /[?&]offerId=(\d{6,})/i,
    /[?&]offerIds=(\d{6,})/i,
    /object_id@(\d{6,})/i,
    /(?:offerId|offer_id|offer-id|data-offer-id|data-offerid|data-offer)@(\d{6,})/i,
    /(?:offerId|offer_id|offer-id|data-offer-id|data-offerid|data-offer)\s*[:=]\s*["']?(\d{6,})/i,
    /["'](?:offerId|offer_id|offer-id|data-offer-id|data-offerid|data-offer)["']\s*:\s*["']?(\d{6,})/i,
    /object[_-]?id\s*[:=@]\s*["']?(\d{6,})/i,
    /data-renderkey\s*=\s*["']?[^|\s"'<>]*_(\d{6,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return '';
}

function resolveSearchOfferUrl({ rawUrl = '', metadataText = '' } = {}) {
  const sourceText = `${rawUrl} ${metadataText}`;
  const offerId = extractOfferIdFromText(sourceText);
  if (offerId) {
    return offerDetailUrl(offerId);
  }
  return normalizeOfferUrl(rawUrl);
}

function isDetailOfferUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    return url.hostname.endsWith('.1688.com')
      && url.hostname.includes('detail')
      && /\/offer\/\d{6,}(?:\.html)?/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function parseSearchCardPrice(value) {
  const text = String(value || '').replace(/,/g, '');
  const normalizedCurrencyText = text
    .replace(/([¥￥])\s*(\d+)\s*\.\s*(\d{1,2})/g, '$1$2.$3');
  const currencyPattern = /[¥￥]\s*(\d+(?:\.\d+)?)/gi;
  let currencyMatch = currencyPattern.exec(normalizedCurrencyText);
  while (currencyMatch) {
    const price = normalizeCurrencyCny(currencyMatch[1]);
    const matchEnd = currencyMatch.index + currencyMatch[0].length;
    if (
      price !== null
      && price >= 0.01
      && price <= 100000
      && !isSuspiciousProductPriceContext(normalizedCurrencyText, currencyMatch.index, matchEnd)
    ) {
      return price;
    }
    currencyMatch = currencyPattern.exec(normalizedCurrencyText);
  }

  const productPrice = extractProductUnitPriceFromText(normalizedCurrencyText);
  if (productPrice !== null) {
    return productPrice;
  }

  const compactText = normalizedCurrencyText.replace(/\s+/g, ' ').trim();
  if (/^[¥￥]?\s*\d+(?:\.\d{1,2})?\s*(?:元|起)?$/i.test(compactText)) {
    return parsePrice(compactText);
  }
  return NaN;
}

function isLikelySearchNoiseLine(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return true;
  }
  if (/^[¥￥]?\s*\d+(?:\.\d+)?$/.test(text) || /^\.\d{1,2}$/.test(text)) {
    return true;
  }
  if (/^(新品|严选|包邮|综合|销量|价格|起订量|所在地区|商家特色|经营模式)$/.test(text)) {
    return true;
  }
  if (/(限时价|新人价|首单|已售|全网|回头率|退货包运费|先采后付|实力商家|源头商家|品类店铺|TOP\d|点击|登录|搜索)/i.test(text)) {
    return true;
  }
  return false;
}

function isLikelyShopNameLine(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return /(有限公司|有限责任公司|贸易公司|电子商务公司|商行|店铺|专营店|旗舰店|工厂|厂)$/.test(text);
}

function normalizeDetailTitleCandidate(value = '') {
  let title = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/【[^】]*】/g, '')
    .trim();
  if (!title) {
    return '';
  }

  title = title
    .replace(/\s*[-_|｜—–]\s*(阿里巴巴|1688|批发|供应商|厂家直销|货源).*$/i, '')
    .trim();

  const parts = title
    .split(/[_＿]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length > 1) {
    title = parts.find((part) => !isLikelyShopNameLine(part) && !isLikelySearchNoiseLine(part)) || parts[0];
  }

  return title.replace(/\s+/g, ' ').trim();
}

function scoreDetailTitleCandidate(value = '') {
  const title = normalizeDetailTitleCandidate(value);
  if (!title || /^https?:\/\//i.test(title) || isLikelySearchNoiseLine(title)) {
    return -Infinity;
  }
  if (isLikelyShopNameLine(title)) {
    return -Infinity;
  }

  let score = 0;
  if (/[\u4e00-\u9fff]/.test(title)) {
    score += 20;
  }
  if (title.length >= 6 && title.length <= 90) {
    score += 20;
  }
  if (/防晒|遮阳|空顶帽|冰袖|袖套|面罩|口罩|帽|伞|披肩|化妆|美妆|护肤|收纳|洗脸巾/.test(title)) {
    score += 45;
  }
  if (/[¥￥]\s*\d/.test(title)) {
    score -= 30;
  }
  if (/(有限公司|有限责任公司|商行|工厂|旗舰店|专营店)/.test(title)) {
    score -= 50;
  }
  return score;
}

function selectDetailProductTitle({ candidates = [], fallbackTitle = '' } = {}) {
  const normalizedCandidates = [
    ...[].concat(candidates || []),
    fallbackTitle,
  ]
    .map(normalizeDetailTitleCandidate)
    .filter(Boolean);

  const best = normalizedCandidates
    .map((title, index) => ({ title, index, score: scoreDetailTitleCandidate(title) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0];

  return best ? best.title : normalizeDetailTitleCandidate(fallbackTitle);
}

function extractSearchCandidateTitle({ title = '', sourceText = '', keyword = '' } = {}) {
  const rawTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const lines = String(sourceText || '')
    .split(/\n+| {2,}/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && line.length >= 4 && !isLikelySearchNoiseLine(line));

  if (
    rawTitle
    && rawTitle.length >= 4
    && !isLikelySearchNoiseLine(rawTitle)
    && !isLikelyShopNameLine(rawTitle)
  ) {
    return rawTitle;
  }

  if (lines.length === 0) {
    return rawTitle;
  }
  const normalizedKeyword = normalizeText(keyword);
  const keywordHit = normalizedKeyword
    ? lines.find((line) => normalizeText(line).includes(normalizedKeyword))
    : '';
  if (keywordHit) {
    return keywordHit;
  }

  return lines.find((line) => /防晒|遮阳|空顶帽|冰袖|袖套|面罩|口罩|帽|伞|披肩/.test(line))
    || lines.find((line) => !isLikelyShopNameLine(line))
    || lines[0];
}

function normalizeSearchCandidateRecords(records = [], keyword = '', rawOptions = DEFAULT_COLLECT_OPTIONS) {
  const options = normalizeOptions(rawOptions);
  const seen = new Set();
  return records
    .map((item) => {
      const sourceText = String(item.sourceText || '');
      const metadataText = String(item.metadataText || '');
      const rawUrl = String(item.rawUrl || '');
      const title = extractSearchCandidateTitle({
        title: item.title,
        sourceText,
        keyword,
      });
      return {
        ...item,
        title,
        keyword,
        url: resolveSearchOfferUrl({
          rawUrl,
          metadataText: `${metadataText} ${sourceText}`,
        }),
        price: parseSearchCardPrice(item.priceText || sourceText),
      };
    })
    .filter((item) => {
      if (!item.title || !isDetailOfferUrl(item.url) || seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    })
    .slice(0, options.maxCandidates);
}

async function findVisibleElement(page, selectors = []) {
  for (const selector of selectors) {
    const handles = await page.$$(selector).catch(() => []);
    for (const handle of handles) {
      const box = await handle.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        return handle;
      }
    }
  }
  return null;
}

async function searchKeywordFromHome(browser, page, keyword) {
  log(`打开 1688 首页，在首页搜索框输入关键词：${keyword}`);
  await page.goto(DEFAULT_1688_HOME_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
  await sleep(1800);

  const input = await findVisibleElement(page, [
    'input[name="keywords"]',
    'input[name="keyword"]',
    'input[placeholder*="搜索"]',
    'input[placeholder*="请输入"]',
    'input[type="search"]',
    'input[type="text"]',
    'textarea',
  ]);
  if (!input) {
    throw new Error('没有找到 1688 首页搜索框。');
  }

  await input.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await sleep(200);
  await input.type(keyword, { delay: 80 });
  await sleep(300);
  const openerTarget = page.target();
  const existingTargets = new Set(browser.targets());
  const newTabPromise = browser.waitForTarget((target) => {
    if (target.type() !== 'page') {
      return false;
    }
    if (existingTargets.has(target)) {
      return false;
    }
    const opener = typeof target.opener === 'function' ? target.opener() : null;
    if (opener && opener === openerTarget) {
      return true;
    }
    return /1688\.com|about:blank/i.test(String(target.url() || ''));
  }, { timeout: 8000 })
    .then((target) => target.page())
    .catch(() => null);
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => null);
  await page.keyboard.press('Enter');
  const openedPage = await Promise.race([
    newTabPromise,
    navigation.then(() => null),
    sleep(5000).then(() => null),
  ]);
  await navigation;
  await sleep(1500);
  const searchPage = await findKeywordSearchResultPage(browser, keyword, [openedPage, page]);
  if (searchPage && searchPage !== page) {
    await searchPage.bringToFront().catch(() => {});
    await ensureLargeBrowserViewport(searchPage);
    log(`1688 搜索结果已切换到新标签页：${searchPage.url()}`);
    return searchPage;
  }
  return page;
}

function normalizeOfferUrl(rawUrl = '') {
  if (!String(rawUrl || '').trim()) {
    return '';
  }
  try {
    const url = new URL(rawUrl, 'https://detail.1688.com');
    if (!/1688\.com$/.test(url.hostname) && !url.hostname.endsWith('.1688.com')) {
      return '';
    }
    return url.toString();
  } catch (error) {
    return '';
  }
}

async function extractSearchCandidates(page, keyword, options) {
  await page.waitForSelector('.search-offer-wrapper, [data-renderkey], [data-offer-id], [data-offerid], a[href*="/offer/"], img[alt]', { timeout: DEFAULT_TIMEOUT }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 2200))).catch(() => {});
  await sleep(800);

  const records = await page.evaluate(() => {
    const attrsText = (element) => {
      if (!element || !element.attributes) {
        return '';
      }
      return Array.from(element.attributes)
        .map((attr) => `${attr.name}=${attr.value}`)
        .join(' | ');
    };
    const textLines = (element) => String(element && element.innerText ? element.innerText : '')
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const attrValue = (element, names = []) => {
      if (!element) {
        return '';
      }
      for (const name of names) {
        const value = element.getAttribute(name);
        if (value) {
          return value;
        }
      }
      return '';
    };

    const findCard = (element) => {
      let current = element;
      for (let depth = 0; current && depth < 7; depth += 1) {
        const text = current.innerText || '';
        const meta = `${current.className || ''} ${attrsText(current)}`;
        if (
          /offer|item|card|gallery|search|data-renderkey|data-offer/i.test(meta)
          || /[¥￥]|已售|回头率|退货包运费|限时价|新人价/.test(text)
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return element.closest('[class*="offer"], [class*="item"], [class*="card"], li, div') || element;
    };

    const collectMetadata = (card, source) => {
      const attributedChildren = Array.from(card.querySelectorAll('a, img, [data-renderkey], [data-offer-id], [data-offerid], [data-offer], [data-aplus-report], [data-click], [data-log]')).slice(0, 20);
      return [
        attrsText(card),
        attrsText(source),
        ...attributedChildren.map(attrsText),
      ].join(' | ');
    };

    const collectRawUrl = (card, source) => {
      const link = source.closest && source.closest('a[href]');
      const links = Array.from(card.querySelectorAll('a[href]'));
      return (
        (source.href || '')
        || (link && link.href)
        || attrValue(source, ['href', 'data-href', 'data-url', 'data-pc-url', 'data-detail-url', 'data-offer-url'])
        || (links[0] && links[0].href)
        || attrValue(card, ['href', 'data-href', 'data-url', 'data-pc-url', 'data-detail-url', 'data-offer-url'])
        || ''
      );
    };

    const collectTitle = (card, source) => {
      const links = Array.from(card.querySelectorAll('a'));
      const lines = textLines(card);
      const images = Array.from(card.querySelectorAll('img[alt]'));
      return (
        (source.innerText || source.textContent || source.getAttribute('title') || source.getAttribute('alt') || '')
        || (links.find((link) => link.innerText || link.getAttribute('title'))?.innerText || '')
        || (links.find((link) => link.getAttribute('title'))?.getAttribute('title') || '')
        || (images.find((image) => image.getAttribute('alt'))?.getAttribute('alt') || '')
        || lines[0]
        || ''
      ).replace(/\s+/g, ' ').trim();
    };

    const makeCandidate = (source) => {
      const card = findCard(source);
      const lines = textLines(card);
      return {
        title: collectTitle(card, source),
        rawUrl: collectRawUrl(card, source),
        metadataText: collectMetadata(card, source),
        sourceText: lines.join('\n'),
      };
    };

    const cardElements = Array.from(document.querySelectorAll([
      '.search-offer-wrapper',
      '[data-renderkey]',
      '[data-offer-id]',
      '[data-offerid]',
      '[data-offer]',
      '[class*="offer"]',
      '[class*="item"]',
      '[class*="card"]',
    ].join(', ')));
    const cardCandidates = cardElements.map(makeCandidate);

    const clickTargets = Array.from(document.querySelectorAll([
      'a[href*="/offer/"]',
      'a[href*="offerId="]',
      'a[href*="offerIds="]',
      'img[alt]',
      '[title]',
      '[data-aplus-report*="object_id"]',
      '[data-click*="offer"]',
      '[data-log*="offer"]',
    ].join(', ')));
    const targetCandidates = clickTargets.map(makeCandidate);

    return [...cardCandidates, ...targetCandidates];
  });

  const candidates = normalizeSearchCandidateRecords(records, keyword, options);
  if (candidates.length === 0) {
    const diagnostics = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      bodyPreview: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 180) : '',
      offerLikeCount: document.querySelectorAll('[data-renderkey], [data-offer-id], [data-offerid], a[href*="/offer/"], img[alt]').length,
    })).catch(() => null);
    if (diagnostics) {
      log(`搜索页诊断：原始节点 ${records.length} 个，含商品线索节点 ${diagnostics.offerLikeCount} 个，页面标题 ${diagnostics.title}，预览 ${diagnostics.bodyPreview}`);
    }
  }
  return candidates;
}

function shopeeSiteConfig(site = 'my') {
  return SHOPEE_SITE_CONFIG[normalizeShopeeSite(site)] || SHOPEE_SITE_CONFIG.my;
}

function buildShopeeSearchUrl(keyword, site = 'my') {
  const config = shopeeSiteConfig(site);
  return `${config.origin}/search?keyword=${encodeURIComponent(String(keyword || '').trim())}`;
}

function extractShopeePriceFromText(value = '') {
  const text = String(value || '').replace(/,/g, '').replace(/\s+/g, ' ');
  const ranges = Array.from(text.matchAll(/(?:RM|₱|฿)\s*(\d+(?:\.\d+)?)(?:\s*-\s*(?:RM|₱|฿)?\s*(\d+(?:\.\d+)?))?/gi));
  if (ranges.length === 0) {
    return null;
  }
  const prices = ranges
    .flatMap((match) => [match[1], match[2]])
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function normalizeShopeeCandidateRecords(records = [], keyword = '', options = DEFAULT_COLLECT_OPTIONS) {
  const seen = new Set();
  return records
    .map((item) => ({
      ...item,
      source: COLLECT_SOURCE_SHOPEE,
      keyword,
      title: String(item.title || '').replace(/\s+/g, ' ').trim(),
      url: normalizeShopeeProductUrl(item.rawUrl || item.url || ''),
      imageUrl: String(item.imageUrl || '').trim(),
      price: extractShopeePriceFromText(`${item.priceText || ''} ${item.sourceText || ''}`),
      sourceText: String(item.sourceText || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => {
      if (!item.url || !item.title || seen.has(item.url)) {
        return false;
      }
      if (!/^https?:\/\//i.test(item.imageUrl)) {
        return false;
      }
      if (Number.isFinite(Number(item.price)) && Number(item.price) > options.shopeeMaxPrice) {
        return false;
      }
      seen.add(item.url);
      return true;
    })
    .slice(0, options.maxCandidates);
}

function detectShopeeAccessBlock({ url = '', title = '', bodyText = '' } = {}) {
  const combined = `${url} ${title} ${bodyText}`.replace(/\s+/g, ' ');
  if (
    /\/buyer\/login|\/user\/account\/login|\/login/i.test(String(url || ''))
    || (/Log In|登录/i.test(combined) && /Password|密码|OTP|verification code|验证码|Forgot Password/i.test(combined))
  ) {
    return 'Shopee 登录还未完成；请在自动化 Chrome 窗口完成登录后等待程序继续。';
  }
  if (
    /\/verify\/traffic\/error/i.test(String(url || ''))
    || /Looks like you.?re not logged in yet/i.test(combined)
    || /Page Unavailable/i.test(combined)
    || /Log InBack to Home Page/i.test(combined)
  ) {
    return 'Shopee 要求登录或流量验证；请在自动化 Chrome 窗口登录 Shopee 后重试。';
  }
  if (/unusual traffic|traffic verification|verify.*traffic|captcha/i.test(combined)) {
    return 'Shopee 触发了流量验证；请在自动化 Chrome 窗口完成验证后重试。';
  }
  return '';
}

async function assertShopeeSearchAccessible(page) {
  const snapshot = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title || '',
    bodyText: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200) : '',
  })).catch(() => ({
    url: page.url(),
    title: '',
    bodyText: '',
  }));
  const reason = detectShopeeAccessBlock(snapshot);
  if (reason) {
    log(`Shopee 搜索页不可用：${reason}`);
    throw new Error(reason);
  }
}

async function getShopeeAccessBlockReason(page) {
  const snapshot = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title || '',
    bodyText: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200) : '',
  })).catch(() => ({
    url: page.url(),
    title: '',
    bodyText: '',
  }));
  return detectShopeeAccessBlock(snapshot);
}

async function hasShopeeSearchCandidates(page) {
  return page.evaluate(() => (
    document.querySelectorAll('a[href*="-i."], a[href*="/product/"]').length > 0
  )).catch(() => false);
}

async function waitForShopeeAccessRecovery(page, searchUrl, initialReason, {
  timeoutMs = DEFAULT_SHOPEE_ACCESS_RECOVERY_TIMEOUT_MS,
  pollMs = DEFAULT_SHOPEE_ACCESS_RECOVERY_POLL_MS,
} = {}) {
  log(`${initialReason} 等待你在打开的 Shopee 窗口完成登录或验证，最多等待 ${Math.round(timeoutMs / 1000)} 秒。`);
  const start = Date.now();
  let lastSearchRetryAt = 0;

  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    const currentReason = await getShopeeAccessBlockReason(page);
    if (currentReason) {
      continue;
    }

    if (await hasShopeeSearchCandidates(page)) {
      return;
    }

    if (Date.now() - lastSearchRetryAt >= 30000) {
      lastSearchRetryAt = Date.now();
      log('重新打开 Shopee 搜索页，检查登录/验证是否已恢复。');
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => null);
      await sleep(2500);
      if (!(await getShopeeAccessBlockReason(page)) && await hasShopeeSearchCandidates(page)) {
        return;
      }
    }
  }

  throw new Error(`${initialReason} 等待登录或验证后仍未恢复。`);
}

async function ensureShopeeSearchAccessible(page, searchUrl) {
  const reason = await getShopeeAccessBlockReason(page);
  if (!reason) {
    return;
  }
  await waitForShopeeAccessRecovery(page, searchUrl, reason);
  await assertShopeeSearchAccessible(page);
}

async function searchShopeeKeyword(page, keyword, options) {
  const config = shopeeSiteConfig(options.shopeeSite);
  const url = buildShopeeSearchUrl(keyword, options.shopeeSite);
  log(`打开 Shopee ${config.label}站，搜索关键词：${keyword}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
  await sleep(3500);
  await ensureShopeeSearchAccessible(page, url);
  await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 2400))).catch(() => {});
  await sleep(1200);
  await assertShopeeSearchAccessible(page);
}

async function extractShopeeCandidates(page, keyword, options) {
  const records = await page.evaluate(() => {
    const textLines = (element) => String(element && element.innerText ? element.innerText : '')
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const titleFromCard = (card) => {
      const imageAlt = Array.from(card.querySelectorAll('img[alt]'))
        .map((image) => image.getAttribute('alt'))
        .find(Boolean);
      const longLine = textLines(card)
        .find((line) => line.length >= 8 && !/^(RM|₱|฿|\d|已售|sold|评价|rating)/i.test(line));
      return imageAlt || longLine || '';
    };
    const imageFromCard = (card) => {
      const image = Array.from(card.querySelectorAll('img'))
        .find((item) => item.currentSrc || item.src || item.getAttribute('src'));
      return image ? (image.currentSrc || image.src || image.getAttribute('src') || '') : '';
    };
    const findCard = (link) => {
      let current = link;
      for (let depth = 0; current && depth < 8; depth += 1) {
        const text = current.innerText || '';
        if (/[RM₱฿]\s*\d|sold|已售|rating|评价/i.test(text)) {
          return current;
        }
        current = current.parentElement;
      }
      return link.closest('li, div') || link;
    };

    return Array.from(document.querySelectorAll('a[href*="-i."], a[href*="/product/"]'))
      .map((link) => {
        const card = findCard(link);
        const sourceText = textLines(card).join('\n');
        return {
          title: titleFromCard(card),
          rawUrl: link.href,
          imageUrl: imageFromCard(card),
          priceText: sourceText,
          sourceText,
        };
      });
  }).catch(() => []);

  const candidates = normalizeShopeeCandidateRecords(records, keyword, options);
  log(`Shopee 关键词 ${keyword} 找到候选商品 ${candidates.length} 个。`);
  return candidates;
}

async function downloadImageToTempFile(imageUrl, prefix = 'shopee-main') {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`下载 Shopee 主图失败：HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const extension = /png/i.test(contentType) ? '.png' : (/webp/i.test(contentType) ? '.webp' : '.jpg');
  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = path.join(os.tmpdir(), 'miaoshou-shopee-images');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function find1688ImageUploadInput(page) {
  let input = await page.$('input[type="file"]').catch(() => null);
  if (input) {
    return input;
  }
  await clickTextLike(page, [/以图搜款/, /图片搜索/, /找同款/, /搜同款/]).catch(() => false);
  await sleep(800);
  input = await page.$('input[type="file"]').catch(() => null);
  return input;
}

async function search1688ByImage(page, shopeeCandidate, imagePath, options) {
  log(`使用 Shopee 主图去 1688 以图搜款：${shopeeCandidate.title}`);
  await page.goto(DEFAULT_1688_HOME_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
  await sleep(1800);
  const uploadInput = await find1688ImageUploadInput(page);
  if (!uploadInput) {
    throw new Error('没有找到 1688 以图搜款上传入口。');
  }
  await uploadInput.uploadFile(imagePath);
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => null),
    sleep(4500),
  ]);
  await sleep(1500);
  const candidates = await extractSearchCandidates(page, shopeeCandidate.title || shopeeCandidate.keyword || '', options);
  log(`1688 以图搜款找到候选货源 ${candidates.length} 个。`);
  return candidates;
}

function shopeeRiskRejectReason(candidate = {}, options = DEFAULT_COLLECT_OPTIONS) {
  const text = `${candidate.title || ''} ${candidate.sourceText || ''}`;
  const excludedHit = includesAny(text, options.excludedTerms);
  if (excludedHit) {
    return `命中排除词：${excludedHit}`;
  }
  if (options.safeMode) {
    const safeReject = includesAny(text, SAFE_MODE_HARD_REJECT_TERMS);
    if (safeReject) {
      return `安全模式拦截：${safeReject}`;
    }
  }
  return '';
}

async function findMatching1688SourceForShopee(browser, imageSearchPage, shopeeCandidate, options) {
  let imagePath = '';
  try {
    imagePath = await downloadImageToTempFile(shopeeCandidate.imageUrl);
    const candidates = await search1688ByImage(imageSearchPage, shopeeCandidate, imagePath, options);
    for (const candidate of candidates.slice(0, 12)) {
      const quickDecision = evaluateCandidate(candidate, options);
      if (quickDecision.decision === 'reject') {
        log(`跳过 1688 图搜候选：${candidate.title}；${quickDecision.reason}`);
        continue;
      }

      const detailPage = await browser.newPage();
      detailPage.setDefaultTimeout(DEFAULT_TIMEOUT);
      detailPage.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
      try {
        await ensureLargeBrowserViewport(detailPage);
        await detailPage.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
        const detailCandidate = await extractDetailCandidate(detailPage, candidate);
        const detailDecision = evaluateCandidate(detailCandidate, options);
        if (detailDecision.decision !== 'collect') {
          log(`跳过 1688 同款候选：${detailCandidate.title}；${detailDecision.reason}`);
          continue;
        }
        if (
          detailCandidate.minOrderQuantity !== null
          && detailCandidate.minOrderQuantity > options.shopeeMaxMoq
        ) {
          log(`跳过 1688 同款候选：${detailCandidate.title}；起批量 ${detailCandidate.minOrderQuantity} 超过 ${options.shopeeMaxMoq}。`);
          continue;
        }
        return {
          source: detailCandidate,
          score: detailDecision.score,
          reason: detailDecision.reason,
        };
      } finally {
        await detailPage.close().catch(() => {});
      }
    }
    return null;
  } finally {
    if (imagePath) {
      fs.unlink(imagePath, () => {});
    }
  }
}

async function extractDetailCandidate(page, fallback = {}) {
  const detail = await page.evaluate(() => {
    const text = document.body ? document.body.innerText.replace(/\s+/g, ' ') : '';
    const metaContent = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
    const textOf = (selector) => Array.from(document.querySelectorAll(selector))
      .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const titleCandidates = [
      metaContent('meta[property="og:title"]'),
      metaContent('meta[name="title"]'),
      metaContent('meta[itemprop="name"]'),
      ...textOf('h1'),
      ...textOf('[class*="product-title"], [class*="offer-title"], [class*="detail-title"], [class*="mod-detail-title"]'),
      document.title || '',
    ].filter(Boolean);
    const priceText = [
      ...textOf('[class*="price"], [class*="Price"], [class*="freight"], [class*="Freight"], [class*="shipping"], [class*="Shipping"]'),
      text.match(/[¥￥]\s*\d+(?:\.\d+)?/)?.[0] || '',
    ].filter(Boolean).join(' ');
    const shopName = (
      document.querySelector('[class*="shop"]')?.innerText
      || document.querySelector('[class*="company"]')?.innerText
      || ''
    ).replace(/\s+/g, ' ').trim();
    return {
      titleCandidates,
      priceText,
      shopName,
      description: text.slice(0, 4000),
    };
  });
  const weight = parseWeightFromText(detail.description);
  const title = selectDetailProductTitle({
    candidates: detail.titleCandidates,
    fallbackTitle: fallback.title,
  });
  const unitPrice = extractProductUnitPriceFromText(`${detail.priceText} ${detail.description}`);
  const fallbackPrice = parsePrice(fallback.price);
  const resolvedUnitPrice = unitPrice !== null
    ? unitPrice
    : (Number.isFinite(fallbackPrice) ? fallbackPrice : null);
  const freightPrice = extractFreightPriceFromText(detail.description);
  const purchasePrice = buildPurchasePriceWithFreight(resolvedUnitPrice, freightPrice);
  const minOrderQuantity = parseMinOrderQuantityFromText(detail.description);

  return {
    ...fallback,
    title: title || fallback.title,
    price: purchasePrice !== null ? purchasePrice : fallback.price,
    unitPrice: resolvedUnitPrice,
    freightPrice,
    minOrderQuantity,
    weightGrams: weight.weightGrams,
    weightText: weight.weightText,
    shopName: detail.shopName || fallback.shopName,
    description: detail.description,
    url: page.url(),
  };
}

async function clickTextLike(page, patterns = []) {
  const clickInContext = (frame) => frame.evaluate((patternSources) => {
    const patternsInPage = patternSources.map((source) => new RegExp(source, 'i'));
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const collectElements = (root) => {
      const elements = Array.from(root.querySelectorAll('button, a, div, span, p, li'));
      const shadowElements = Array.from(root.querySelectorAll('*'))
        .filter((element) => element.shadowRoot)
        .flatMap((element) => collectElements(element.shadowRoot));
      return [...elements, ...shadowElements];
    };
    const elements = collectElements(document);
    const matched = elements.find((element) => {
      const text = String(element.innerText || element.textContent || '').trim();
      return text && isVisible(element) && patternsInPage.some((pattern) => pattern.test(text));
    });
    if (!matched) {
      return false;
    }
    matched.click();
    return true;
  }, patterns.map((pattern) => pattern.source));

  if (await clickInContext(page.mainFrame()).catch(() => false)) {
    return true;
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    if (await clickInContext(frame).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function getPageVisibleText(page) {
  const textInContext = (frame) => frame.evaluate(() => {
    const collectText = (root) => {
      const parts = [];
      if (root.body && root.body.innerText) {
        parts.push(root.body.innerText);
      } else if (root.host && root.textContent) {
        parts.push(root.textContent);
      }
      const allElements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const element of allElements) {
        if (element.shadowRoot) {
          parts.push(collectText(element.shadowRoot));
        }
      }
      return parts.join(' ');
    };
    return collectText(document).replace(/\s+/g, ' ');
  });

  const parts = [];
  for (const frame of page.frames()) {
    const text = await textInContext(frame).catch(() => '');
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(' ');
}

async function getCollectionEntryDiagnostics(page) {
  const visibleText = await getPageVisibleText(page).catch(() => '');
  const frameUrls = page.frames()
    .map((frame) => frame.url())
    .filter(Boolean);
  const nativeHits = [
    /跨境铺货/.test(visibleText) ? '跨境铺货' : '',
    /立即铺货/.test(visibleText) ? '立即铺货' : '',
    /加铺货单/.test(visibleText) ? '加铺货单' : '',
    /妙手分销/.test(visibleText) ? '妙手分销' : '',
  ].filter(Boolean);

  return {
    hasMiaoshouCollectButton: /采集此商品|采集商品/.test(visibleText),
    hasMiaoshouPanel: /跨境ERP|妙手ERP/.test(visibleText),
    nativeHits,
    frameCount: frameUrls.length,
    extensionFrameCount: frameUrls.filter((url) => /^chrome-extension:\/\//.test(url)).length,
  };
}

function formatCollectionEntryDiagnostics(diagnostics = {}) {
  const parts = [];
  parts.push(diagnostics.hasMiaoshouPanel ? '已看到妙手/跨境ERP浮窗' : '未看到妙手/跨境ERP浮窗');
  parts.push(diagnostics.hasMiaoshouCollectButton ? '已看到采集按钮' : '未看到采集按钮');
  if (Array.isArray(diagnostics.nativeHits) && diagnostics.nativeHits.length > 0) {
    parts.push(`1688原生入口：${diagnostics.nativeHits.join('、')}`);
  } else {
    parts.push('未看到1688原生跨境铺货入口');
  }
  parts.push(`页面框架 ${diagnostics.frameCount || 0} 个，插件框架 ${diagnostics.extensionFrameCount || 0} 个`);
  return parts.join('；');
}

async function collectCurrentDetailPage(page) {
  let clicked = await clickTextLike(page, [/采集此商品/, /采集商品/]);
  if (!clicked) {
    const expanded = await clickTextLike(page, [/跨境ERP/, /妙手ERP/]);
    if (expanded) {
      await sleep(800);
      clicked = await clickTextLike(page, [/采集此商品/, /采集商品/]);
    }
  }
  if (!clicked) {
    const diagnostics = await getCollectionEntryDiagnostics(page);
    const diagnosticText = formatCollectionEntryDiagnostics(diagnostics);
    log(`采集入口诊断：${diagnosticText}`);
    return {
      status: 'failed',
      message: `没有找到妙手采集按钮（${diagnosticText}）。`,
      diagnostics,
    };
  }

  await sleep(1500);
  const resultText = await getPageVisibleText(page);
  if (/重复|已采集|已经采集/.test(resultText)) {
    return { status: 'duplicate', message: '插件提示商品可能已采集。' };
  }
  if (/采集成功|成功采集|已加入采集箱|采集箱/.test(resultText)) {
    return { status: 'success', message: '插件提示采集成功。' };
  }
  return { status: 'success', message: '已点击采集按钮，请在妙手采集箱复核。' };
}

function compactCollectionItem(item = {}) {
  return {
    title: item.title || '',
    url: item.url || '',
    asin: item.asin || '',
    amazonUrl: item.amazonUrl || '',
    shopeeTitle: item.shopeeTitle || '',
    shopeeUrl: item.shopeeUrl || '',
    source1688Title: item.source1688Title || '',
    source1688Url: item.source1688Url || '',
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    priceUsd: Number.isFinite(Number(item.priceUsd)) ? Number(item.priceUsd) : null,
    rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : null,
    reviewCount: Number.isFinite(Number(item.reviewCount)) ? Number(item.reviewCount) : null,
    unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : null,
    freightPrice: Number.isFinite(Number(item.freightPrice)) ? Number(item.freightPrice) : null,
    minOrderQuantity: Number.isFinite(Number(item.minOrderQuantity)) ? Number(item.minOrderQuantity) : null,
    weightGrams: item.weightGrams || null,
    weightText: item.weightText || '',
    keyword: item.keyword || '',
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    reason: item.reason || '',
    error: item.error || '',
    pluginMessage: item.pluginMessage || '',
    apiMessage: item.apiMessage || '',
    commonCollectBoxDetailId: item.commonCollectBoxDetailId || null,
    stage: item.stage || '',
  };
}

function filterRecentlyCollectedCandidates(candidates = [], source = COLLECT_SOURCE_1688) {
  const { accepted, duplicates } = filterRecentCollectionDuplicates(candidates, {
    source,
    windowDays: DEFAULT_DEDUPE_WINDOW_DAYS,
  });
  for (const duplicate of duplicates) {
    const label = duplicate.title || duplicate.asin || duplicate.url || duplicate.dedupeKey || '未知商品';
    log(`跳过最近 7 天已采集商品：${label}；${duplicate.reason}`);
  }
  return { accepted, duplicates };
}

function rememberCollectedItems(items = [], source = COLLECT_SOURCE_1688) {
  const records = markCollectedItems(items, {
    source,
    windowDays: DEFAULT_DEDUPE_WINDOW_DAYS,
  });
  if (records.length > 0) {
    log(`已记录 ${records.length} 个成功采集商品，最近 ${DEFAULT_DEDUPE_WINDOW_DAYS} 天再次采集会自动跳过。`);
  }
  return records;
}

async function runShopeeCollection(options) {
  const config = shopeeSiteConfig(options.shopeeSite);
  log(`采集方式：Shopee ${config.label}站自动选品，使用主图到 1688 找同款，合格后通过妙手开放 API 采集 Shopee 链接。`);

  const profileDir = getProfileDir();
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: options.headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });

  const collected = [];
  const skipped = [];
  const failed = [];
  const duplicates = [];
  let reviewedCount = 0;

  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
    await ensureLargeBrowserViewport(page);

    for (const keyword of options.keywords) {
      if (collected.length >= options.count || reviewedCount >= options.maxCandidates) {
        break;
      }
      emitProgress({
        phase: 'collect',
        completed: collected.length,
        total: options.count,
        totalCount: options.count,
        overallPercent: Math.round((collected.length / options.count) * 100),
        detailId: `Shopee ${keyword}`,
      });

      await searchShopeeKeyword(page, keyword, options);
      const shopeeDedupe = filterRecentlyCollectedCandidates(
        await extractShopeeCandidates(page, keyword, options),
        COLLECT_SOURCE_SHOPEE,
      );
      duplicates.push(...shopeeDedupe.duplicates);
      const shopeeCandidates = shopeeDedupe.accepted;

      for (const shopeeCandidate of shopeeCandidates) {
        if (collected.length >= options.count || reviewedCount >= options.maxCandidates) {
          break;
        }
        reviewedCount += 1;

        const riskReason = shopeeRiskRejectReason(shopeeCandidate, options);
        if (riskReason) {
          skipped.push({ ...shopeeCandidate, reason: riskReason });
          log(`跳过 Shopee 候选：${shopeeCandidate.title}；${riskReason}`);
          continue;
        }

        emitProgress({
          phase: 'collect',
          completed: collected.length,
          total: options.count,
          totalCount: options.count,
          overallPercent: Math.round((collected.length / options.count) * 100),
          detailId: shopeeCandidate.title,
        });

        try {
          const matched = await findMatching1688SourceForShopee(browser, page, shopeeCandidate, options);
          if (!matched) {
            skipped.push({
              ...shopeeCandidate,
              reason: '1688 没有找到符合价格/起批量/风险规则的同款货源',
            });
            log(`跳过 Shopee 候选：${shopeeCandidate.title}；1688 没有合格同款。`);
            continue;
          }

          const collectResult = await collectSourceLinksWithMiaoshouApi([shopeeCandidate.url], {
            fetchServiceRetryCount: 0,
            claimInitialDelayMs: DEFAULT_CLAIM_INITIAL_DELAY_MS,
            claimServiceRetryCount: 0,
          });
          const resultItem = {
            title: shopeeCandidate.title,
            url: shopeeCandidate.url,
            shopeeTitle: shopeeCandidate.title,
            shopeeUrl: shopeeCandidate.url,
            source1688Title: matched.source.title,
            source1688Url: matched.source.url,
            price: parsePrice(matched.source.price),
            unitPrice: Number.isFinite(Number(matched.source.unitPrice)) ? Number(matched.source.unitPrice) : null,
            freightPrice: Number.isFinite(Number(matched.source.freightPrice)) ? Number(matched.source.freightPrice) : null,
            minOrderQuantity: matched.source.minOrderQuantity,
            weightGrams: matched.source.weightGrams,
            weightText: matched.source.weightText,
            score: matched.score,
            reason: `Shopee 商品已匹配 1688 同款：${matched.reason}`,
            keyword,
            pluginMessage: collectResult.message,
            apiMessage: collectResult.message,
            commonCollectBoxDetailId: collectResult.commonCollectBoxDetailIds[0] || null,
            platformCollectBoxDetailIdMap: collectResult.platformCollectBoxDetailIdMap,
          };
          collected.push(resultItem);
          rememberCollectedItems([resultItem], COLLECT_SOURCE_SHOPEE);
          log(`采集成功：${shopeeCandidate.title}；1688 同款 ${matched.source.title}。`);
          emitProgress({
            phase: 'collect',
            completed: collected.length,
            total: options.count,
            totalCount: options.count,
            overallPercent: Math.round((collected.length / options.count) * 100),
            detailId: shopeeCandidate.title,
          });
        } catch (error) {
          if (isMiaoshouServiceUnavailableError(error)) {
            log(`妙手服务异常，停止本次采集：${error.message || String(error)}`);
            throw error;
          }
          failed.push({
            title: shopeeCandidate.title,
            url: shopeeCandidate.url,
            shopeeTitle: shopeeCandidate.title,
            shopeeUrl: shopeeCandidate.url,
            price: shopeeCandidate.price,
            keyword,
            error: error.message || String(error),
          });
          log(`Shopee 商品采集异常：${shopeeCandidate.title}；${error.message || String(error)}`);
        }
      }
    }

    const failedResults = failed.map((item) => ({
      title: item.title,
      url: item.url,
      shopeeTitle: item.shopeeTitle || item.title,
      shopeeUrl: item.shopeeUrl || item.url,
      price: item.price,
      keyword: item.keyword,
      error: item.error || '采集失败',
      stage: 'collect',
    }));

    return {
      mode: 'shopee-collection',
      requestedCount: options.count,
      totalCount: collected.length + duplicates.length + failed.length,
      successCount: collected.length,
      errorCount: failed.length,
      skippedCount: skipped.length,
      duplicateCount: duplicates.length,
      params: {
        source: options.source,
        shopeeSite: options.shopeeSite,
        shopeeMaxPrice: options.shopeeMaxPrice,
        shopeeMaxMoq: options.shopeeMaxMoq,
        keywords: options.keywords,
        maxPriceCny: options.maxPriceCny,
        minScore: options.minScore,
        safeMode: options.safeMode,
      },
      results: [
        ...collected.map(compactCollectionItem),
        ...failedResults.map(compactCollectionItem),
      ],
      duplicates: duplicates.map(compactCollectionItem),
      skipped: skipped.slice(0, 50).map(compactCollectionItem),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function buildAmazonLinkCandidates(options = {}) {
  const skipped = [];
  const validInputs = new Set((options.amazonLinks || []).map((item) => item.input));
  const validAsins = new Set((options.amazonLinks || []).map((item) => item.asin));

  for (const input of options.amazonRawInputs || []) {
    const normalized = normalizeAmazonProductInputs([input])[0];
    if (!normalized) {
      skipped.push({
        source: COLLECT_SOURCE_AMAZON,
        marketplace: 'US',
        title: input,
        url: '',
        reason: 'invalid_amazon_link_or_asin',
      });
      continue;
    }
    if (!validInputs.has(input) && validAsins.has(normalized.asin)) {
      skipped.push({
        source: COLLECT_SOURCE_AMAZON,
        marketplace: 'US',
        asin: normalized.asin,
        title: input,
        url: normalized.url,
        reason: 'duplicate_asin',
      });
    }
  }

  const candidates = (options.amazonLinks || []).map((item) => ({
    source: COLLECT_SOURCE_AMAZON,
    marketplace: 'US',
    asin: item.asin,
    title: item.asin,
    url: item.url,
    amazonUrl: item.url,
    priceUsd: null,
    rating: null,
    reviewCount: null,
    keyword: 'Amazon link/ASIN',
    reason: 'Amazon link/ASIN input',
  }));

  return { candidates, skipped };
}

async function resolveAmazonCandidates(options) {
  if (options.amazonMode === 'links' || options.amazonLinks.length > 0) {
    return {
      ...buildAmazonLinkCandidates(options),
      reviewedCount: options.amazonRawInputs.length,
    };
  }

  if (options.keywords.length === 0) {
    throw new Error('Amazon 关键词采集需要先填写关键词，或切换为链接/ASIN 模式。');
  }

  const profileDir = getProfileDir();
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: options.headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });

  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
    await ensureLargeBrowserViewport(page);
    const result = await collectAmazonCandidatesFromKeywords(page, options);
    return {
      candidates: result.candidates,
      skipped: result.skipped,
      reviewedCount: result.reviewedCount,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function enrichAmazonCandidatesWithDetails(candidates = [], options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const profileDir = getProfileDir();
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: options.headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });

  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
    await ensureLargeBrowserViewport(page);

    const enriched = [];
    for (const candidate of candidates) {
      try {
        const detail = await extractAmazonProductDetail(page, candidate, options);
        enriched.push(detail);
        if (detail.title && detail.title !== candidate.asin) {
          log(`Amazon 详情已补全：${detail.asin || candidate.asin}；${detail.title}${detail.weightText ? `；重量 ${detail.weightText}` : ''}`);
        }
      } catch (error) {
        enriched.push(candidate);
        log(`Amazon 详情补全失败：${candidate.asin || candidate.url}；${error.message || String(error)}`);
      }
      await sleep(600);
    }
    return enriched;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runAmazonCollection(options) {
  log('采集方式：Amazon.com 浏览器自动化采集，合格商品通过妙手开放 API 采集并认领到 TikTok 采集箱。');
  const collected = [];
  const failed = [];
  const duplicates = [];
  const detailCandidateLimit = Math.min(
    Math.max(Number(options.count || 1), Number(options.count || 1) * 3),
    Number(options.maxCandidates || Math.max(Number(options.count || 1), Number(options.count || 1) * 3)),
  );
  const { candidates, skipped, reviewedCount } = await resolveAmazonCandidates({
    ...options,
    count: detailCandidateLimit,
  });
  const amazonDedupe = filterRecentlyCollectedCandidates(candidates, COLLECT_SOURCE_AMAZON);
  duplicates.push(...amazonDedupe.duplicates);
  const enrichedCandidates = await enrichAmazonCandidatesWithDetails(
    amazonDedupe.accepted.slice(0, detailCandidateLimit),
    options,
  );
  const detailPriceFilter = filterAmazonCandidatesWithDetailPrices(enrichedCandidates);
  for (const candidate of detailPriceFilter.skipped) {
    const skipReason = candidate.reason || 'missing_amazon_detail_price';
    const readableReason = skipReason === 'missing_amazon_detail_price'
      ? '详情页未读取到标准价格，避免妙手来源价格为空。'
      : skipReason;
    log(`跳过 Amazon 商品：${candidate.title || candidate.asin || candidate.url}；${readableReason}`);
  }
  skipped.push(...detailPriceFilter.skipped);
  const candidatesToCollect = detailPriceFilter.accepted.slice(0, options.count);

  if (candidatesToCollect.length === 0) {
    log('没有找到可采集的 Amazon 商品候选。');
  } else {
    log(`Amazon 搜索页已读取 ${reviewedCount} 个候选，筛选出 ${candidatesToCollect.length} 个待提交妙手的商品；浏览器可以关闭，接下来等待妙手处理公共采集箱。`);
  }

  if (candidatesToCollect.length > 0) {
    const firstCandidate = candidatesToCollect[0];
    emitProgress({
      phase: 'collect',
      completed: 0,
      total: options.count,
      totalCount: options.count,
      overallPercent: 0,
      detailId: firstCandidate.title || firstCandidate.asin || firstCandidate.url,
    });

    try {
      const candidateUrls = candidatesToCollect.map((candidate) => candidate.url);
      const collectResult = await collectSourceLinksWithMiaoshouApi(
        candidateUrls,
        buildCollectLinkRetryOptions(COLLECT_SOURCE_AMAZON),
      );
      for (const [index, candidate] of candidatesToCollect.entries()) {
        const resultItem = {
          title: candidate.title || candidate.asin,
          url: candidate.url,
          asin: candidate.asin,
          amazonUrl: candidate.url,
          price: candidate.priceUsd,
          priceUsd: candidate.priceUsd,
          rating: candidate.rating,
          reviewCount: candidate.reviewCount,
          weightGrams: candidate.weightGrams,
          weightText: candidate.weightText,
          keyword: candidate.keyword,
          reason: candidate.reason || 'Amazon 商品已通过妙手接口采集。',
          pluginMessage: collectResult.message,
          apiMessage: collectResult.message,
          commonCollectBoxDetailId: collectResult.commonCollectBoxDetailIds[index] || null,
          platformCollectBoxDetailIdMap: collectResult.platformCollectBoxDetailIdMap,
        };
        collected.push(resultItem);
      }
      rememberCollectedItems(collected, COLLECT_SOURCE_AMAZON);
      log(`Amazon 商品批量采集成功：${collected.length}/${candidatesToCollect.length} 个商品已认领到 TikTok 采集箱。`);
    } catch (error) {
      if (isMiaoshouServiceUnavailableError(error)) {
        log(`妙手服务异常，停止本次采集：${error.message || String(error)}`);
        throw error;
      }
      for (const candidate of candidatesToCollect) {
        failed.push({
          title: candidate.title || candidate.asin,
          url: candidate.url,
          asin: candidate.asin,
          amazonUrl: candidate.url,
          price: candidate.priceUsd,
          priceUsd: candidate.priceUsd,
          rating: candidate.rating,
          reviewCount: candidate.reviewCount,
          weightGrams: candidate.weightGrams,
          weightText: candidate.weightText,
          keyword: candidate.keyword,
          error: error.message || String(error),
        });
      }
      log(`Amazon 商品批量采集异常：${error.message || String(error)}`);
    }
  }

  const failedResults = failed.map((item) => ({
    ...item,
    error: item.error || '采集失败',
    stage: 'collect',
  }));

  return {
    mode: 'amazon-collection',
    requestedCount: options.count,
    totalCount: collected.length + duplicates.length + failed.length,
    successCount: collected.length,
    errorCount: failed.length,
    skippedCount: skipped.length,
    duplicateCount: duplicates.length,
    reviewedCount,
    params: {
      source: options.source,
      amazonMode: options.amazonMode,
      amazonMarketplace: options.amazonMarketplace,
      keywords: options.keywords,
      links: options.links,
      amazonMaxPriceUsd: options.amazonMaxPriceUsd,
      amazonMinRating: options.amazonMinRating,
      amazonMinReviewCount: options.amazonMinReviewCount,
      excludedTerms: options.excludedTerms,
    },
    results: [
      ...collected.map(compactCollectionItem),
      ...failedResults.map(compactCollectionItem),
    ],
    duplicates: duplicates.map(compactCollectionItem),
    skipped: skipped.slice(0, 50).map(compactCollectionItem),
  };
}

async function runCollection(options) {
  if (options.source === COLLECT_SOURCE_AMAZON) {
    return runAmazonCollection(options);
  }

  if (options.source === COLLECT_SOURCE_SHOPEE && options.links.length === 0) {
    return runShopeeCollection(options);
  }

  log('采集方式：1688 只负责选品和详情链接，合格商品通过妙手开放 API 采集并认领到 TikTok 采集箱。');

  const profileDir = getProfileDir();
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: options.headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });

  const collected = [];
  const skipped = [];
  const failed = [];
  const duplicates = [];
  let reviewedCount = 0;

  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
    await ensureLargeBrowserViewport(page);

    const keywordQueue = options.links.length > 0 ? ['详情链接'] : options.keywords;

    if (options.links.length > 0) {
      log(`使用手动详情链接采集，链接数量：${options.links.length}。`);
    }

    for (const keyword of keywordQueue) {
      if (collected.length >= options.count) {
        break;
      }
      if (options.links.length === 0) {
        log(`开始搜索关键词：${keyword}`);
      }
      emitProgress({
        phase: 'collect',
        completed: collected.length,
        total: options.count,
        totalCount: options.count,
        overallPercent: Math.round((collected.length / options.count) * 100),
        detailId: keyword,
      });

      const candidates = options.links.length > 0
        ? options.links.map((url) => ({ title: url, url, price: '', keyword }))
        : await (async () => {
          const searchPage = await searchKeywordFromHome(browser, page, keyword);
          const searchCandidates = await extractSearchCandidates(searchPage, keyword, options);
          log(`关键词 ${keyword} 找到候选商品 ${searchCandidates.length} 个。`);
          return searchCandidates;
        })();
      const sourceDedupe = filterRecentlyCollectedCandidates(candidates, COLLECT_SOURCE_1688);
      duplicates.push(...sourceDedupe.duplicates);

      for (const candidate of sourceDedupe.accepted) {
        if (collected.length >= options.count || reviewedCount >= options.maxCandidates) {
          break;
        }
        reviewedCount += 1;
        if (options.links.length === 0) {
          const quickDecision = evaluateCandidate(candidate, options);
          if (quickDecision.decision === 'reject') {
            skipped.push({ ...candidate, score: quickDecision.score, reason: quickDecision.reason });
            log(`跳过候选商品：${candidate.title}；${quickDecision.reason}`);
            continue;
          }
        }

        const detailPage = await browser.newPage();
        detailPage.setDefaultTimeout(DEFAULT_TIMEOUT);
        detailPage.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
        try {
          await ensureLargeBrowserViewport(detailPage);
          await detailPage.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
          const detailCandidate = await extractDetailCandidate(detailPage, candidate);
          const detailDecision = evaluateCandidate(detailCandidate, options);
          if (!options.skipFilters && detailDecision.decision !== 'collect') {
            skipped.push({ ...detailCandidate, score: detailDecision.score, reason: detailDecision.reason });
            log(`跳过候选商品：${detailCandidate.title}；${detailDecision.reason}`);
            continue;
          }
          const collectResult = await collectSourceLinksWithMiaoshouApi([detailCandidate.url], {
            fetchServiceRetryCount: DEFAULT_FETCH_SERVICE_RETRY_COUNT,
            fetchServiceRetryDelayMs: DEFAULT_FETCH_SERVICE_RETRY_DELAY_MS,
            claimInitialDelayMs: DEFAULT_CLAIM_INITIAL_DELAY_MS,
            claimServiceRetryCount: DEFAULT_CLAIM_SERVICE_RETRY_COUNT,
            claimServiceRetryDelayMs: DEFAULT_CLAIM_SERVICE_RETRY_DELAY_MS,
          });
          const resultItem = {
            title: detailCandidate.title,
            url: detailCandidate.url,
            price: parsePrice(detailCandidate.price),
            unitPrice: Number.isFinite(Number(detailCandidate.unitPrice)) ? Number(detailCandidate.unitPrice) : null,
            freightPrice: Number.isFinite(Number(detailCandidate.freightPrice)) ? Number(detailCandidate.freightPrice) : null,
            weightGrams: detailCandidate.weightGrams,
            weightText: detailCandidate.weightText,
            score: detailDecision.score,
            reason: detailDecision.reason,
            keyword,
            pluginMessage: collectResult.message,
            apiMessage: collectResult.message,
            commonCollectBoxDetailId: collectResult.commonCollectBoxDetailIds[0] || null,
            platformCollectBoxDetailIdMap: collectResult.platformCollectBoxDetailIdMap,
          };
          if (collectResult.status === 'success') {
            collected.push(resultItem);
            rememberCollectedItems([resultItem], COLLECT_SOURCE_1688);
          } else {
            failed.push({ ...resultItem, error: collectResult.message });
            log(`商品采集失败：${detailCandidate.title || detailCandidate.url}；${collectResult.message}`);
          }
          emitProgress({
            phase: 'collect',
            completed: collected.length,
            total: options.count,
            totalCount: options.count,
            overallPercent: Math.round((collected.length / options.count) * 100),
            detailId: detailCandidate.title || detailCandidate.url,
          });
        } catch (error) {
          if (isMiaoshouServiceUnavailableError(error)) {
            log(`妙手服务异常，停止本次采集：${error.message || String(error)}`);
            throw error;
          }
          failed.push({
            title: candidate.title,
            url: candidate.url,
            price: candidate.price,
            weightGrams: candidate.weightGrams || null,
            weightText: candidate.weightText || '',
            keyword,
            error: error.message || String(error),
          });
          log(`商品采集异常：${candidate.title || candidate.url}；${error.message || String(error)}`);
        } finally {
          await detailPage.close().catch(() => {});
        }
      }
    }

    const failedResults = failed.map((item) => ({
      title: item.title,
      url: item.url,
      price: item.price,
      weightGrams: item.weightGrams || null,
      weightText: item.weightText || '',
      keyword: item.keyword,
      error: item.error || '采集失败',
      stage: 'collect',
    }));

    return {
      mode: '1688-collection',
      requestedCount: options.count,
      totalCount: collected.length + duplicates.length + failed.length,
      successCount: collected.length,
      errorCount: failed.length,
      skippedCount: skipped.length,
      duplicateCount: duplicates.length,
      params: {
        keywords: options.keywords,
        maxPriceCny: options.maxPriceCny,
        minScore: options.minScore,
        safeMode: options.safeMode,
        links: options.links,
      },
      results: [
        ...collected.map(compactCollectionItem),
        ...failedResults.map(compactCollectionItem),
      ],
      duplicates: duplicates.map(compactCollectionItem),
      skipped: skipped.slice(0, 50).map(compactCollectionItem),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run() {
  const options = parseArgs();
  const summary = await runCollection(options);
  if (summary.successCount >= options.count) {
    emitProgress({
      phase: 'complete',
      completed: summary.successCount,
      total: options.count,
      totalCount: options.count,
      overallPercent: 100,
    });
  }
  console.log(JSON.stringify(summary));
}

module.exports = {
  DEFAULT_1688_HOME_URL,
  DEFAULT_COLLECT_OPTIONS,
  COMMON_COLLECT_CLAIMED_PATH,
  COMMON_COLLECT_FETCH_ITEM_PATH,
  buildCollectLinkRetryOptions,
  buildShopeeSearchUrl,
  buildPurchasePriceWithFreight,
  buildSearchUrl,
  collectSourceLinksWithMiaoshouApi,
  detectShopeeAccessBlock,
  evaluateCandidate,
  extractFreightPriceFromText,
  extractProductUnitPriceFromText,
  extractSearchCandidateTitle,
  getMiaoshouExtensionPath,
  isMiaoshouServiceUnavailableError,
  normalizeOptions,
  normalizeSearchCandidateRecords,
  normalizeSourceLinks,
  normalizeShopeeCandidateRecords,
  normalizeShopeeProductUrl,
  parseArgs,
  parseMinOrderQuantityFromText,
  parsePrice,
  parseSearchCardPrice,
  parseWeightFromText,
  resolveSearchOfferUrl,
  runCollection,
  selectDetailProductTitle,
  splitTerms,
  syncMiaoshouExtensionState,
};

if (require.main === module) {
  run().catch((error) => {
    log(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
