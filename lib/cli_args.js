const {
  normalizeItemRangeIndex,
  normalizeItemSelectionMode,
} = require('./item_selection');
const { normalizeSourcePriceExtraCny } = require('./source_price_resolution');
const { normalizeSkuWeightPaddingGrams } = require('./source_price_weight');

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CATEGORY_NAME = '不插电造型工具';
const DEFAULT_TITLE_MAX_LENGTH = parsePositiveInteger(process.env.TITLE_OPTIMIZE_MAX_LENGTH, 180);
const DEFAULT_SKU_WEIGHT_PADDING_GRAMS = Math.max(
  0,
  parseNumber(process.env.SKU_WEIGHT_PADDING_GRAMS, 30),
);
const DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT = 90;

function normalizeBuyOneTakeOnePriceMarkupPercent(value = DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT) {
  if (value === '' || value === null || value === undefined) {
    return DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT;
  }
  return Number(Math.max(0, Math.min(100, parsed)).toFixed(1));
}

function parseBooleanOrNull(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = []) {
  const hasQuickParams = argv.includes('--count')
    || argv.includes('--publish')
    || argv.includes('--item-start-index')
    || argv.includes('--item-end-index');
  const hasCommand = argv[0] && !argv[0].startsWith('--');
  const resolvedDefaultCommand = hasQuickParams ? 'run-default' : 'search';
  const args = {
    command: hasCommand ? argv[0] : resolvedDefaultCommand,
    apply: false,
    allowNonLeaf: false,
    categoryName: DEFAULT_CATEGORY_NAME,
    pageNo: 0,
    pageSize: 10,
    maxPages: 1,
    batchSize: 5,
    requestIntervalMs: 1200,
    model: '',
    maxTitleLength: DEFAULT_TITLE_MAX_LENGTH,
    platform: 'tiktok',
    detailIds: [],
    shopIds: [],
    targetSites: [],
    groupSites: [],
    referenceDetailId: '',
    imageUrl: '',
    imagePath: '',
    publishAllShops: false,
    publishScope: 'group',
    publishScopeSpecified: false,
    syncScope: 'group',
    sourceShopId: '',
    count: 1,
    itemSelectionMode: 'range',
    itemStartIndex: null,
    itemEndIndex: null,
    publish: true,
    sourcePriceExtraCny: 0,
    skuWeightPaddingGrams: DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
    buyOneTakeOne: false,
    buyOneTakeOnePriceMarkupPercent: DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT,
  };

  for (let index = hasCommand ? 1 : 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--allow-non-leaf') {
      args.allowNonLeaf = true;
    } else if (arg === '--site') {
      args.site = argv[index + 1];
      index += 1;
    } else if (arg === '--category') {
      args.categoryName = argv[index + 1];
      index += 1;
    } else if (arg === '--page-no') {
      args.pageNo = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--page-size') {
      args.pageSize = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--count') {
      args.count = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--item-selection-mode') {
      args.itemSelectionMode = normalizeItemSelectionMode(argv[index + 1]);
      index += 1;
    } else if (arg === '--item-start-index') {
      args.itemStartIndex = normalizeItemRangeIndex(argv[index + 1], '开始序号');
      index += 1;
    } else if (arg === '--item-end-index') {
      args.itemEndIndex = normalizeItemRangeIndex(argv[index + 1], '结束序号');
      index += 1;
    } else if (arg === '--max-pages') {
      args.maxPages = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--batch-size') {
      args.batchSize = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--interval-ms') {
      args.requestIntervalMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--model') {
      args.model = argv[index + 1];
      index += 1;
    } else if (arg === '--platform') {
      args.platform = argv[index + 1];
      index += 1;
    } else if (arg === '--max-title-length') {
      args.maxTitleLength = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--detail-ids') {
      args.detailIds = parseList(argv[index + 1]);
      index += 1;
    } else if (arg === '--shop-ids') {
      args.shopIds = parseList(argv[index + 1]);
      index += 1;
    } else if (arg === '--target-sites') {
      args.targetSites = parseList(argv[index + 1]);
      index += 1;
    } else if (arg === '--group-sites') {
      args.groupSites = parseList(argv[index + 1]);
      index += 1;
    } else if (arg === '--reference-detail-id') {
      args.referenceDetailId = argv[index + 1];
      index += 1;
    } else if (arg === '--image-url') {
      args.imageUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--image-path') {
      args.imagePath = argv[index + 1];
      index += 1;
    } else if (arg === '--publish-all-shops') {
      args.publishAllShops = true;
    } else if (arg === '--publish-scope') {
      args.publishScope = String(argv[index + 1] || '').trim().toLowerCase() || 'group';
      args.publishScopeSpecified = true;
      index += 1;
    } else if (arg === '--sync-scope') {
      args.syncScope = String(argv[index + 1] || '').trim().toLowerCase() || 'group';
      index += 1;
    } else if (arg === '--source-shop-id') {
      args.sourceShopId = argv[index + 1];
      index += 1;
    } else if (arg === '--source-price-extra') {
      args.sourcePriceExtraCny = normalizeSourcePriceExtraCny(argv[index + 1]);
      index += 1;
    } else if (arg === '--weight-padding-grams') {
      args.skuWeightPaddingGrams = normalizeSkuWeightPaddingGrams(argv[index + 1]);
      index += 1;
    } else if (arg === '--buy-one-take-one') {
      const parsed = parseBooleanOrNull(argv[index + 1]);
      if (parsed === null) {
        args.buyOneTakeOne = true;
      } else {
        args.buyOneTakeOne = parsed;
        index += 1;
      }
    } else if (arg === '--buy-one-take-one-price-markup-percent') {
      args.buyOneTakeOnePriceMarkupPercent = normalizeBuyOneTakeOnePriceMarkupPercent(argv[index + 1]);
      index += 1;
    } else if (arg === '--publish') {
      const parsed = parseBooleanOrNull(argv[index + 1]);
      if (parsed !== null) {
        args.publish = parsed;
      }
      index += 1;
    }
  }

  return args;
}

module.exports = {
  parseArgs,
  parseBooleanOrNull,
  parseList,
  normalizeBuyOneTakeOnePriceMarkupPercent,
};
