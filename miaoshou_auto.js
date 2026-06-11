const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const OpenAI = require('openai');
const { APP_ID, APP_SECRET, MS_URL } = require('./key.js');
const {
  addSkuWeightPaddingKg,
  applySourcePriceExtraCny,
  extractFirstValidPriceFromText,
  extractFreightPriceFromText,
  resolveGrossWeightFromText,
} = require('./lib/source_price_weight');
const {
  buildResolvedSourcePriceFromLookup,
  buildSkuOriginPriceSnapshot,
  collectRepresentativeOriginPrices,
  extractRepresentativeOriginPrice,
  hasSuspiciousHighSourcePrice,
  isSourcePriceTooHighForDirectUse,
  normalizeSourcePriceExtraCny,
  shouldOverwriteSuspiciousOriginPrice,
} = require('./lib/source_price_resolution');
const {
  estimateDomesticFreightByWeight,
  tryResolve1688GrossWeightByImage,
  tryResolve1688GrossWeightBySourceUrl,
  tryResolve1688UnitAndFreightByImage,
  tryResolve1688UnitAndFreightBySourceUrl,
} = require('./lib/source_1688_lookup');
const {
  collectSkuImageUrlsFromPropertyList,
  dedupeImageUrls,
  extractImageUrlsFromNotes,
  extractPrimaryProductImageUrl,
  extractSourceProductUrl,
  uniqueUrlList,
} = require('./lib/source_item_links');
const {
  buildDefaultEditSearchParams,
  hasItemRangeSelection,
  normalizeItemRangeSelection,
  normalizeItemSelectionMode,
  selectItemsByItemRange,
} = require('./lib/item_selection');
const {
  clampGrossWeightKg,
  chooseGrossWeightKg,
  enforceMinimumFinalGrossWeightKg,
  isGrossWeightTooHighForDirectUse,
  normalizeWeightUnitToKg,
  resolveFallbackWeight,
} = require('./lib/gross_weight_rules');
const { parseArgs } = require('./lib/cli_args');
const {
  SENSITIVE_WORDS,
  ensureOptimizedTitleMinLength,
  normalizeOptimizedTitle,
  sanitizeSensitiveWordsFromText,
} = require('./lib/title_text_rules');
const {
  findCategory,
  flattenCategoryTree,
} = require('./lib/category_tree');
const {
  DEFAULT_SINGLE_SPEC_ATTR_NAME,
  DEFAULT_SINGLE_SPEC_ATTR_VALUE,
  SPEC_ATTR_NAME_MAX_LENGTH,
  SPEC_ATTR_VALUE_MAX_LENGTH,
  cleanSkuPropertyList,
  collectSkuTextsForTranslation,
  containsCjkText,
  ensureUniqueSkuPropertyValueNames,
  normalizeSpecTranslationTextSafe,
  parseSpecTranslationEntries,
  resolveFallbackSpecTranslation,
  sanitizeSkuSpecText,
  translateSkuPropertyListWithFallbackMap,
} = require('./lib/sku_spec_text');
const {
  DEFAULT_AI_PROVIDER,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MAX_RETRIES,
  DEFAULT_KIMI_MODEL,
  DEFAULT_KIMI_REQUEST_TIMEOUT_MS,
  DEFAULT_KIMI_TEMPERATURE,
  DEFAULT_MIMO_MODEL,
  DEFAULT_MIMO_TEMPERATURE,
  formatMimoUsageForLog,
  getDefaultAiModel,
  getImageAuditModel,
  getSkuTranslationModel,
  getTitleOptimizeModel,
  getWeightEstimationModel,
  hasKimiApiKey,
  hasMimoApiKey,
  isDeepSeekModel,
  isKimiVisionModel,
  normalizeModelName,
  resolveAiProviderForRequest,
  resolveMimoVisionModel,
} = require('./lib/ai_provider_config');
const {
  createDeepSeekChatCompletion,
  createMimoChatCompletion,
} = require('./lib/ai_chat_clients');
const {
  createAiJsonChatCompletion,
  getChatCompletionMessageContent,
  parseKimiJsonContent,
} = require('./lib/ai_json_completion');

// 妙手开放平台接口路径集中放在这里，后续新增接口时先补常量，避免散落硬编码。
const SEARCH_COLLECT_BOX_DETAIL_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/search_collect_box_detail_list';
const GET_CATEGORY_TREE_BY_SITE_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/get_category_tree_by_site';
const GET_SITE_COLLECT_ITEM_INFO_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/get_site_collect_item_info';
const SAVE_SITE_COLLECT_ITEM_INFO_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/save_site_collect_item_info';
const CLAIM_TO_SHOP_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/claim_to_shop';
const SAVE_MOVE_COLLECT_TASK_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/save_move_collect_task';
const GET_SHOP_LIST_PATH =
  '/open/v1/product/shop/shop/get_shop_list';
const GET_SHOP_WAREHOUSE_LIST_PATH =
  '/open/v1/product/collect_box/tiktok/collect_box/get_shop_warehouse_list';
const DEFAULT_CATEGORY_NAME = '不插电造型工具';

// 默认只查询未发布的采集箱商品；命令行参数可以覆盖 pageNo/pageSize/maxPages。
const DEFAULT_SEARCH_PARAMS = {
  pageNo: 0,
  pageSize: 10,
  filter: {
    status: 'notPublished',
  },
};

const DEFAULT_TITLE_MAX_LENGTH = parsePositiveInteger(process.env.TITLE_OPTIMIZE_MAX_LENGTH, 180);
const DEFAULT_TITLE_MIN_LENGTH = parsePositiveInteger(process.env.TITLE_OPTIMIZE_MIN_LENGTH, 25);
const DEFAULT_DELIVERY_OPTION_SET_TYPE = 'default';
const DEFAULT_DESCRIPTION_IMAGE_COUNT = parsePositiveInteger(process.env.MAX_DESCRIPTION_IMAGE_COUNT, 20);
const HARD_MAX_DESCRIPTION_IMAGE_COUNT = 10;
const DEFAULT_MAIN_IMAGE_COUNT = parsePositiveInteger(process.env.MAX_MAIN_IMAGE_COUNT, 9);
const ENABLE_KIMI_IMAGE_RELEVANCE_CHECK = String(process.env.ENABLE_KIMI_IMAGE_RELEVANCE_CHECK || '1') !== '0';
const ENABLE_MIMO_IMAGE_RELEVANCE_CHECK = String(
  process.env.ENABLE_MIMO_IMAGE_RELEVANCE_CHECK || process.env.ENABLE_KIMI_IMAGE_RELEVANCE_CHECK || '1',
) !== '0';
const DEFAULT_IMAGE_RELEVANCE_MAX_CHECK_COUNT = parsePositiveInteger(process.env.IMAGE_RELEVANCE_MAX_CHECK_COUNT, 20);
const DEFAULT_MIN_MAIN_IMAGE_COUNT = parsePositiveInteger(process.env.MIN_MAIN_IMAGE_COUNT, 3);
const DEFAULT_MIN_DETAIL_IMAGE_COUNT = parsePositiveInteger(process.env.MIN_DETAIL_IMAGE_COUNT, 5);
const DEFAULT_FALLBACK_WEIGHT = parseNumber(process.env.DEFAULT_FALLBACK_WEIGHT, 0.1);
const ENABLE_KIMI_WEIGHT_ESTIMATION = String(process.env.ENABLE_KIMI_WEIGHT_ESTIMATION || '1') !== '0';
const ENABLE_MIMO_WEIGHT_ESTIMATION = String(
  process.env.ENABLE_MIMO_WEIGHT_ESTIMATION || process.env.ENABLE_KIMI_WEIGHT_ESTIMATION || '1',
) !== '0';
const ENABLE_KIMI_SPEC_TRANSLATION = String(process.env.ENABLE_KIMI_SPEC_TRANSLATION || '1') !== '0';
const DEFAULT_SPEC_TRANSLATION_BATCH_SIZE = parsePositiveInteger(
  process.env.SPEC_TRANSLATION_BATCH_SIZE,
  60,
);
const DEFAULT_WEIGHT_ESTIMATION_IMAGE_COUNT = parsePositiveInteger(process.env.WEIGHT_ESTIMATION_IMAGE_COUNT, 2);
const DEFAULT_WEIGHT_ESTIMATION_MAX_IMAGE_BYTES = parsePositiveInteger(process.env.WEIGHT_ESTIMATION_MAX_IMAGE_BYTES, 1500000);
const DEFAULT_SKU_WEIGHT_PADDING_GRAMS = Math.max(
  0,
  parseNumber(process.env.SKU_WEIGHT_PADDING_GRAMS, 30),
);
const DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS = parsePositiveInteger(process.env.EXTERNAL_FETCH_TIMEOUT_MS, 12000);
const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = parsePositiveInteger(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS, 12000);
const ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK = String(process.env.ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK || '1') !== '0';
const DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT = parsePositiveInteger(process.env.LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT, 20);
const DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES = parsePositiveInteger(process.env.LOCAL_IMAGE_POLICY_MAX_BYTES, 3500000);
const ENABLE_1688_IMAGE_SOURCE_PRICE_LOOKUP = String(process.env.ENABLE_1688_IMAGE_SOURCE_PRICE_LOOKUP || '1') !== '0';
const ENABLE_1688_IMAGE_WEIGHT_LOOKUP = String(
  process.env.ENABLE_1688_IMAGE_WEIGHT_LOOKUP || process.env.ENABLE_1688_IMAGE_SOURCE_PRICE_LOOKUP || '1',
) !== '0';
const ENABLE_1688_SOURCE_URL_PRICE_LOOKUP = String(process.env.ENABLE_1688_SOURCE_URL_PRICE_LOOKUP || '1') !== '0';
const ENABLE_1688_SOURCE_URL_WEIGHT_LOOKUP = String(
  process.env.ENABLE_1688_SOURCE_URL_WEIGHT_LOOKUP || process.env.ENABLE_1688_SOURCE_URL_PRICE_LOOKUP || '1',
) !== '0';
const ENABLE_SOURCE_PRICE_CURRENT_FIELD_FALLBACK = String(process.env.ENABLE_SOURCE_PRICE_CURRENT_FIELD_FALLBACK || '0') !== '0';
const SOURCE_PRICE_DIRECT_USE_THRESHOLD_CNY = parseNumber(process.env.SOURCE_PRICE_DIRECT_USE_THRESHOLD_CNY, 0.01);
const SOURCE_PRICE_DIRECT_USE_MAX_CNY = parseNumber(process.env.SOURCE_PRICE_DIRECT_USE_MAX_CNY, 100);
const LOW_SOURCE_PRICE_PADDING_THRESHOLD_CNY = parseNumber(
  process.env.LOW_SOURCE_PRICE_PADDING_THRESHOLD_CNY,
  3,
);
const LOW_SOURCE_PRICE_PADDING_CNY = parseNumber(process.env.LOW_SOURCE_PRICE_PADDING_CNY, 3);
const DEFAULT_MIAOSHOU_RETRY_COUNT = parsePositiveInteger(process.env.MIAOSHOU_RETRY_COUNT, 8);
const DEFAULT_MIAOSHOU_RETRY_DELAY_MS = parsePositiveInteger(process.env.MIAOSHOU_RETRY_DELAY_MS, 1200);
const DEFAULT_PUBLISH_SHOP_BATCH_SIZE = parsePositiveInteger(process.env.PUBLISH_SHOP_BATCH_SIZE, 15);
const DEFAULT_PUBLISH_SHOP_BATCH_INTERVAL_MS = parsePositiveInteger(process.env.PUBLISH_SHOP_BATCH_INTERVAL_MS, 1500);
const DEFAULT_PH_SHOP_ID = process.env.DEFAULT_PH_SHOP_ID || '15269367';
const DEFAULT_PH_WAREHOUSE_ID = process.env.DEFAULT_PH_WAREHOUSE_ID || '7637065379958277908';
const DEFAULT_PH_WAREHOUSE_STOCK = String(parsePositiveInteger(process.env.DEFAULT_PH_WAREHOUSE_STOCK, 2222));
const DEFAULT_TIKTOK_SHOP_SITES = ['PH', 'MY', 'TH'];
const ENABLE_AUTO_CLAIM_WHEN_MISSING_SHOPS = String(process.env.ENABLE_AUTO_CLAIM_WHEN_MISSING_SHOPS || '1') !== '0';
const DEFAULT_WORKFLOW_SOURCE_SITE = String(process.env.DEFAULT_WORKFLOW_SOURCE_SITE || 'PH').toUpperCase();
const DEFAULT_WORKFLOW_GROUP_SITES = (() => {
  const raw = String(process.env.DEFAULT_WORKFLOW_GROUP_SITES || '').trim();
  const parsed = raw
    ? raw.split(',').map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)
    : [];
  return parsed.length > 0 ? uniqueIdList(parsed) : DEFAULT_TIKTOK_SHOP_SITES;
})();
let kimiClient;
let is1688AntiBotSessionBlocked = false;
const autoClaimShopGroupIndexCache = new Map();
const specTextTranslationCache = new Map();
const warehouseCoverageIndexCache = new Map();

// 按妙手签名规则生成 x-sign：secret + path + timestamp + appKey + body + secret。
function generateSign(appSecret, path, timestamp, appKey, bodyJson = '') {
  const message = appSecret + path + timestamp + appKey + bodyJson + appSecret;
  return crypto.createHmac('sha256', appSecret).update(message).digest('hex');
}

// 每个请求都需要带 app key、时间戳和签名；bodyJson 必须和真正发送的 body 完全一致。
function buildSignedHeaders(path, bodyJson = '', timestamp = Math.floor(Date.now() / 1000)) {
  return {
    'x-app-key': APP_ID,
    'x-timestamp': String(timestamp),
    'x-sign': generateSign(APP_SECRET, path, timestamp, APP_ID, bodyJson),
    'Content-Type': 'application/json',
  };
}

function buildUrl(path) {
  return new URL(path, MS_URL).toString();
}

// 统一解析响应，遇到 HTML/空响应等非 JSON 内容时给出可读错误。
async function parseJsonResponse(response) {
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
    throw new Error(
      `Miaoshou API returned non-JSON response (${response.status} ${response.statusText}): ${preview}`,
    );
  }
}

// 妙手 API 的统一请求入口：负责签名、发送、HTTP 错误和业务错误处理。
function isTransientMiaoshouFailure(error) {
  const message = String(error && error.message ? error.message : error || '');
  return [
    /502/i,
    /503/i,
    /504/i,
    /Bad Gateway/i,
    /Gateway Timeout/i,
    /fetch failed/i,
    /terminated/i,
    /aborted/i,
    /socket/i,
    /UND_ERR/i,
    /ECONNRESET/i,
    /ECONNABORTED/i,
    /ETIMEDOUT/i,
  ].some((pattern) => pattern.test(message));
}

async function requestMiaoshou(path, { method = 'POST', body } = {}) {
  const bodyJson = body === undefined ? '' : JSON.stringify(body);
  let lastError;

  for (let attempt = 0; attempt <= DEFAULT_MIAOSHOU_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(buildUrl(path), {
        method,
        headers: buildSignedHeaders(path, bodyJson),
        ...(bodyJson ? { body: bodyJson } : {}),
      });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        const message = data && data.message ? data.message : response.statusText;
        const httpError = new Error(`Miaoshou HTTP error ${response.status}: ${message}`);
        if (response.status >= 500 && attempt < DEFAULT_MIAOSHOU_RETRY_COUNT) {
          lastError = httpError;
          await sleep(DEFAULT_MIAOSHOU_RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw httpError;
      }

      if (data && data.code && data.code !== 'success') {
        throw new Error(`Miaoshou API error ${data.code}: ${data.message || 'no message'}`);
      }

      return data;
    } catch (error) {
      lastError = error;
      if (attempt < DEFAULT_MIAOSHOU_RETRY_COUNT && isTransientMiaoshouFailure(error)) {
        await sleep(DEFAULT_MIAOSHOU_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Miaoshou request failed after retries.');
}

// 查询 TikTok 采集箱商品列表，返回接口原始数据。
async function searchCollectBoxItems(params = {}) {
  const body = {
    ...DEFAULT_SEARCH_PARAMS,
    ...params,
    filter: {
      ...DEFAULT_SEARCH_PARAMS.filter,
      ...(params.filter || {}),
    },
  };

  return requestMiaoshou(SEARCH_COLLECT_BOX_DETAIL_PATH, {
    method: 'POST',
    body,
  });
}

// 获取指定站点的 TikTok 类目树，用于查找目标类目的 cid。
async function getCategoryTreeBySite(site) {
  if (!site) {
    throw new Error('site is required to load TikTok category tree.');
  }

  return requestMiaoshou(GET_CATEGORY_TREE_BY_SITE_PATH, {
    method: 'POST',
    body: { site },
  });
}

// 按页收集采集箱商品；maxPages 控制最多翻多少页，避免一次扫太多数据。
async function collectCollectBoxItems({ pageNo = 0, pageSize = 50, maxPages = 1, filter } = {}) {
  const items = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const data = await searchCollectBoxItems({
      pageNo: pageNo + pageIndex,
      pageSize,
      ...(filter ? { filter } : {}),
    });
    const detailList = data && data.data && Array.isArray(data.data.detailList)
      ? data.data.detailList
      : [];

    items.push(...detailList);

    if (detailList.length < pageSize) {
      break;
    }
  }

  return items;
}

// 根据站点和类目名查 cid；找不到时会输出相近候选，方便确认类目名称。
async function findCategoryByName({ site, categoryName = DEFAULT_CATEGORY_NAME } = {}) {
  const categoryTree = await getCategoryTreeBySite(site);
  const categories = flattenCategoryTree(categoryTree.data || categoryTree);
  const category = findCategory(categories, categoryName);

  if (!category) {
    const candidates = categories
      .filter((item) => /造型|插电|美发|头发|hair|styling|tool/i.test(`${item.name} ${item.breadcrumb}`))
      .slice(0, 20)
      .map(({ cid, name, breadcrumb, isLastLevel }) => ({ cid, name, breadcrumb, isLastLevel }));

    throw new Error(
      `Category "${categoryName}" was not found for site ${site}. Candidates: ${JSON.stringify(candidates)}`,
    );
  }

  return category;
}

// 将数组切成固定大小的小批次，避免一次性提交过多商品。
function chunkArray(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

// 请求间隔用于避开平台 QPS 限流，尤其是逐个读取/保存商品详情时。
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitProgress(onProgress, payload = {}) {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    onProgress(payload);
  } catch (error) {
    // Progress reporting is best-effort and must not affect product processing.
  }
}

function execFileAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'relevant', 'related'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'n', '0', 'irrelevant', 'unrelated'].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function normalizeIdList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function uniqueIdList(values) {
  return [...new Set(normalizeIdList(values))];
}

function normalizeNumericIdList(values) {
  return uniqueIdList(values).map((value) => (/^\d+$/.test(value) ? Number(value) : value));
}

// Kimi 客户端延迟初始化，避免只查询妙手数据时也强制要求配置 Kimi Key。
function getKimiClient() {
  const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;

  if (!apiKey) {
    throw new Error('Missing KIMI_API_KEY. Set it in .env or system/user environment variables before optimizing titles.');
  }

  if (!kimiClient) {
    kimiClient = new OpenAI({
      apiKey,
      baseURL: process.env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL,
      timeout: DEFAULT_KIMI_REQUEST_TIMEOUT_MS,
      maxRetries: DEFAULT_KIMI_MAX_RETRIES,
    });
  }

  return kimiClient;
}

function logMimoCallMetrics({ taskLabel = 'MiMo 视觉调用', durationMs = 0, usage = {} } = {}) {
  const seconds = (Math.max(0, durationMs) / 1000).toFixed(1);
  console.error(`${taskLabel}耗时 ${seconds} 秒，token：${formatMimoUsageForLog(usage)}。`);
}

function getImageMimeTypeByPath(filePath = '') {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function readLocalImageAsDataUrl(imagePath = '') {
  const resolvedPath = path.resolve(String(imagePath || '').trim());
  const bytes = fs.readFileSync(resolvedPath);
  return `data:${getImageMimeTypeByPath(resolvedPath)};base64,${bytes.toString('base64')}`;
}

async function resolveMimoTestImageDataUrl({ imageUrl = '', imagePath = '' } = {}) {
  if (imagePath) {
    return readLocalImageAsDataUrl(imagePath);
  }
  if (imageUrl) {
    return downloadImageAsDataUrl(imageUrl);
  }
  throw new Error('Please provide --image-url or --image-path for test-mimo-image.');
}

async function testMimoImageUnderstanding({
  imageUrl = '',
  imagePath = '',
  model = DEFAULT_MIMO_MODEL,
} = {}) {
  const dataUrl = await resolveMimoTestImageDataUrl({ imageUrl, imagePath });
  const completion = await createMimoChatCompletion({
    model: resolveMimoVisionModel(model, 'MIMO_IMAGE_MODEL'),
    temperature: DEFAULT_MIMO_TEMPERATURE,
    messages: [
      {
        role: 'system',
        content: [
          'You are an ecommerce image inspector.',
          'Describe the product image briefly and identify whether it contains noisy supplier, factory, disclaimer, coupon, or policy content.',
          'Return JSON only with schema {"summary":"...","hasNoisyContent":true/false,"reason":"..."}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Test MiMo image understanding speed and token usage.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  }, { taskLabel: 'MiMo 测试识别', logMimoCallMetrics });

  return {
    model: completion.model || resolveMimoVisionModel(model, 'MIMO_IMAGE_MODEL'),
    usage: completion.usage || null,
    usageText: formatMimoUsageForLog(completion.usage || {}),
    content: getChatCompletionMessageContent(completion),
  };
}

async function createKimiChatCompletion(requestBody = {}) {
  return getKimiClient().chat.completions.create(requestBody);
}

async function createVisionChatCompletion(requestBody = {}, { taskLabel = '视觉识别' } = {}) {
  const model = normalizeModelName(requestBody.model);
  return isKimiVisionModel(model)
    ? createKimiChatCompletion(requestBody)
    : createMimoChatCompletion(requestBody, { taskLabel, logMimoCallMetrics });
}

async function createAiChatCompletion(requestBody = {}, { provider = DEFAULT_AI_PROVIDER } = {}) {
  const resolvedProvider = resolveAiProviderForRequest(requestBody, provider);
  if (resolvedProvider === 'deepseek') {
    return createDeepSeekChatCompletion(requestBody);
  }
  if (resolvedProvider === 'mimo') {
    return createMimoChatCompletion(requestBody, { taskLabel: 'MiMo 文字调用', logMimoCallMetrics });
  }
  return createKimiChatCompletion(requestBody);
}

// 妙手保存接口要求物流配置字段始终存在；未配置时沿用前端编辑器的默认值。
function withDeliveryOptionDefaults(itemInfo = {}) {
  const collectBoxDetailShopList = Array.isArray(itemInfo.collectBoxDetailShopList)
    ? itemInfo.collectBoxDetailShopList.map((shop) => ({
      ...shop,
      deliveryOptionSetType: shop.deliveryOptionSetType || DEFAULT_DELIVERY_OPTION_SET_TYPE,
      deliveryOptionIds: Array.isArray(shop.deliveryOptionIds) ? shop.deliveryOptionIds : [],
    }))
    : [];

  return {
    ...itemInfo,
    deliveryOptionSetType: itemInfo.deliveryOptionSetType || DEFAULT_DELIVERY_OPTION_SET_TYPE,
    deliveryOptionIds: Array.isArray(itemInfo.deliveryOptionIds) ? itemInfo.deliveryOptionIds : [],
    collectBoxDetailShopList,
  };
}

// 部分接口会把空字符串也当成非法图片地址；没有尺寸表时直接省略对应字段更稳。
function sanitizeOptionalFields(itemInfo = {}) {
  const sanitized = { ...itemInfo };

  if (!sanitized.sizeChart) {
    delete sanitized.sizeChart;
    delete sanitized.sizeChartType;
  }

  return sanitized;
}

function hasPrePublishShops(data = {}, itemInfo = {}) {
  const selectedShopList = Array.isArray(itemInfo.collectBoxDetailShopList)
    ? itemInfo.collectBoxDetailShopList
    : [];
  const claimToShopIds = Array.isArray(data.claimToShopIds) ? data.claimToShopIds : [];

  return selectedShopList.length > 0 || claimToShopIds.length > 0;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function normalizeSkuWeightPaddingGrams(value = DEFAULT_SKU_WEIGHT_PADDING_GRAMS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_SKU_WEIGHT_PADDING_GRAMS;
  }
  return Number(numeric.toFixed(1));
}

function normalizeCurrencyCny(value, fallback = null) {
  const numeric = parsePositiveNumber(value, fallback);
  if (!numeric) {
    return fallback;
  }
  return Number(Number(numeric).toFixed(2));
}

async function resolve1688GrossWeightForItem({
  item = {},
  itemInfo = {},
} = {}) {
  const sourceUrl = extractSourceProductUrl(item, itemInfo);
  const imageUrl = extractPrimaryProductImageUrl(item, itemInfo);
  let blockedBy1688 = is1688AntiBotSessionBlocked;
  const lookupAttempts = [];

  if (ENABLE_1688_SOURCE_URL_WEIGHT_LOOKUP && !is1688AntiBotSessionBlocked && sourceUrl) {
    const sourceLookup = await tryResolve1688GrossWeightBySourceUrl({ sourceUrl });
    lookupAttempts.push(sourceLookup);
    blockedBy1688 = blockedBy1688 || Boolean(sourceLookup && sourceLookup.blocked);
    if (sourceLookup && sourceLookup.blocked) {
      is1688AntiBotSessionBlocked = true;
    }
    if (sourceLookup && sourceLookup.matched && sourceLookup.weightKg) {
      return {
        estimatedGrossWeightKg: sourceLookup.weightKg,
        source: sourceLookup.source,
        confidence: 'high',
        evidence: sourceLookup.evidence,
        sourceUrl: sourceLookup.sourceUrl || sourceUrl,
        lookup: sourceLookup,
        lookupAttempts,
        blockedBy1688,
      };
    }
  }

  if (ENABLE_1688_IMAGE_WEIGHT_LOOKUP && !is1688AntiBotSessionBlocked && imageUrl) {
    const imageLookup = await tryResolve1688GrossWeightByImage({ imageUrl });
    lookupAttempts.push(imageLookup);
    blockedBy1688 = blockedBy1688 || Boolean(imageLookup && imageLookup.blocked);
    if (imageLookup && imageLookup.blocked) {
      is1688AntiBotSessionBlocked = true;
    }
    if (imageLookup && imageLookup.matched && imageLookup.weightKg) {
      return {
        estimatedGrossWeightKg: imageLookup.weightKg,
        source: imageLookup.source,
        confidence: 'high',
        evidence: imageLookup.evidence,
        sourceUrl: imageLookup.offerUrl || imageLookup.searchUrl || imageUrl,
        lookup: imageLookup,
        lookupAttempts,
        blockedBy1688,
      };
    }
  }

  return lookupAttempts.length > 0
    ? {
      estimatedGrossWeightKg: null,
      source: null,
      confidence: null,
      evidence: '',
      sourceUrl: sourceUrl || imageUrl || '',
      lookup: lookupAttempts[lookupAttempts.length - 1],
      lookupAttempts,
      blockedBy1688,
    }
    : null;
}

async function resolveAccurateSourcePriceForItem({
  item = {},
  itemInfo = {},
  grossWeightKg = null,
} = {}) {
  const currentOriginPrices = collectRepresentativeOriginPrices(itemInfo, item);
  const currentUnitPriceCny = currentOriginPrices[0] || null;
  const weightFreightCny = estimateDomesticFreightByWeight(grossWeightKg || itemInfo.weight);
  const imageUrl = extractPrimaryProductImageUrl(item, itemInfo);
  const sourceUrl = extractSourceProductUrl(item, itemInfo);
  let blockedBy1688 = is1688AntiBotSessionBlocked;
  const lookupAttempts = [];
  const directUseThresholdCny = parsePositiveNumber(SOURCE_PRICE_DIRECT_USE_THRESHOLD_CNY, 3);
  const directUseMaxCny = parsePositiveNumber(SOURCE_PRICE_DIRECT_USE_MAX_CNY, 100);
  const lowPricePaddingThresholdCny = parsePositiveNumber(LOW_SOURCE_PRICE_PADDING_THRESHOLD_CNY, 3);
  const lowPricePaddingCny = parsePositiveNumber(LOW_SOURCE_PRICE_PADDING_CNY, 3);
  const currentHasSuspiciousHighPrice = hasSuspiciousHighSourcePrice(itemInfo, item, directUseMaxCny);

  // Performance-first rule: use the existing source price directly when it is present.
  // Low-priced 1688 items are common; re-scraping them is riskier than preserving the current value.
  if (
    !currentHasSuspiciousHighPrice
    &&
    currentOriginPrices.some((price) => price && price < lowPricePaddingThresholdCny)
    && lowPricePaddingCny
  ) {
    const adjustedRepresentativePrice = currentUnitPriceCny && currentUnitPriceCny < lowPricePaddingThresholdCny
      ? normalizeCurrencyCny(currentUnitPriceCny + lowPricePaddingCny)
      : normalizeCurrencyCny(currentUnitPriceCny);
    return {
      sourcePriceCny: adjustedRepresentativePrice,
      unitPriceCny: normalizeCurrencyCny(currentUnitPriceCny),
      freightPriceCny: normalizeCurrencyCny(lowPricePaddingCny),
      sourcePriceAdjustmentCny: normalizeCurrencyCny(lowPricePaddingCny),
      sourcePriceAdjustmentThresholdCny: normalizeCurrencyCny(lowPricePaddingThresholdCny),
      blockedBy1688,
      source: 'direct_current_source_price_plus_low_price_padding',
      lookup: null,
      lookupAttempts,
    };
  }

  if (
    currentUnitPriceCny
    && currentUnitPriceCny >= directUseThresholdCny
    && currentUnitPriceCny <= directUseMaxCny
  ) {
    return {
      sourcePriceCny: normalizeCurrencyCny(currentUnitPriceCny),
      unitPriceCny: normalizeCurrencyCny(currentUnitPriceCny),
      freightPriceCny: null,
      sourcePriceAdjustmentCny: null,
      sourcePriceAdjustmentThresholdCny: null,
      blockedBy1688,
      source: 'direct_current_source_price_in_range',
      lookup: null,
      lookupAttempts,
    };
  }

  const preferImageLookup = currentHasSuspiciousHighPrice;
  const lookupPlans = preferImageLookup
    ? [
      { type: 'image', source: '1688_image_search' },
      { type: 'source', source: '1688_source_url' },
    ]
    : [
      { type: 'source', source: '1688_source_url' },
      { type: 'image', source: '1688_image_search' },
    ];

  for (const plan of lookupPlans) {
    if (is1688AntiBotSessionBlocked) {
      break;
    }

    let lookup = null;
    if (plan.type === 'image') {
      if (!ENABLE_1688_IMAGE_SOURCE_PRICE_LOOKUP || !imageUrl) {
        continue;
      }
      lookup = await tryResolve1688UnitAndFreightByImage({ imageUrl });
    } else {
      if (!ENABLE_1688_SOURCE_URL_PRICE_LOOKUP || !sourceUrl) {
        continue;
      }
      lookup = await tryResolve1688UnitAndFreightBySourceUrl({ sourceUrl });
    }

    lookupAttempts.push(lookup);
    blockedBy1688 = blockedBy1688 || Boolean(lookup && lookup.blocked);
    if (lookup && lookup.blocked) {
      is1688AntiBotSessionBlocked = true;
    }

    const resolved = buildResolvedSourcePriceFromLookup({
      lookup,
      source: plan.source,
      itemInfo,
      item,
      weightFreightCny,
      lowPricePaddingThresholdCny,
      lowPricePaddingCny,
      blockedBy1688,
      lookupAttempts,
    });
    if (resolved) {
      return resolved;
    }
  }

  // Strict mode by default: if no reliable 1688 unit price found, keep current source price unchanged.
  if (!ENABLE_SOURCE_PRICE_CURRENT_FIELD_FALLBACK || !currentUnitPriceCny) {
    return null;
  }

  return {
    sourcePriceCny: normalizeCurrencyCny(currentUnitPriceCny + (weightFreightCny || 0)),
    unitPriceCny: normalizeCurrencyCny(currentUnitPriceCny),
    freightPriceCny: normalizeCurrencyCny(weightFreightCny, 0),
    sourcePriceAdjustmentCny: null,
    sourcePriceAdjustmentThresholdCny: null,
    blockedBy1688,
    source: blockedBy1688
      ? 'fallback_current_price_plus_weight_freight_1688_blocked'
      : 'fallback_current_price_plus_weight_freight',
    lookup: lookupAttempts[lookupAttempts.length - 1] || null,
    lookupAttempts,
  };
}

async function fetchGrossWeightFromSourceUrl(sourceUrl = '') {
  if (!sourceUrl) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS);
  let html = '';

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    html = await response.text();
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }

  return resolveGrossWeightFromText(html);
}

async function downloadImageAsDataUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > DEFAULT_WEIGHT_ESTIMATION_MAX_IMAGE_BYTES) {
      return null;
    }

    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildWeightEstimationImageContent(itemInfo = {}) {
  const mainImages = Array.isArray(itemInfo.imgUrls) ? itemInfo.imgUrls : [];
  const noteImages = extractImageUrlsFromNotes(itemInfo.notes || '');
  const imageUrls = uniqueUrlList([...mainImages, ...noteImages])
    .slice(0, DEFAULT_WEIGHT_ESTIMATION_IMAGE_COUNT);
  const imageParts = [];

  for (const imageUrl of imageUrls) {
    try {
      const dataUrl = await downloadImageAsDataUrl(imageUrl);
      if (!dataUrl) {
        continue;
      }
      imageParts.push({
        type: 'image_url',
        image_url: { url: dataUrl },
      });
    } catch (error) {
      continue;
    }
  }

  return {
    imageParts,
    imageUrlCount: imageUrls.length,
  };
}

async function estimateGrossWeightWithMimoVision({
  item = {},
  itemInfo = {},
  site,
  categoryName,
  model,
} = {}) {
  const weightModel = getWeightEstimationModel(model);
  if (!ENABLE_MIMO_WEIGHT_ESTIMATION) {
    return null;
  }
  if (isKimiVisionModel(weightModel) ? !hasKimiApiKey() : !hasMimoApiKey()) {
    return null;
  }

  const { imageParts, imageUrlCount } = await buildWeightEstimationImageContent(itemInfo);
  if (imageParts.length === 0) {
    return null;
  }

  const sourceUrl = extractSourceProductUrl(item, itemInfo);
  const weightPromptPayload = {
    site,
    categoryName,
    title: itemInfo.title || item.title,
    itemNum: item.itemNum || itemInfo.itemNum,
    sourcePrice: item.price || itemInfo.originPrice,
    packageLengthCm: itemInfo.packageLength,
    packageWidthCm: itemInfo.packageWidth,
    packageHeightCm: itemInfo.packageHeight,
    currentWeightKg: itemInfo.weight,
    skuCount: Object.keys(itemInfo.skuMap || {}).length,
    instruction: [
      'First inspect product/package images for visible net content or weight text, such as 50g, 100ml, 30克, Net WT.',
      'If a visible product/package weight is present, return it as visiblePackageWeightKg and do not add shipping padding.',
      'If no visible weight is present, estimate the base single-piece product plus retail package weight in kg, excluding any extra platform padding.',
      'Do not use unrelated poster text, factory statistics, shipping time, sold count, MOQ, or stock numbers as weight.',
    ].join(' '),
  };

  const completion = await createVisionChatCompletion({
    model: weightModel,
    temperature: DEFAULT_MIMO_TEMPERATURE,
    messages: [
      {
        role: 'system',
        content: [
          'You are an ecommerce product image weight inspector.',
          'Use the images to read product/package weight when visible. Examples: 50g means 0.05 kg, 250 ml for liquid/cream can be approximated as 0.25 kg unless package suggests otherwise.',
          'If visible product/package weight is not found, estimate base single-piece weight from product appearance and retail packaging.',
          'Exclude platform extra padding; another system will add the configured extra weight later.',
          'Return JSON only with this schema:',
          '{"visiblePackageWeightKg": number|null, "estimatedBaseWeightKg": number|null, "confidence":"low|medium|high", "reason":"..."}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify(weightPromptPayload),
          },
          ...imageParts,
        ],
      },
    ],
  }, { taskLabel: isKimiVisionModel(weightModel) ? 'Kimi 重量识别' : 'MiMo 重量识别' });

  const content = completion
    && completion.choices
    && completion.choices[0]
    && completion.choices[0].message
    && completion.choices[0].message.content;
  const payload = parseKimiJsonContent(content);
  const visiblePackageWeightKg = clampGrossWeightKg(
    payload.visiblePackageWeightKg
    || payload.packageWeightKg
    || payload.netWeightKg
    || normalizeWeightUnitToKg(payload.visiblePackageWeightValue, payload.visiblePackageWeightUnit),
    null,
  );
  const estimatedBaseWeightKg = clampGrossWeightKg(
    payload.estimatedBaseWeightKg
    || payload.estimatedGrossWeightKg
    || payload.grossWeightKg
    || payload.weightKg
    || payload.weight,
    null,
  );

  if (visiblePackageWeightKg) {
    return {
      estimatedGrossWeightKg: visiblePackageWeightKg,
      source: 'mimo_package_label_weight',
      confidence: payload.confidence || 'high',
      evidence: payload.reason || 'visible package weight',
      imageUrlCount,
      sourceUrl,
    };
  }

  if (!estimatedBaseWeightKg) {
    return null;
  }

  return {
    estimatedGrossWeightKg: estimatedBaseWeightKg,
    source: 'mimo_vision_estimate',
    confidence: payload.confidence || 'medium',
    evidence: payload.reason || '',
    imageUrlCount,
    sourceUrl,
  };
}

async function estimateGrossWeightWithMimo({
  item = {},
  itemInfo = {},
  site,
  categoryName,
  model,
} = {}) {
  const currentWeightKg = clampGrossWeightKg(itemInfo.weight, null);
  const currentWeightIsTooHigh = isGrossWeightTooHighForDirectUse(currentWeightKg);

  if (currentWeightIsTooHigh) {
    try {
      const visionWeight = await estimateGrossWeightWithMimoVision({
        item,
        itemInfo,
        site,
        categoryName,
        model,
      });
      if (visionWeight && visionWeight.estimatedGrossWeightKg) {
        return visionWeight;
      }
    } catch (error) {
      // Ignore image-weight failures and continue with source/1688 fallbacks.
    }

    try {
      const sourceWeight = await resolve1688GrossWeightForItem({ item, itemInfo });
      if (sourceWeight && sourceWeight.estimatedGrossWeightKg) {
        return sourceWeight;
      }
    } catch (error) {
      // Ignore 1688 lookup failures and continue with existing fallbacks.
    }
  }

  const sourceUrl = extractSourceProductUrl(item, itemInfo);
  if (sourceUrl) {
    try {
      const sourceWeight = await fetchGrossWeightFromSourceUrl(sourceUrl);
      if (sourceWeight && sourceWeight.weightKg) {
        return {
          estimatedGrossWeightKg: sourceWeight.weightKg,
          source: sourceWeight.source,
          confidence: 'high',
          evidence: sourceWeight.evidence,
          sourceUrl,
        };
      }
    } catch (error) {
      // Ignore source-page parsing failures and fall back to vision estimation.
    }
  }

  return estimateGrossWeightWithMimoVision({
    item,
    itemInfo,
    site,
    categoryName,
    model,
  });
}

function buildStableShortId(seed = '') {
  return crypto.createHash('md5').update(String(seed)).digest('hex').slice(0, 10);
}

function normalizeSkuKeyToMultiSpec(oldKey, attrValueId) {
  const valueId = String(attrValueId || '').trim();
  if (!valueId) {
    return String(oldKey || ';;');
  }
  return `;${valueId};`;
}

function ensureSingleSkuAsMultiSpec(itemInfo = {}, skuPropertyList = [], skuMap = {}) {
  const cleanedPropertyList = cleanSkuPropertyList(skuPropertyList);
  const skuEntries = Object.entries(skuMap || {});

  if (skuEntries.length !== 1) {
    return {
      skuPropertyList: cleanedPropertyList,
      skuMap,
      converted: false,
    };
  }

  const [oldSkuKey, oldSkuValue] = skuEntries[0];
  const normalizedKeyBody = String(oldSkuKey || '').replace(/;/g, '').trim();
  const firstProperty = cleanedPropertyList[0];
  const firstValue = firstProperty && Array.isArray(firstProperty.attrValueList)
    ? firstProperty.attrValueList[0]
    : null;
  const existingAttrValueId = normalizeText(firstValue && firstValue.attrValueId);
  const existingAttrValue = normalizeText(firstValue && firstValue.attrValue);
  const hasValidProperty = Boolean(
    normalizeText(firstProperty && firstProperty.attrName)
    && existingAttrValueId
    && existingAttrValue,
  );

  if (hasValidProperty && normalizedKeyBody) {
    return {
      skuPropertyList: cleanedPropertyList,
      skuMap,
      converted: false,
    };
  }

  const generatedAttrValueId = existingAttrValueId || buildStableShortId(
    `${itemInfo.detailId || itemInfo.title || ''}|${oldSkuValue && oldSkuValue.itemNum ? oldSkuValue.itemNum : ''}`,
  );
  const generatedAttrValue = existingAttrValue
    || normalizeText(oldSkuValue && oldSkuValue.itemNum)
    || DEFAULT_SINGLE_SPEC_ATTR_VALUE;
  const attrName = normalizeText(firstProperty && firstProperty.attrName) || DEFAULT_SINGLE_SPEC_ATTR_NAME;
  const normalizedSkuKey = normalizeSkuKeyToMultiSpec(oldSkuKey, generatedAttrValueId);
  const baseImage = oldSkuValue && oldSkuValue.imgUrl
    ? oldSkuValue.imgUrl
    : ((Array.isArray(itemInfo.imgUrls) && itemInfo.imgUrls.length > 0) ? itemInfo.imgUrls[0] : '');

  const normalizedProperty = {
    ...(firstProperty || {}),
    attrId: firstProperty && Object.prototype.hasOwnProperty.call(firstProperty, 'attrId')
      ? firstProperty.attrId
      : null,
    attrName,
    attrValueList: [
      {
        ...(firstValue || {}),
        attrValueId: generatedAttrValueId,
        attrValue: generatedAttrValue,
        ...(baseImage ? { imgUrl: baseImage } : {}),
        supplementarySkuImageUrls: Array.isArray(firstValue && firstValue.supplementarySkuImageUrls)
          ? firstValue.supplementarySkuImageUrls
          : [],
      },
    ],
  };

  return {
    skuPropertyList: [normalizedProperty],
    skuMap: {
      [normalizedSkuKey]: {
        ...oldSkuValue,
      },
    },
    converted: true,
  };
}

function simplifyRedundantSecondSpecDimension(skuPropertyList = [], skuMap = {}) {
  const cleanedPropertyList = cleanSkuPropertyList(skuPropertyList);
  const skuEntries = Object.entries(skuMap || {});

  if (cleanedPropertyList.length < 2 || skuEntries.length === 0) {
    return {
      skuPropertyList: cleanedPropertyList,
      skuMap,
      simplified: false,
      reason: 'not_enough_dimensions_or_empty_skus',
    };
  }

  const secondProperty = cleanedPropertyList[1];
  const secondValueList = Array.isArray(secondProperty && secondProperty.attrValueList)
    ? secondProperty.attrValueList
    : [];

  // 第二规格只有一个固定选项时，通常对用户选择无实际作用，直接降维。
  if (secondValueList.length !== 1) {
    return {
      skuPropertyList: cleanedPropertyList,
      skuMap,
      simplified: false,
      reason: 'second_dimension_has_multiple_values',
    };
  }

  const secondAttrValueId = normalizeText(secondValueList[0] && secondValueList[0].attrValueId);
  if (!secondAttrValueId) {
    return {
      skuPropertyList: cleanedPropertyList,
      skuMap,
      simplified: false,
      reason: 'missing_second_attr_value_id',
    };
  }

  const rebuiltSkuMap = {};
  for (const [oldKey, skuValue] of skuEntries) {
    const tokens = String(oldKey || '')
      .split(';')
      .map((token) => token.trim())
      .filter(Boolean);
    const filteredTokens = tokens.filter((token) => token !== secondAttrValueId);

    if (filteredTokens.length === 0) {
      return {
        skuPropertyList: cleanedPropertyList,
        skuMap,
        simplified: false,
        reason: 'cannot_rebuild_sku_key_after_remove_second_dimension',
      };
    }

    const newKey = `;${filteredTokens.join(';')};`;
    if (Object.prototype.hasOwnProperty.call(rebuiltSkuMap, newKey)) {
      return {
        skuPropertyList: cleanedPropertyList,
        skuMap,
        simplified: false,
        reason: 'sku_key_collision_after_remove_second_dimension',
      };
    }
    rebuiltSkuMap[newKey] = skuValue;
  }

  return {
    skuPropertyList: [
      cleanedPropertyList[0],
      ...cleanedPropertyList.slice(2),
    ],
    skuMap: rebuiltSkuMap,
    simplified: true,
    removedSpec: {
      attrName: normalizeText(secondProperty && secondProperty.attrName),
      attrValue: normalizeText(secondValueList[0] && secondValueList[0].attrValue),
      attrValueId: secondAttrValueId,
    },
  };
}

function buildNormalizedPreparedSpec(itemInfo = {}) {
  const normalizedSingleSpec = ensureSingleSkuAsMultiSpec(
    itemInfo,
    itemInfo.skuPropertyList,
    itemInfo.skuMap,
  );
  return simplifyRedundantSecondSpecDimension(
    normalizedSingleSpec.skuPropertyList,
    normalizedSingleSpec.skuMap,
  );
}

function normalizeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return raw.split('#')[0].split('?')[0].trim();
  }
}

function getImageUrlExtension(url = '') {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  } catch (error) {
    const pathname = raw.split('#')[0].split('?')[0].trim();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }
}

function isMiaoshouSupportedMainImageUrl(url = '') {
  return /^(jpe?g|png)$/i.test(getImageUrlExtension(url));
}

function isLikelyNoisyDetailImageUrl(url = '') {
  const raw = String(url || '');
  return [
    /[?&]__r__=/i,
    /watermark/i,
    /trace/i,
    /x-oss-process/i,
  ].some((pattern) => pattern.test(raw));
}

function shouldForceMainImagesByImageSet(noteImageUrls = [], mainImageUrls = []) {
  const normalizedNotes = dedupeImageUrls(noteImageUrls);
  const normalizedMain = dedupeImageUrls(mainImageUrls);

  if (normalizedMain.length === 0) {
    return false;
  }

  if (normalizedNotes.length === 0) {
    return true;
  }

  // 详情图明显多于主图时，优先使用主图，减少无关素材混入概率。
  if (normalizedNotes.length > Math.max(normalizedMain.length * 2, normalizedMain.length + 6)) {
    return true;
  }

  const noisyCount = noteImageUrls.filter((url) => isLikelyNoisyDetailImageUrl(url)).length;
  const noisyRatio = noteImageUrls.length > 0 ? noisyCount / noteImageUrls.length : 0;

  return noisyRatio >= 0.5;
}

function buildImageOnlyNotesHtml(imageUrls = []) {
  const maxDetailImageCount = Math.min(DEFAULT_DESCRIPTION_IMAGE_COUNT, HARD_MAX_DESCRIPTION_IMAGE_COUNT);
  return dedupeImageUrls(imageUrls)
    .slice(0, maxDetailImageCount)
    .map((url) => `<p><img src="${url}"></p>`)
    .join('\n');
}

function isLikelyIrrelevantImageUrl(url = '') {
  const raw = String(url || '');
  return [
    /O1CN015dbW3f1CHhDi0fQr1/i,
    /O1CN01llVOCf1Bs2tNqzflL/i,
    /O1CN01qJOsBO2E1KWfs7uU8/i,
    /O1CN01K7ftFR2E1KWf2xSK0/i,
    /O1CN01VdF0Vr2E1KWgQzmWY/i,
    /factory|workshop|manufacturer/i,
    /gongchang|chejian|workshopshow|factoryshow|shengchanxian/i,
    /company|aboutus|contact/i,
    /wechat|whatsapp|line[-_]?id/i,
    /banner|poster|promotion|advert/i,
    /coupon|voucher|follow[-_ ]?gift|follow[-_ ]?shop|gift[-_ ]?coupon/i,
    /guanzhu[-_ ]?youli|youhuiquan|lingquan|guanzhu[-_ ]?dianpu|fan[-_ ]?coupon/i,
    /recommend|recommended|hot[-_ ]?items|related[-_ ]?products|shop[-_ ]?recommend/i,
    /dianpu|tuijian|redian|rexiao|guanlian/i,
    /\u5e97\u94fa|\u63a8\u8350|\u70ed\u5356|\u7206\u6b3e|\u5173\u8054\u5546\u54c1|\u642d\u914d\u63a8\u8350/,
    /\u5173\u6ce8\u6709\u793c|\u5173\u6ce8\u5e97\u94fa|\u4f18\u60e0\u5238|\u9886\u5238|\u9996\u5355|\u5143\u4f18\u60e0/,
    /disclaimer|statement|notice|announcement|terms/i,
    /price[-_ ]?notice|about[-_ ]?price|warm[-_ ]?tips|purchase[-_ ]?tips|invoice[-_ ]?notice/i,
    /mianshengming|shengming|goumaixuzhi|wenxintishi|guanyujiage|jiage[-_ ]?shuoming|huaxianjiage|weihuaxianjiage|guanggaofa|guanggao[-_ ]?law|ad[-_ ]?law|legal[-_ ]?statement/i,
    /\u5173\u4e8e\u4ef7\u683c|\u4ef7\u683c\u8bf4\u660e|\u5212\u7ebf\u4ef7\u683c|\u672a\u5212\u7ebf\u4ef7\u683c|\u6e29\u99a8\u63d0\u793a|\u8d2d\u4e70\u9009\u9879|\u5f00\u7968|\u5ba2\u670d|\u9000\u8d27|\u4e0d\u9000\u6362\u8d27|\u5927\u8d27|\u6837\u54c1|\u7ea0\u7eb7|\u614e\u62cd|\u8de8\u5883\u5e73\u53f0|\u5e7f\u544a\u6cd5|\u65b0\u5e7f\u544a\u6cd5|\u58f0\u660e|\u7edd\u5bf9\u5316\u7528\u8bcd|\u529f\u80fd\u6027\u7528\u8bed/,
    /beian|filing|nmpa|export[-_ ]?notice|shop[-_ ]?statement|store[-_ ]?statement/i,
    /\u5e97\u94fa\u58f0\u660e|\u6cd5\u5f8b\u58f0\u660e|\u514d\u8d23\u58f0\u660e|\u91c7\u8d2d\u4e13\u7528|\u6279\u53d1\u91c7\u8d2d|\u81ea\u52a8\u9000\u6b3e|\u4e0d\u542b\u4e2d\u6587|\u56fd\u5185\u9500\u552e|\u5907\u6848|\u56fd\u4ea7\u666e\u901a\u5316\u5986\u54c1|\u836f\u54c1\u76d1\u7763|\u5546\u4e13\u4f9b\u51fa\u53e3|\u4ec5\u4f9b\u8de8\u5883/,
    /oem|odm|cfda|patent|certificate|certificates|import[-_ ]?certificate|procurement|dropship|drop[-_ ]?shipping/i,
    /zhuanli|zhengshu|jinkou|jinkouzhengshu|caigou|daifa|daili|lingfengxian|shiti[-_ ]?fahuo|pinpai[-_ ]?jiagong/i,
    /\u4e13\u5229|\u8bc1\u4e66|\u8fdb\u53e3\u8bc1\u4e66|\u5907\u6848\u901f\u5ea6|\u8bbe\u8ba1\u901f\u5ea6|\u51fa\u8d27\u901f\u5ea6|\u4e00\u7ad9\u5f0f\u91c7\u8d2d|\u4ee3\u53d1|\u7f51\u7edc\u4ee3\u9500|\u54c1\u724c\u4ee3\u52a0\u5de5|\u6210\u719f\u76840\u98ce\u9669\u5546\u4e1a\u6a21\u5f0f|\u8d85\u7ea7\u5de5\u5382|\u5de5\u5382\u5b9e\u529b|\u5382\u623f\u9762\u79ef|\u516c\u53f8\u5458\u5de5|\u751f\u4ea7\u7ebf|\u6708\u4ea7\u91cf|\u751f\u4ea7\u7ecf\u9a8c|\u4ea7\u54c1\u6b3e\u5f0f|\u7814\u53d1\u8f66\u95f4|\u751f\u4ea7\u8f66\u95f4|\u52a0\u5de5\u8f66\u95f4/,
    /factory[-_ ]?(building|exterior|campus|tour|photo)|workshop[-_ ]?(photo|interior|scene)|production[-_ ]?(workshop|room|base)|source[-_ ]?factory|cross[-_ ]?border[-_ ]?factory/i,
    /pinpai[-_ ]?shouquan|brand[-_ ]?authorization|authorized[-_ ]?brand|platform[-_ ]?authorization|quanbu[-_ ]?shouquan|qixia[-_ ]?pinpai|kuajing[-_ ]?yuantou[-_ ]?changjia|waimao[-_ ]?kuajing/i,
    /jingdong|taobao|tmall|pinduoduo|douyin|kuaishou|amazon|aliexpress|lazada|shopee|ebay|wish/i,
    /\u5382\u623f\u5916\u89c2|\u5de5\u5382\u5916\u89c2|\u5382\u533a|\u5382\u623f\u5b9e\u62cd|\u8f66\u95f4\u5b9e\u62cd|\u751f\u4ea7\u8f66\u95f4\u5b9e\u62cd|\u751f\u4ea7\u57fa\u5730|\u751f\u4ea7\u73af\u5883/,
    /\u65d7\u4e0b\u54c1\u724c|\u54c1\u724c\u6388\u6743|\u5747\u53ef\u6388\u6743|\u53ef\u6388\u6743|\u5e73\u53f0\u6388\u6743|\u5916\u8d38\u8de8\u5883|\u54c1\u6e90\u5934\u5382\u5bb6|\u6e90\u5934\u5382\u5bb6|\u5168\u82f1\u6587\u7248|\u5c0f\u6279\u91cf|\u8d34\u724c|\u4ee3\u52a0\u5de5|\u5b9a\u5236/,
    /\u4eac\u4e1c|\u6dd8\u5b9d|\u5929\u732b|\u62fc\u591a\u591a|\u6296\u97f3|\u5feb\u624b|\u4e9a\u9a6c\u900a|\u901f\u5356\u901a|\u56fd\u9645\u963f\u91cc/,
    /porn|nsfw|erotic|explicit[-_ ]?nudity|adult[-_ ]?content|sex[-_ ]?toy|sexy[-_ ]?lingerie|lingerie[-_ ]?sexy|naked[-_ ]?girl|xxx/i,
    /qingqu|chengren|xingyongpin|seqing|luodian|luoluo|luozhao|feijibei|tiaodan|zhendongbang|ziwei|biyeyuntao/i,
    /\u8272\u60c5|\u6210\u4eba\u7528\u54c1|\u60c5\u8da3\u7528\u54c1|\u60c5\u8da3|\u6027\u7528\u54c1|\u88f8\u9732|\u88f8\u7167|\u9732\u70b9|\u6027\u7231|\u6027\u6697\u793a|\u98de\u673a\u676f|\u8df3\u86cb|\u9707\u52a8\u68d2|\u81ea\u6170|\u907f\u5b55\u5957|\u4f4e\u4fd7/,
    /certificate|certification/i,
    /hot[-_ ]?sale|best[-_ ]?seller/i,
    /logo/i,
  ].some((pattern) => pattern.test(raw));
}

async function downloadImageBuffer(url, {
  timeoutMs = DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
  maxBytes = DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES,
} = {}) {
  if (!url) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/^image\//i.test(contentType)) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || (maxBytes && buffer.length > maxBytes)) {
      return null;
    }

    return {
      buffer,
      contentType,
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function analyzeBmpForDisclaimer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') {
    return {
      isIrrelevant: false,
      reason: 'not_bmp',
    };
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitsPerPixel = buffer.readUInt16LE(28);

  if (width <= 0 || height <= 0 || bitsPerPixel !== 24) {
    return {
      isIrrelevant: false,
      reason: 'unsupported_bmp',
    };
  }

  const stride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  let yellowPixels = 0;
  let blackPixels = 0;
  let whitePixels = 0;
  let redPixels = 0;
  let tealPixels = 0;
  let grayLinePixels = 0;
  let lightMachineryPixels = 0;
  let goldTextPixels = 0;
  let blueTextPixels = 0;
  let topBandBluePixels = 0;
  let topBandRedPixels = 0;
  let topBandWhitePixels = 0;
  let topBandPixels = 0;
  let topTitleDarkPixels = 0;
  let topTitlePixels = 0;
  let lowerPanelTextPixels = 0;
  let lowerPanelPixels = 0;
  let whitePanelTextPixels = 0;
  let whitePanelPixels = 0;
  let sampledPixels = 0;
  const quadrantColorBuckets = [new Set(), new Set(), new Set(), new Set()];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 400));

  for (let y = 0; y < height; y += step) {
    const rowOffset = pixelOffset + (rawHeight > 0 ? (height - 1 - y) : y) * stride;
    for (let x = 0; x < width; x += step) {
      const offset = rowOffset + x * 3;
      const blue = buffer[offset];
      const green = buffer[offset + 1];
      const red = buffer[offset + 2];

      sampledPixels += 1;
      if (red > 185 && green > 165 && blue < 145) {
        yellowPixels += 1;
      }
      if (red < 80 && green < 80 && blue < 80) {
        blackPixels += 1;
      }
      if (red > 230 && green > 230 && blue > 230) {
        whitePixels += 1;
      }
      if (red > 170 && green < 95 && blue < 95) {
        redPixels += 1;
      }
      if (green > 80 && blue > 80 && red < 95 && green >= red + 30) {
        tealPixels += 1;
      }
      const isGoldTextPixel = red >= 135
        && green >= 95
        && green <= 185
        && blue <= 140
        && red >= blue + 30;
      const isBlueTextPixel = blue >= 85
        && red <= 160
        && green <= 170
        && blue >= red + 8;
      const isDarkTextPixel = red <= 120 && green <= 120 && blue <= 140;
      if (isGoldTextPixel) {
        goldTextPixels += 1;
      }
      if (isBlueTextPixel) {
        blueTextPixels += 1;
      }
      if (
        Math.abs(red - green) < 18
        && Math.abs(red - blue) < 18
        && red >= 125
        && red <= 225
      ) {
        grayLinePixels += 1;
      }
      if (
        red > 155
        && green > 155
        && blue > 155
        && Math.abs(red - green) < 45
        && Math.abs(red - blue) < 45
      ) {
        lightMachineryPixels += 1;
      }
      if (y < height * 0.28) {
        topBandPixels += 1;
        if (blue > 135 && green > 80 && red < 105 && blue >= red + 40) {
          topBandBluePixels += 1;
        }
        if (red > 145 && green < 95 && blue < 105) {
          topBandRedPixels += 1;
        }
        if (red > 220 && green > 220 && blue > 220) {
          topBandWhitePixels += 1;
        }
      }
      if (
        y >= height * 0.06
        && y <= height * 0.34
        && x >= width * 0.12
        && x <= width * 0.88
      ) {
        topTitlePixels += 1;
        if (isDarkTextPixel || isGoldTextPixel || isBlueTextPixel) {
          topTitleDarkPixels += 1;
        }
      }
      if (
        y >= height * 0.36
        && y <= height * 0.94
        && x >= width * 0.12
        && x <= width * 0.88
      ) {
        lowerPanelPixels += 1;
        if (isGoldTextPixel || isBlueTextPixel || isDarkTextPixel) {
          lowerPanelTextPixels += 1;
        }
      }
      if (
        y >= height * 0.12
        && y <= height * 0.94
        && x >= width * 0.08
        && x <= width * 0.92
      ) {
        whitePanelPixels += 1;
        if (isGoldTextPixel || isBlueTextPixel || isDarkTextPixel || (red > 160 && green < 90 && blue < 100)) {
          whitePanelTextPixels += 1;
        }
      }

      const quadrantIndex = (x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0);
      const colorBucket = `${Math.floor(red / 48)}-${Math.floor(green / 48)}-${Math.floor(blue / 48)}`;
      quadrantColorBuckets[quadrantIndex].add(colorBucket);
    }
  }

  const yellowRatio = sampledPixels > 0 ? yellowPixels / sampledPixels : 0;
  const blackRatio = sampledPixels > 0 ? blackPixels / sampledPixels : 0;
  const whiteRatio = sampledPixels > 0 ? whitePixels / sampledPixels : 0;
  const redRatio = sampledPixels > 0 ? redPixels / sampledPixels : 0;
  const tealRatio = sampledPixels > 0 ? tealPixels / sampledPixels : 0;
  const grayLineRatio = sampledPixels > 0 ? grayLinePixels / sampledPixels : 0;
  const lightMachineryRatio = sampledPixels > 0 ? lightMachineryPixels / sampledPixels : 0;
  const goldTextRatio = sampledPixels > 0 ? goldTextPixels / sampledPixels : 0;
  const blueTextRatio = sampledPixels > 0 ? blueTextPixels / sampledPixels : 0;
  const topBandBlueRatio = topBandPixels > 0 ? topBandBluePixels / topBandPixels : 0;
  const topBandRedRatio = topBandPixels > 0 ? topBandRedPixels / topBandPixels : 0;
  const topBandWhiteRatio = topBandPixels > 0 ? topBandWhitePixels / topBandPixels : 0;
  const topTitleDarkRatio = topTitlePixels > 0 ? topTitleDarkPixels / topTitlePixels : 0;
  const lowerPanelTextRatio = lowerPanelPixels > 0 ? lowerPanelTextPixels / lowerPanelPixels : 0;
  const whitePanelTextRatio = whitePanelPixels > 0 ? whitePanelTextPixels / whitePanelPixels : 0;
  const quadrantDiversity = quadrantColorBuckets
    .filter((bucketSet) => bucketSet.size >= 18)
    .length;
  const looksLikeYellowTextNotice = (
    width >= 500
    && height >= 500
    && yellowRatio >= 0.25
    && blackRatio >= 0.035
    && whiteRatio <= 0.25
  );
  const looksLikeShopRecommendationGrid = (
    width >= 600
    && height >= 600
    && whiteRatio >= 0.35
    && blackRatio >= 0.035
    && grayLineRatio >= 0.05
    && redRatio >= 0.005
    && quadrantDiversity >= 4
  );
  const looksLikeFactoryWorkshopPanel = (
    width >= 600
    && height >= 600
    && tealRatio >= 0.12
    && lightMachineryRatio >= 0.38
    && whiteRatio >= 0.18
    && (redRatio >= 0.01 || topBandRedRatio >= 0.03)
  );
  const looksLikeRedLegalStatementPanel = (
    width >= 500
    && height >= 500
    && redRatio >= 0.16
    && topBandRedRatio >= 0.24
    && topBandWhiteRatio >= 0.025
    && whiteRatio >= 0.10
    && lowerPanelTextRatio >= 0.018
    && (goldTextRatio >= 0.006 || blueTextRatio >= 0.006 || lowerPanelTextRatio >= 0.04)
  );
  const looksLikeRedDisclaimerCardPanel = (
    width >= 500
    && height >= 500
    && redRatio >= 0.25
    && lightMachineryRatio >= 0.075
    && blackRatio >= 0.008
    && whiteRatio <= 0.08
    && topBandRedRatio >= 0.45
    && lowerPanelTextRatio >= 0.07
    && whitePanelTextRatio >= 0.16
    && quadrantDiversity >= 3
  );
  const looksLikeRedCouponBanner = (
    width >= 450
    && height >= 180
    && width / height >= 1.5
    && redRatio >= 0.45
    && whiteRatio >= 0.035
    && yellowRatio >= 0.004
    && blackRatio <= 0.08
    && whitePanelTextRatio >= 0.25
    && quadrantDiversity >= 3
  );
  const looksLikePastelStatementPanel = (
    width >= 600
    && height >= 600
    && (whiteRatio >= 0.34 || lightMachineryRatio >= 0.62)
    && blackRatio >= 0.025
    && redRatio <= 0.035
    && topTitleDarkRatio >= 0.08
    && lowerPanelTextRatio >= 0.025
    && quadrantDiversity <= 4
  );
  const looksLikeLightTextNoticePanel = (
    width >= 500
    && height >= 500
    && lightMachineryRatio >= 0.84
    && whiteRatio <= 0.18
    && blackRatio >= 0.018
    && redRatio <= 0.025
    && topTitleDarkRatio >= 0.035
    && lowerPanelTextRatio >= 0.055
    && whitePanelTextRatio >= 0.045
    && quadrantDiversity <= 3
  );
  const looksLikeWideTextNoticePanel = (
    width >= 450
    && height >= 100
    && width / height >= 2.2
    && whiteRatio >= 0.55
    && blackRatio >= 0.035
    && redRatio >= 0.003
    && topTitleDarkRatio >= 0.08
    && whitePanelTextRatio >= 0.08
    && quadrantDiversity <= 2
  );
  const looksLikeRedTextReturnNoticePanel = (
    width >= 450
    && height >= 250
    && whiteRatio >= 0.55
    && redRatio >= 0.025
    && redRatio <= 0.12
    && blackRatio <= 0.02
    && lightMachineryRatio >= 0.70
    && lowerPanelTextRatio >= 0.025
    && whitePanelTextRatio >= 0.07
    && quadrantDiversity <= 4
  );
  const looksLikeBlackLegalStatementPanel = (
    width >= 450
    && height >= 280
    && blackRatio >= 0.75
    && grayLineRatio >= 0.05
    && (yellowRatio >= 0.0008 || whiteRatio >= 0.003)
  );
  const looksLikeWhiteStoreStatementPanel = (
    width >= 600
    && height >= 450
    && whiteRatio >= 0.45
    && blackRatio >= 0.008
    && redRatio >= 0.006
    && (goldTextRatio >= 0.006 || grayLineRatio >= 0.02)
    && whitePanelTextRatio >= 0.035
  );
  const looksLikeGovernmentFilingScreenshot = (
    width >= 700
    && height >= 450
    && topBandBlueRatio >= 0.18
    && whiteRatio >= 0.65
    && topTitleDarkRatio >= 0.10
    && whitePanelTextRatio >= 0.025
  );
  const looksLikeBlueServiceCapabilityPoster = (
    width >= 500
    && height >= 600
    && topBandBlueRatio >= 0.25
    && (tealRatio >= 0.18 || blueTextRatio >= 0.18)
    && topTitleDarkRatio >= 0.18
    && lowerPanelTextRatio >= 0.12
    && whitePanelTextRatio >= 0.12
  );
  const looksLikeCertificateGridPoster = (
    width >= 500
    && height >= 500
    && whiteRatio >= 0.50
    && goldTextRatio >= 0.015
    && grayLineRatio >= 0.04
    && topTitleDarkRatio >= 0.08
    && lowerPanelTextRatio >= 0.035
  );
  const looksLikeBusinessModePoster = (
    width >= 500
    && height >= 600
    && whiteRatio >= 0.20
    && blackRatio >= 0.035
    && topTitleDarkRatio >= 0.12
    && lowerPanelTextRatio >= 0.12
    && whitePanelTextRatio >= 0.16
    && (redRatio >= 0.02 || blueTextRatio >= 0.06 || goldTextRatio >= 0.015)
  );
  const looksLikeFactoryOemPoster = (
    width >= 500
    && height >= 650
    && lightMachineryRatio >= 0.35
    && blueTextRatio >= 0.06
    && blackRatio >= 0.035
    && topTitleDarkRatio >= 0.06
    && lowerPanelTextRatio >= 0.16
    && whitePanelTextRatio >= 0.14
  );
  const looksLikeFactoryStatsWorkshopPanel = (
    width >= 600
    && height >= 250
    && blackRatio >= 0.28
    && grayLineRatio >= 0.08
    && lightMachineryRatio >= 0.35
    && topTitleDarkRatio >= 0.18
    && lowerPanelTextRatio >= 0.25
    && whitePanelTextRatio >= 0.25
    && quadrantDiversity >= 3
  );

  let reason = 'image_policy_passed';
  if (looksLikeYellowTextNotice) {
    reason = `yellow_text_notice yellow=${yellowRatio.toFixed(3)} black=${blackRatio.toFixed(3)} white=${whiteRatio.toFixed(3)}`;
  } else if (looksLikeShopRecommendationGrid) {
    reason = `shop_recommendation_grid white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} red=${redRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)}`;
  } else if (looksLikeFactoryWorkshopPanel) {
    reason = `factory_workshop_panel teal=${tealRatio.toFixed(3)} red=${redRatio.toFixed(3)} topRed=${topBandRedRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)}`;
  } else if (looksLikeRedLegalStatementPanel) {
    reason = `red_legal_statement_panel red=${redRatio.toFixed(3)} topRed=${topBandRedRatio.toFixed(3)} topWhite=${topBandWhiteRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeRedDisclaimerCardPanel) {
    reason = `red_disclaimer_card_panel red=${redRatio.toFixed(3)} topRed=${topBandRedRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeRedCouponBanner) {
    reason = `red_coupon_banner red=${redRatio.toFixed(3)} white=${whiteRatio.toFixed(3)} yellow=${yellowRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikePastelStatementPanel) {
    reason = `pastel_statement_panel white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} title=${topTitleDarkRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeLightTextNoticePanel) {
    reason = `light_text_notice_panel light=${lightMachineryRatio.toFixed(3)} black=${blackRatio.toFixed(3)} title=${topTitleDarkRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeWideTextNoticePanel) {
    reason = `wide_text_notice_panel white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} red=${redRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeRedTextReturnNoticePanel) {
    reason = `red_text_return_notice_panel white=${whiteRatio.toFixed(3)} red=${redRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeBlackLegalStatementPanel) {
    reason = `black_legal_statement_panel black=${blackRatio.toFixed(3)} white=${whiteRatio.toFixed(3)} yellow=${yellowRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeWhiteStoreStatementPanel) {
    reason = `white_store_statement_panel white=${whiteRatio.toFixed(3)} red=${redRatio.toFixed(3)} gold=${goldTextRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeGovernmentFilingScreenshot) {
    reason = `government_filing_screenshot topBlue=${topBandBlueRatio.toFixed(3)} white=${whiteRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)} black=${blackRatio.toFixed(3)}`;
  } else if (looksLikeBlueServiceCapabilityPoster) {
    reason = `blue_service_capability_poster topBlue=${topBandBlueRatio.toFixed(3)} teal=${tealRatio.toFixed(3)} blue=${blueTextRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeCertificateGridPoster) {
    reason = `certificate_grid_poster white=${whiteRatio.toFixed(3)} gold=${goldTextRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)} title=${topTitleDarkRatio.toFixed(3)}`;
  } else if (looksLikeBusinessModePoster) {
    reason = `business_mode_poster white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} red=${redRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeFactoryOemPoster) {
    reason = `factory_oem_poster light=${lightMachineryRatio.toFixed(3)} blue=${blueTextRatio.toFixed(3)} black=${blackRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeFactoryStatsWorkshopPanel) {
    reason = `factory_stats_workshop_panel black=${blackRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  }

  return {
    isIrrelevant: looksLikeYellowTextNotice
      || looksLikeShopRecommendationGrid
      || looksLikeFactoryWorkshopPanel
      || looksLikeRedLegalStatementPanel
      || looksLikeRedDisclaimerCardPanel
      || looksLikeRedCouponBanner
      || looksLikePastelStatementPanel
      || looksLikeLightTextNoticePanel
      || looksLikeWideTextNoticePanel
      || looksLikeRedTextReturnNoticePanel
      || looksLikeBlackLegalStatementPanel
      || looksLikeWhiteStoreStatementPanel
      || looksLikeGovernmentFilingScreenshot
      || looksLikeBlueServiceCapabilityPoster
      || looksLikeCertificateGridPoster
      || looksLikeBusinessModePoster
      || looksLikeFactoryOemPoster
      || looksLikeFactoryStatsWorkshopPanel,
    reason,
    yellowRatio,
    blackRatio,
    whiteRatio,
    redRatio,
    tealRatio,
    grayLineRatio,
    lightMachineryRatio,
    goldTextRatio,
    blueTextRatio,
    topBandBlueRatio,
    topBandRedRatio,
    topBandWhiteRatio,
    topTitleDarkRatio,
    lowerPanelTextRatio,
    whitePanelTextRatio,
    quadrantDiversity,
  };
}

async function detectDisclaimerImageByContent(url = '') {
  if (!ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK || !fs.existsSync('/usr/bin/sips')) {
    return null;
  }

  const downloaded = await downloadImageBuffer(url, {
    timeoutMs: DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
    maxBytes: DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES,
  });
  if (!downloaded) {
    return null;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autojs-image-policy-'));
  const sourcePath = path.join(tempDir, 'source-image.jpg');
  const bmpPath = path.join(tempDir, 'source-image.bmp');

  try {
    fs.writeFileSync(sourcePath, downloaded.buffer);
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'bmp', sourcePath, '--out', bmpPath], {
      timeout: DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
    });
    const bmpBuffer = fs.readFileSync(bmpPath);
    return analyzeBmpForDisclaimer(bmpBuffer);
  } catch (error) {
    return null;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildLocalImagePolicyVerdictMap(imageUrls = []) {
  const verdictMap = new Map();
  const allUniqueUrls = uniqueUrlList(imageUrls);
  const uniqueUrls = [];
  const appendUrl = (url) => {
    const normalizedUrl = normalizeImageUrl(url);
    if (!normalizedUrl || uniqueUrls.includes(normalizedUrl)) {
      return;
    }
    if (uniqueUrls.length < DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT) {
      uniqueUrls.push(normalizedUrl);
    }
  };
  const headLimit = Math.max(1, Math.ceil(DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT * 0.6));
  for (let index = 0; index < allUniqueUrls.length && uniqueUrls.length < headLimit; index += 1) {
    appendUrl(allUniqueUrls[index]);
  }
  for (let index = allUniqueUrls.length - 1; index >= 0 && uniqueUrls.length < DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT; index -= 1) {
    appendUrl(allUniqueUrls[index]);
  }

  for (const url of uniqueUrls) {
    const normalizedUrl = normalizeImageUrl(url);
    if (!normalizedUrl) {
      continue;
    }

    if (isLikelyIrrelevantImageUrl(normalizedUrl)) {
      verdictMap.set(normalizedUrl, {
        isRelevant: false,
        reason: 'irrelevant_url_pattern',
      });
      continue;
    }

    const contentVerdict = await detectDisclaimerImageByContent(normalizedUrl);
    if (contentVerdict) {
      verdictMap.set(normalizedUrl, {
        isRelevant: !contentVerdict.isIrrelevant,
        reason: contentVerdict.reason,
        visualProfile: contentVerdict,
      });
    }
  }

  return verdictMap;
}

async function buildImageRelevanceMapWithMimo({
  imageUrls = [],
  title = '',
  categoryName = DEFAULT_CATEGORY_NAME,
  model = '',
} = {}) {
  const verdictMap = await buildLocalImagePolicyVerdictMap(imageUrls);
  const auditModel = getImageAuditModel(model);

  if (!ENABLE_MIMO_IMAGE_RELEVANCE_CHECK) {
    return verdictMap;
  }
  if (isKimiVisionModel(auditModel) ? !hasKimiApiKey() : !hasMimoApiKey()) {
    return verdictMap;
  }

  const uniqueUrls = uniqueUrlList(imageUrls);
  const candidateUrls = [];
  const appendCandidate = (url) => {
    const normalized = normalizeImageUrl(url);
    if (!normalized) {
      return;
    }
    if (candidateUrls.includes(normalized)) {
      return;
    }
    if (candidateUrls.length >= DEFAULT_IMAGE_RELEVANCE_MAX_CHECK_COUNT) {
      return;
    }
    candidateUrls.push(normalized);
  };
  const headLimit = Math.max(1, Math.min(
    uniqueUrls.length,
    Math.ceil(DEFAULT_IMAGE_RELEVANCE_MAX_CHECK_COUNT * 0.6),
  ));
  for (let index = 0; index < headLimit; index += 1) {
    appendCandidate(uniqueUrls[index]);
  }
  for (let index = uniqueUrls.length - 1; index >= 0; index -= 1) {
    appendCandidate(uniqueUrls[index]);
    if (candidateUrls.length >= DEFAULT_IMAGE_RELEVANCE_MAX_CHECK_COUNT) {
      break;
    }
  }
  if (candidateUrls.length === 0) {
    return verdictMap;
  }

  const imageSamples = [];
  for (const imageUrl of candidateUrls) {
    try {
      const dataUrl = await downloadImageAsDataUrl(imageUrl);
      if (!dataUrl) {
        continue;
      }
      imageSamples.push({ imageUrl, dataUrl });
    } catch (error) {
      continue;
    }
  }

  if (imageSamples.length === 0) {
    return verdictMap;
  }

  const userContent = [
    {
      type: 'text',
      text: JSON.stringify({
        productTitle: normalizeOptimizedTitle(title, DEFAULT_TITLE_MAX_LENGTH),
        categoryName,
        instruction: 'Judge whether each image is truly related to the product itself.',
      }),
    },
  ];

  imageSamples.forEach((sample, index) => {
    userContent.push({
      type: 'text',
      text: `Image #${index + 1} URL: ${sample.imageUrl}`,
    });
    userContent.push({
      type: 'image_url',
      image_url: { url: sample.dataUrl },
    });
  });

  try {
    const completion = await createVisionChatCompletion({
      model: auditModel,
      temperature: DEFAULT_MIMO_TEMPERATURE,
      messages: [
        {
          role: 'system',
          content: [
            'You are an ecommerce image quality inspector.',
            'Mark image as irrelevant if it is factory/company promotion, contact info, certificate, pure poster/banner, disclaimer/legal statement, purchase notice, or unrelated object.',
            'Mark image as irrelevant if it is a marketing coupon/follow-us banner, such as 关注有礼, 关注店铺, 优惠券, 领券立减, or first-order coupon.',
            'If image mainly shows long text paragraphs, disclaimer text (e.g., 免责声明/免责说明), price notice (e.g., 关于价格/划线价格), warm tips (e.g., 温馨提示/开票/客服/购买选项), no-return/bulk-order notice (e.g., 不支持退货/大货/介意者慎拍/纠纷), export notice, cross-border procurement notice (e.g., 采购专用链接/批发采购/自动退款/不含中文/国内销售), or policy statement, mark it as irrelevant.',
            'Mark image as irrelevant if it shows 店铺声明, 法律声明, 关于新广告法声明, 特此声明, 国产普通化妆品备案信息, NMPA/国家药品监督备案 screenshots, or any statement saying products are only for cross-border/export use.',
            'Mark image as irrelevant if it is a supplier capability poster, OEM/ODM factory poster, certificate/patent/import certificate wall, CFDA/certification poster, one-stop procurement/dropshipping/network agency poster, or business model/zero-risk cooperation advertisement.',
            'Mark image as irrelevant if it shows factory workshop, production line, machinery, warehouse scene, factory statistics, company employee count, monthly output, production experience, or manufacturing environment (for example 工厂车间展示/厂房面积/公司员工/月产量).',
            'Mark image as irrelevant if it is a real factory exterior, office/factory building, factory campus, workshop interior photo, production room photo, warehouse/packing line photo, or any supplier/factory environment photo that does not mainly show the sellable product.',
            'Mark image as irrelevant if it mainly shows ecommerce platform logos, brand authorization text, authorized brand/platform badges, or cross-border source-factory banners (for example 旗下品牌均可授权, 外贸跨境品源头厂家, Amazon/AliExpress/Lazada/Shopee/eBay/Wish/Taobao/Tmall/JD/Pinduoduo/Douyin/Kuaishou logo rows).',
            'Mark image as irrelevant if it contains pornographic/adult/NSFW content, explicit nudity, sexualized poses, sex toys, erotic lingerie display, or sexually suggestive imagery. Do not remove ordinary non-explicit product usage images only because they show skin, clothing, swimwear, or a cosmetic nude-color shade.',
            'Return JSON only.',
            'Schema: {"items":[{"index":1,"url":"...","isRelevant":true/false,"reason":"..."}]}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }, { taskLabel: isKimiVisionModel(auditModel) ? 'Kimi 图片审核' : 'MiMo 图片审核' });

    const content = completion
      && completion.choices
      && completion.choices[0]
      && completion.choices[0].message
      && completion.choices[0].message.content;
    const payload = parseKimiJsonContent(content);
    const items = Array.isArray(payload.items)
      ? payload.items
      : (Array.isArray(payload.images) ? payload.images : []);

    for (const item of items) {
      const idx = parsePositiveInteger(item.index, null);
      const indexedUrl = idx && imageSamples[idx - 1] ? imageSamples[idx - 1].imageUrl : '';
      const normalizedUrl = normalizeImageUrl(item.url || item.imageUrl || indexedUrl);
      if (!normalizedUrl) {
        continue;
      }

      const isRelevant = parseBooleanOrNull(item.isRelevant);
      const isPromo = parseBooleanOrNull(item.isPromo);
      const existingVerdict = verdictMap.get(normalizedUrl) || {};
      verdictMap.set(normalizedUrl, {
        ...existingVerdict,
        isRelevant: isRelevant !== null
          ? isRelevant
          : (isPromo !== null ? !isPromo : null),
        reason: String(item.reason || item.desc || ''),
      });
    }
  } catch (error) {
    return verdictMap;
  }

  return verdictMap;
}

function decideImageRelevant(url = '', verdictMap = new Map()) {
  const normalizedUrl = normalizeImageUrl(url);
  const verdict = normalizedUrl ? verdictMap.get(normalizedUrl) : null;

  if (verdict && typeof verdict.isRelevant === 'boolean') {
    return verdict.isRelevant;
  }

  if (isLikelyNoisyDetailImageUrl(url) || isLikelyIrrelevantImageUrl(url)) {
    return false;
  }

  return true;
}

function strictShouldUseMainImagesForNotes(notes = '') {
  return [
    /跨境热卖/,
    /海外商机/,
    /已售[:：]/,
    /工厂|厂家|宣传|联系/i,
    /关注有礼|关注店铺|优惠券|领券|首单|领券立减|粉丝/,
    /广告法|新广告法|绝对化用词|功能性用语|不作为赔付理由|赔付理由|页面声明/,
    /关于价格|价格说明|划线价格|未划线价格|活动预热|温馨提示|开票|购买选项|联系客服|客服咨询|订购|退货|不退换货|大货|样品|纠纷|慎拍|跨境平台|免责说明|采购专用|批发采购|自动退款|不含中文|国内销售/,
    /特此声明|店铺声明|法律声明|商专供出口|仅供跨境|国产普通化妆品备案|国家药品监督|NMPA/i,
    /OEM|ODM|CFDA|专利|证书|进口证书|一站式采购|代发|网络代销|品牌代加工|零风险商业模式|超级工厂|工厂实力|备案速度|设计速度|出货速度/i,
    /厂房面积|公司员工|生产线|月产量|生产经验|产品款式|研发车间|生产车间|加工车间/,
    /厂房外观|工厂外观|厂区|厂房实拍|车间实拍|生产车间实拍|生产基地|生产环境|仓库实拍/,
    /旗下品牌|品牌授权|均可授权|可授权|平台授权|外贸跨境|品源头厂家|源头厂家|全英文版|小批量|贴牌|代加工|定制/,
    /京东|淘宝|天猫|拼多多|抖音|快手|亚马逊|速卖通|Lazada|Shopee|eBay|Wish|国际阿里/i,
    /色情|成人用品|情趣用品|性用品|裸露|裸照|露点|性爱|性暗示|飞机杯|跳蛋|震动棒|自慰|避孕套|低俗/,
    /porn|nsfw|erotic|explicit\s+nudity|adult\s+content|sex\s+toy|sexy\s+lingerie/i,
    /\u5de5\u5382\u8f66\u95f4\u5c55\u793a/,
    /factory\s*workshop|production\s*line|manufacturing\s*process/i,
    /facemask/i,
    /LAIKOUFENYIQUIYUM/i,
  ].some((pattern) => pattern.test(String(notes || '')));
}

function buildStrictCleanImagePlan(itemInfo = {}, verdictMap = new Map()) {
  const maxDetailImageCount = Math.min(DEFAULT_DESCRIPTION_IMAGE_COUNT, HARD_MAX_DESCRIPTION_IMAGE_COUNT);
  const notes = String(itemInfo.notes || '');
  const originalNoteImageUrls = dedupeImageUrls(extractImageUrlsFromNotes(notes));
  const originalMainImageUrls = dedupeImageUrls(Array.isArray(itemInfo.imgUrls) ? itemInfo.imgUrls : []);
  const supportedOriginalMainImageUrls = originalMainImageUrls
    .filter((url) => isMiaoshouSupportedMainImageUrl(url));
  const supportedOriginalNoteImageUrls = originalNoteImageUrls
    .filter((url) => isMiaoshouSupportedMainImageUrl(url));
  const filteredMainImageUrls = supportedOriginalMainImageUrls
    .filter((url) => decideImageRelevant(url, verdictMap));
  const filteredNoteImageUrls = originalNoteImageUrls
    .filter((url) => decideImageRelevant(url, verdictMap));
  const supportedFilteredNoteImageUrls = filteredNoteImageUrls
    .filter((url) => isMiaoshouSupportedMainImageUrl(url));
  const relevantMainPool = dedupeImageUrls([...filteredMainImageUrls, ...supportedFilteredNoteImageUrls]);

  let mainImageUrls = filteredMainImageUrls.length > 0
    ? filteredMainImageUrls
    : (relevantMainPool.length > 0 ? relevantMainPool : supportedOriginalMainImageUrls);
  if (mainImageUrls.length === 0) {
    mainImageUrls = supportedOriginalNoteImageUrls;
  }

  const supplementMainPool = dedupeImageUrls([
    ...supportedOriginalMainImageUrls,
    ...supportedFilteredNoteImageUrls,
    ...supportedOriginalNoteImageUrls,
  ]);
  for (const url of supplementMainPool) {
    if (mainImageUrls.length >= DEFAULT_MIN_MAIN_IMAGE_COUNT) {
      break;
    }
    if (!mainImageUrls.includes(url) && decideImageRelevant(url, verdictMap)) {
      mainImageUrls.push(url);
    }
  }
  mainImageUrls = dedupeImageUrls(mainImageUrls)
    .filter((url) => isMiaoshouSupportedMainImageUrl(url))
    .slice(0, DEFAULT_MAIN_IMAGE_COUNT);
  if (mainImageUrls.length === 0) {
    throw new Error('没有可用的 JPG/JPEG/PNG 主图，已停止保存该商品。');
  }

  let detailImageUrls = strictShouldUseMainImagesForNotes(notes)
    || shouldForceMainImagesByImageSet(originalNoteImageUrls, mainImageUrls)
    ? [...mainImageUrls]
    : filteredNoteImageUrls;

  if (detailImageUrls.length === 0) {
    detailImageUrls = filteredMainImageUrls.length > 0
      ? [...filteredMainImageUrls]
      : [...mainImageUrls];
  }

  const supplementDetailPool = dedupeImageUrls([
    ...filteredNoteImageUrls,
    ...mainImageUrls,
  ]);
  for (const url of supplementDetailPool) {
    if (detailImageUrls.length >= DEFAULT_MIN_DETAIL_IMAGE_COUNT) {
      break;
    }
    if (!detailImageUrls.includes(url) && decideImageRelevant(url, verdictMap)) {
      detailImageUrls.push(url);
    }
  }

  detailImageUrls = dedupeImageUrls(detailImageUrls)
    .slice(0, maxDetailImageCount);

  return {
    mainImageUrls,
    detailImageUrls,
    removedMainImageCount: Math.max(0, originalMainImageUrls.length - mainImageUrls.length),
    removedDetailImageCount: Math.max(0, originalNoteImageUrls.length - detailImageUrls.length),
  };
}

function getImagePolicyVerdict(url = '', verdictMap = new Map()) {
  const normalizedUrl = normalizeImageUrl(url);
  return normalizedUrl && verdictMap instanceof Map ? verdictMap.get(normalizedUrl) : null;
}

function getImageWhiteRatio(url = '', verdictMap = new Map()) {
  const verdict = getImagePolicyVerdict(url, verdictMap);
  const visualProfile = verdict && verdict.visualProfile ? verdict.visualProfile : verdict;
  return parsePositiveNumber(visualProfile && visualProfile.whiteRatio, 0) || 0;
}

function buildSkuImageReplacementPool({
  itemInfo = {},
  imagePlan = {},
  verdictMap = new Map(),
} = {}) {
  const mainImageUrls = dedupeImageUrls([
    ...(Array.isArray(imagePlan.mainImageUrls) ? imagePlan.mainImageUrls : []),
    ...(Array.isArray(itemInfo.imgUrls) ? itemInfo.imgUrls : []),
    ...(Array.isArray(itemInfo.mainImageUrls) ? itemInfo.mainImageUrls : []),
  ]);
  const detailImageUrls = dedupeImageUrls([
    ...(Array.isArray(imagePlan.detailImageUrls) ? imagePlan.detailImageUrls : []),
    ...(Array.isArray(itemInfo.detailImageUrls) ? itemInfo.detailImageUrls : []),
    ...(Array.isArray(itemInfo.productImages) ? itemInfo.productImages : []),
    ...extractImageUrlsFromNotes(itemInfo.notes),
  ]);
  const candidates = dedupeImageUrls([
    ...mainImageUrls,
    ...detailImageUrls,
  ])
    .filter((url) => isMiaoshouSupportedMainImageUrl(url))
    .filter((url) => decideImageRelevant(url, verdictMap));

  return candidates
    .map((url, index) => {
      const mainIndex = mainImageUrls.indexOf(url);
      const detailIndex = detailImageUrls.indexOf(url);
      const whiteRatio = getImageWhiteRatio(url, verdictMap);
      const sourceScore = mainIndex >= 0
        ? 300 - mainIndex
        : (detailIndex >= 0 ? 120 - detailIndex : 0);
      const whiteScore = whiteRatio >= 0.68
        ? 1000
        : (whiteRatio >= 0.5 ? 700 : (whiteRatio >= 0.35 ? 400 : whiteRatio * 100));

      return {
        url,
        score: sourceScore + whiteScore,
        index,
      };
    })
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((item) => item.url);
}

function applySkuImagePolicyToPropertyList(
  skuPropertyList = [],
  {
    itemInfo = {},
    imagePlan = {},
    verdictMap = new Map(),
  } = {},
) {
  const replacementPool = buildSkuImageReplacementPool({ itemInfo, imagePlan, verdictMap });
  const fallbackReplacement = replacementPool[0] || '';

  return cleanSkuPropertyList(skuPropertyList).map((property) => ({
    ...property,
    attrValueList: (Array.isArray(property && property.attrValueList) ? property.attrValueList : []).map((value) => {
      const originalUrls = dedupeImageUrls(value && value.supplementarySkuImageUrls);
      if (originalUrls.length === 0) {
        return {
          ...value,
          supplementarySkuImageUrls: [],
        };
      }

      const keptUrls = originalUrls
        .filter((url) => isMiaoshouSupportedMainImageUrl(url))
        .filter((url) => decideImageRelevant(url, verdictMap));
      if (keptUrls.length === originalUrls.length) {
        return {
          ...value,
          supplementarySkuImageUrls: keptUrls,
        };
      }

      const replacementUrl = replacementPool.find((url) => !keptUrls.includes(url))
        || fallbackReplacement;
      const nextUrls = keptUrls.length > 0
        ? keptUrls
        : (replacementUrl ? [replacementUrl] : []);

      return {
        ...value,
        supplementarySkuImageUrls: nextUrls,
      };
    }),
  }));
}

function buildStrictCleanNotesHtml(itemInfo = {}, imagePlan = null) {
  const selectedImageUrls = imagePlan && Array.isArray(imagePlan.detailImageUrls)
    ? imagePlan.detailImageUrls
    : buildStrictCleanImagePlan(itemInfo).detailImageUrls;
  return buildImageOnlyNotesHtml(selectedImageUrls);
}

async function buildSpecTranslationMapWithKimi(
  sourceTexts = [],
  { model = getSkuTranslationModel() } = {},
) {
  if (!Array.isArray(sourceTexts) || sourceTexts.length === 0) {
    return new Map();
  }

  const messages = [
    {
      role: 'system',
      content: [
        'You translate Chinese ecommerce SKU spec labels/values to concise English.',
        'Keep brand names, model codes, units, and numbers unchanged.',
        'Do not add marketing words.',
        'Output JSON only with schema:',
        '{"translations":[{"source":"原文","target":"English"}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Translate these spec texts to English',
        texts: sourceTexts,
      }),
    },
  ];
  const { payload } = await createAiJsonChatCompletion({
    model,
    temperature: DEFAULT_KIMI_TEMPERATURE,
    messages,
  }, { createChatCompletion: createAiChatCompletion });

  const entries = parseSpecTranslationEntries(payload);
  const translationMap = new Map();

  for (const entry of entries) {
    const source = normalizeSpecTranslationTextSafe(entry && (entry.source || entry.from || entry.text));
    const target = sanitizeSkuSpecText(
      normalizeSpecTranslationTextSafe(entry && (entry.target || entry.to || entry.translation)),
      SPEC_ATTR_VALUE_MAX_LENGTH,
    );
    if (!source || !target) {
      continue;
    }
    if (containsCjkText(target) && containsCjkText(source)) {
      continue;
    }
    translationMap.set(source, target);
  }

  return translationMap;
}

async function translateSkuPropertyListToEnglish(
  skuPropertyList = [],
  { model = getSkuTranslationModel() } = {},
) {
  const cleanedPropertyList = cleanSkuPropertyList(skuPropertyList);
  if (cleanedPropertyList.length === 0) {
    return cleanedPropertyList;
  }

  const texts = collectSkuTextsForTranslation(cleanedPropertyList);
  const translatedTextMap = new Map();
  const unresolvedTexts = [];

  for (const text of texts) {
    const cached = specTextTranslationCache.get(text);
    if (cached) {
      translatedTextMap.set(text, cached);
      continue;
    }

    const fallback = resolveFallbackSpecTranslation(text);
    if (fallback) {
      translatedTextMap.set(text, fallback);
      specTextTranslationCache.set(text, fallback);
      continue;
    }

    if (containsCjkText(text)) {
      unresolvedTexts.push(text);
    } else {
      translatedTextMap.set(text, text);
    }
  }

  if (ENABLE_KIMI_SPEC_TRANSLATION && unresolvedTexts.length > 0) {
    for (const textChunk of chunkArray(unresolvedTexts, DEFAULT_SPEC_TRANSLATION_BATCH_SIZE)) {
      try {
        const chunkMap = await buildSpecTranslationMapWithKimi(textChunk, { model });
        for (const [source, target] of chunkMap.entries()) {
          translatedTextMap.set(source, target);
          specTextTranslationCache.set(source, target);
        }
      } catch (error) {
        break;
      }
    }
  }

  return ensureUniqueSkuPropertyValueNames(cleanedPropertyList.map((property) => {
    const sourceAttrName = normalizeSpecTranslationTextSafe(property && property.attrName);
    const translatedAttrName = sanitizeSkuSpecText(
      translatedTextMap.get(sourceAttrName) || sourceAttrName,
      SPEC_ATTR_NAME_MAX_LENGTH,
    ) || sanitizeSkuSpecText(sourceAttrName, SPEC_ATTR_NAME_MAX_LENGTH);
    return {
      ...property,
      attrName: translatedAttrName,
      attrValueList: (Array.isArray(property && property.attrValueList) ? property.attrValueList : []).map((value) => {
        const sourceAttrValue = normalizeSpecTranslationTextSafe(value && value.attrValue);
        const translatedAttrValue = sanitizeSkuSpecText(
          translatedTextMap.get(sourceAttrValue) || sourceAttrValue,
          SPEC_ATTR_VALUE_MAX_LENGTH,
        ) || sanitizeSkuSpecText(sourceAttrValue, SPEC_ATTR_VALUE_MAX_LENGTH);
        return {
          ...value,
          attrValue: translatedAttrValue,
        };
      }),
    };
  }));
}

function parseSkuKeyAttrValueIds(skuKey = '') {
  return String(skuKey || '')
    .split(';')
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function buildSkuAttrValueTextById(skuPropertyList = []) {
  const textById = new Map();

  for (const property of Array.isArray(skuPropertyList) ? skuPropertyList : []) {
    for (const value of Array.isArray(property && property.attrValueList) ? property.attrValueList : []) {
      const attrValueId = normalizeText(value && value.attrValueId);
      const attrValueText = normalizeText(value && value.attrValue);

      if (attrValueId && attrValueText && !textById.has(attrValueId)) {
        textById.set(attrValueId, attrValueText);
      }
    }
  }

  return textById;
}

function resolveSkuAttrTextsByKey(skuKey = '', attrValueTextById = new Map()) {
  return parseSkuKeyAttrValueIds(skuKey)
    .map((attrValueId) => attrValueTextById.get(attrValueId))
    .filter(Boolean);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeMedianNumber(values = []) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return null;
  }

  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferSkuTextWeightFactor(attrTexts = []) {
  const text = String((Array.isArray(attrTexts) ? attrTexts : []).join(' | ')).toLowerCase();
  if (!text) {
    return 1;
  }

  let factor = 1;

  if (/upper\s*&\s*lower|upper\s*and\s*lower|set|pair|double|2\s*in\s*1/.test(text)) {
    factor *= 1.2;
  }

  if (/opp/.test(text)) {
    factor *= 0.92;
  }
  if (/blister/.test(text)) {
    factor *= 1.0;
  }
  if (/clear\s*box/.test(text)) {
    factor *= 1.08;
  }
  if (/round\s*box/.test(text)) {
    factor *= 1.12;
  }
  if (/color\s*box|gift\s*box/.test(text)) {
    factor *= 1.18;
  }

  let maxQuantity = 1;
  const quantityRegex = /(\d+(?:\.\d+)?)\s*(pcs?|pieces?|pack|packs|set|sets|pair|pairs|个|只|支|片|条|盒|包|瓶)/gi;
  for (const match of text.matchAll(quantityRegex)) {
    const quantity = Number(match[1]);
    if (Number.isFinite(quantity) && quantity > maxQuantity) {
      maxQuantity = quantity;
    }
  }
  if (maxQuantity > 1) {
    factor *= clampNumber(Math.sqrt(maxQuantity), 1, 3.5);
  }

  return clampNumber(factor, 0.7, 3.5);
}

function computeSkuPriceWeightFactor(skuValue = {}, medianOriginPrice = null) {
  const currentOriginPrice = normalizeCurrencyCny(skuValue && skuValue.originPrice, null);

  if (!currentOriginPrice || !medianOriginPrice) {
    return 1;
  }

  return clampNumber(currentOriginPrice / medianOriginPrice, 0.75, 1.35);
}

function resolvePreEditOriginPriceForHighGuard(skuValue = {}, itemInfo = {}) {
  const rawCandidates = [
    skuValue && skuValue.originPrice,
    itemInfo && itemInfo.originPrice,
    itemInfo && itemInfo.price,
    ...Object.values(itemInfo && itemInfo.skuMap ? itemInfo.skuMap : {})
      .map((value) => value && value.originPrice),
  ];

  const normalizedCandidates = rawCandidates
    .map((value) => normalizeCurrencyCny(value, null))
    .filter((value) => value !== null);

  return normalizedCandidates.find((value) => !isSourcePriceTooHighForDirectUse(value))
    || normalizedCandidates[0]
    || '';
}

function guardFinalSkuOriginPrice(finalOriginPrice, skuValue = {}, itemInfo = {}) {
  if (!isSourcePriceTooHighForDirectUse(finalOriginPrice)) {
    return finalOriginPrice;
  }

  return resolvePreEditOriginPriceForHighGuard(skuValue, itemInfo);
}

function roundWeightKg(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Number(numeric.toFixed(3));
}

function cleanSkuMap(
  skuMap = {},
  itemInfo = {},
  fallbackWeight = null,
  {
    forceUnifiedWeight = false,
    forcedOriginPrice = null,
    forceOriginPriceOverwrite = false,
    sourcePriceAdjustmentCny = null,
    sourcePriceAdjustmentThresholdCny = null,
    sourcePriceExtraCny = 0,
    skuWeightPaddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
    addWeightPadding = true,
  } = {},
) {
  const normalizedForcedOriginPrice = normalizeCurrencyCny(forcedOriginPrice);
  const normalizedSourcePriceAdjustmentCny = normalizeCurrencyCny(sourcePriceAdjustmentCny);
  const normalizedSourcePriceAdjustmentThresholdCny = normalizeCurrencyCny(sourcePriceAdjustmentThresholdCny);
  const normalizedSourcePriceExtraCny = normalizeSourcePriceExtraCny(sourcePriceExtraCny);
  const fallbackOriginPrice = normalizedForcedOriginPrice || itemInfo.originPrice || itemInfo.price || '';
  const resolvedFallbackWeight = parsePositiveNumber(fallbackWeight)
    || resolveFallbackWeight(itemInfo, skuMap);
  const skuPropertyList = Array.isArray(itemInfo.skuPropertyList) ? itemInfo.skuPropertyList : [];
  const attrValueTextById = buildSkuAttrValueTextById(skuPropertyList);
  const medianOriginPrice = computeMedianNumber(
    Object.values(skuMap || {})
      .map((value) => normalizeCurrencyCny(value && value.originPrice, null))
      .filter((value) => value !== null),
  );

  return Object.fromEntries(
    Object.entries(skuMap || {}).map(([skuKey, skuValue]) => {
      const normalizedCurrentWeight = clampGrossWeightKg(skuValue && skuValue.weight, null);
      const baseWeight = clampGrossWeightKg(resolvedFallbackWeight, DEFAULT_FALLBACK_WEIGHT);
      const attrTexts = resolveSkuAttrTextsByKey(skuKey, attrValueTextById);
      const textWeightFactor = inferSkuTextWeightFactor(attrTexts);
      const priceWeightFactor = computeSkuPriceWeightFactor(skuValue, medianOriginPrice);
      const computedWeight = clampGrossWeightKg(baseWeight * textWeightFactor * priceWeightFactor, baseWeight);
      const shouldReplaceCurrentWeight = forceUnifiedWeight
        || !normalizedCurrentWeight
        || isGrossWeightTooHighForDirectUse(normalizedCurrentWeight);
      const finalSkuWeight = shouldReplaceCurrentWeight
        ? computedWeight
        : normalizedCurrentWeight;
      const paddedSkuWeight = addWeightPadding
        ? addSkuWeightPaddingKg(finalSkuWeight, finalSkuWeight, skuWeightPaddingGrams)
        : finalSkuWeight;
      const policySkuWeight = enforceMinimumFinalGrossWeightKg(paddedSkuWeight, paddedSkuWeight);
      const currentOriginPrice = normalizeCurrencyCny(skuValue && skuValue.originPrice, null);
      const adjustedOriginPrice = normalizedSourcePriceAdjustmentCny
        && currentOriginPrice
        && (
          !normalizedSourcePriceAdjustmentThresholdCny
          || currentOriginPrice < normalizedSourcePriceAdjustmentThresholdCny
        )
        ? normalizeCurrencyCny(currentOriginPrice + normalizedSourcePriceAdjustmentCny)
        : null;
      const shouldOverwriteCurrentOriginPrice = forceOriginPriceOverwrite
        || shouldOverwriteSuspiciousOriginPrice(currentOriginPrice, normalizedForcedOriginPrice);
      const baseOriginPrice = adjustedOriginPrice
        || (shouldOverwriteCurrentOriginPrice && normalizedForcedOriginPrice
          ? normalizedForcedOriginPrice
          : (skuValue.originPrice || fallbackOriginPrice));
      const finalOriginPrice = normalizedSourcePriceExtraCny
        ? applySourcePriceExtraCny(baseOriginPrice, normalizedSourcePriceExtraCny)
        : baseOriginPrice;
      const guardedFinalOriginPrice = guardFinalSkuOriginPrice(finalOriginPrice, skuValue, itemInfo);

      return [
        skuKey,
        {
          ...skuValue,
          itemNum: normalizeText(skuValue.itemNum),
          originPrice: guardedFinalOriginPrice,
          weight: roundWeightKg(policySkuWeight) || roundWeightKg(baseWeight) || DEFAULT_FALLBACK_WEIGHT,
          shopIdToWarehouseIdAndStockMap: skuValue && skuValue.shopIdToWarehouseIdAndStockMap
            ? skuValue.shopIdToWarehouseIdAndStockMap
            : {},
        },
      ];
    }),
  );
}

function buildDefaultPhShopSelection() {
  return {
    shopId: DEFAULT_PH_SHOP_ID,
    site: 'PH',
    brandId: '0',
    brandName: '无品牌',
    deliveryOptionSetType: DEFAULT_DELIVERY_OPTION_SET_TYPE,
    deliveryOptionIds: [],
    manufacturerIds: [],
    responsiblePersonIds: [],
    sizeChartTemplateId: '',
  };
}

function buildDefaultPhWarehouseMap(stock = DEFAULT_PH_WAREHOUSE_STOCK) {
  return {
    [DEFAULT_PH_SHOP_ID]: {
      [DEFAULT_PH_WAREHOUSE_ID]: String(stock || DEFAULT_PH_WAREHOUSE_STOCK),
    },
  };
}

function ensurePreferredPhShopConfig(itemInfo = {}, claimToShopIds = []) {
  if (String(itemInfo.site || '').toUpperCase() !== 'PH') {
    return {
      itemInfo,
      claimToShopIds: normalizeNumericIdList(claimToShopIds),
    };
  }

  const selectedShopList = Array.isArray(itemInfo.collectBoxDetailShopList)
    ? itemInfo.collectBoxDetailShopList.map((shop) => ({ ...shop }))
    : [];
  const ensuredShopList = selectedShopList.length > 0
    ? selectedShopList
    : [buildDefaultPhShopSelection()];
  const selectedShopIds = uniqueIdList(ensuredShopList.map((shop) => shop.shopId));
  const ensuredClaimToShopIds = normalizeNumericIdList([
    ...claimToShopIds,
    ...selectedShopIds,
  ]);

  const ensuredSkuMap = Object.fromEntries(
    Object.entries(itemInfo.skuMap || {}).map(([skuKey, skuValue]) => {
      const currentShopMap = skuValue && skuValue.shopIdToWarehouseIdAndStockMap
        ? { ...skuValue.shopIdToWarehouseIdAndStockMap }
        : {};

      for (const shopId of selectedShopIds) {
        const normalizedShopId = String(shopId);
        const existingWarehouseMap = currentShopMap[normalizedShopId];

        if (existingWarehouseMap && Object.keys(existingWarehouseMap).length > 0) {
          continue;
        }

        if (normalizedShopId === DEFAULT_PH_SHOP_ID) {
          currentShopMap[normalizedShopId] = buildDefaultPhWarehouseMap(
            skuValue.stock || DEFAULT_PH_WAREHOUSE_STOCK,
          )[normalizedShopId];
        }
      }

      return [
        skuKey,
        {
          ...skuValue,
          shopIdToWarehouseIdAndStockMap: currentShopMap,
        },
      ];
    }),
  );

  return {
    itemInfo: {
      ...itemInfo,
      collectBoxDetailShopList: ensuredShopList,
      skuMap: ensuredSkuMap,
    },
    claimToShopIds: ensuredClaimToShopIds,
  };
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function extractReferenceShopConfig(apiData) {
  const data = apiData && apiData.data ? apiData.data : apiData;
  const siteCollectItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults(
    data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data,
  ));
  const selectedShopList = Array.isArray(siteCollectItemInfo.collectBoxDetailShopList)
    ? siteCollectItemInfo.collectBoxDetailShopList.map((shop) => ({
      ...shop,
      deliveryOptionSetType: shop.deliveryOptionSetType || DEFAULT_DELIVERY_OPTION_SET_TYPE,
      deliveryOptionIds: Array.isArray(shop.deliveryOptionIds) ? shop.deliveryOptionIds : [],
      manufacturerIds: Array.isArray(shop.manufacturerIds) ? shop.manufacturerIds : [],
      responsiblePersonIds: Array.isArray(shop.responsiblePersonIds) ? shop.responsiblePersonIds : [],
      sizeChartTemplateId: shop.sizeChartTemplateId || '',
    }))
    : [];
  const warehouseMapTemplate = Object.values(siteCollectItemInfo.skuMap || {})
    .map((sku) => sku && sku.shopIdToWarehouseIdAndStockMap)
    .find((shopMap) => shopMap && Object.keys(shopMap).length > 0) || {};

  return {
    claimToShopIds: normalizeNumericIdList(data.claimToShopIds),
    collectBoxDetailShopList: cloneJson(selectedShopList) || [],
    warehouseMapTemplate: cloneJson(warehouseMapTemplate) || {},
  };
}

function applyReferenceShopConfig(itemInfo = {}, referenceShopConfig = {}) {
  const collectBoxDetailShopList = cloneJson(referenceShopConfig.collectBoxDetailShopList) || [];
  const warehouseMapTemplate = cloneJson(referenceShopConfig.warehouseMapTemplate) || {};

  return {
    itemInfo: {
      ...itemInfo,
      collectBoxDetailShopList,
      skuMap: Object.fromEntries(
        Object.entries(itemInfo.skuMap || {}).map(([skuKey, skuValue]) => [
          skuKey,
          {
            ...skuValue,
            shopIdToWarehouseIdAndStockMap: cloneJson(warehouseMapTemplate) || {},
          },
        ]),
      ),
    },
    claimToShopIds: normalizeNumericIdList(referenceShopConfig.claimToShopIds),
  };
}

function isSkuPropertyListShapeMatch(baseList = [], candidateList = []) {
  if (!Array.isArray(baseList) || !Array.isArray(candidateList)) {
    return false;
  }
  if (baseList.length !== candidateList.length) {
    return false;
  }
  return baseList.every((property, index) => {
    const baseValueCount = Array.isArray(property && property.attrValueList)
      ? property.attrValueList.length
      : 0;
    const candidateValueCount = Array.isArray(candidateList[index] && candidateList[index].attrValueList)
      ? candidateList[index].attrValueList.length
      : 0;
    return baseValueCount === candidateValueCount;
  });
}

function buildPreparedSiteCollectItemInfo(
  siteCollectItemInfo,
  {
    optimizedTitle,
    maxTitleLength,
    category,
    claimToShopIds,
    referenceShopConfig,
    grossWeightKg,
    sourcePriceCny,
    sourcePriceAdjustmentCny,
    sourcePriceAdjustmentThresholdCny,
    sourcePriceExtraCny = 0,
    skuWeightPaddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
    imagePlan,
    imageRelevanceMap = new Map(),
    translatedSkuPropertyList,
    preparedSpec,
    addWeightPadding = true,
  } = {},
) {
  const simplifiedSpec = preparedSpec || buildNormalizedPreparedSpec(siteCollectItemInfo);
  const skuCount = Object.keys(simplifiedSpec.skuMap || {}).length;
  const shouldForceUnifiedSkuWeight = parsePositiveNumber(grossWeightKg) !== null && skuCount <= 1;
  const resolvedWeight = clampGrossWeightKg(
    grossWeightKg,
    resolveFallbackWeight(siteCollectItemInfo, simplifiedSpec.skuMap),
  );
  const resolvedWeightWithPadding = addWeightPadding
    ? addSkuWeightPaddingKg(resolvedWeight, resolvedWeight, skuWeightPaddingGrams)
    : resolvedWeight;
  const policyWeight = enforceMinimumFinalGrossWeightKg(
    resolvedWeightWithPadding,
    resolvedWeightWithPadding,
  );
  const cleanedSkuMap = cleanSkuMap(
    simplifiedSpec.skuMap,
    { ...siteCollectItemInfo, weight: resolvedWeight, skuPropertyList: simplifiedSpec.skuPropertyList },
    resolvedWeight,
    {
      forceUnifiedWeight: shouldForceUnifiedSkuWeight,
      forcedOriginPrice: sourcePriceCny,
      forceOriginPriceOverwrite: skuCount <= 1,
      sourcePriceAdjustmentCny,
      sourcePriceAdjustmentThresholdCny,
      sourcePriceExtraCny,
      skuWeightPaddingGrams,
      addWeightPadding,
    },
  );

  const normalizedImagePlan = imagePlan || buildStrictCleanImagePlan(siteCollectItemInfo);
  const resolvedSkuPropertyList = isSkuPropertyListShapeMatch(
    simplifiedSpec.skuPropertyList,
    translatedSkuPropertyList,
  )
    ? translatedSkuPropertyList
    : translateSkuPropertyListWithFallbackMap(simplifiedSpec.skuPropertyList);
  const skuPropertyListWithSafeImages = applySkuImagePolicyToPropertyList(resolvedSkuPropertyList, {
    itemInfo: siteCollectItemInfo,
    imagePlan: normalizedImagePlan,
    verdictMap: imageRelevanceMap,
  });

  const preparedBase = {
    ...siteCollectItemInfo,
    title: ensureOptimizedTitleMinLength(
      optimizedTitle
        ? normalizeOptimizedTitle(optimizedTitle, maxTitleLength)
        : siteCollectItemInfo.title,
      {
        originalTitle: siteCollectItemInfo.title,
        maxLength: maxTitleLength,
      },
    ),
    ...(category ? { cid: String(category.cid) } : {}),
    imgUrls: normalizedImagePlan.mainImageUrls,
    notes: buildStrictCleanNotesHtml(siteCollectItemInfo, normalizedImagePlan),
    packageLength: 10,
    packageWidth: 10,
    packageHeight: 10,
    weight: policyWeight,
    skuPropertyList: skuPropertyListWithSafeImages,
    skuMap: cleanedSkuMap,
  };

  const preparedWithDefaults = sanitizeOptionalFields(withDeliveryOptionDefaults(preparedBase));
  const ensuredShopConfig = referenceShopConfig
    ? applyReferenceShopConfig(preparedWithDefaults, referenceShopConfig)
    : ensurePreferredPhShopConfig(preparedWithDefaults, claimToShopIds);
  const selectedShopIds = uniqueIdList(
    (Array.isArray(ensuredShopConfig.itemInfo && ensuredShopConfig.itemInfo.collectBoxDetailShopList)
      ? ensuredShopConfig.itemInfo.collectBoxDetailShopList
      : [])
      .map((shop) => shop && shop.shopId),
  );
  const normalizedClaimToShopIds = normalizeNumericIdList([
    ...(Array.isArray(ensuredShopConfig.claimToShopIds) ? ensuredShopConfig.claimToShopIds : []),
    ...selectedShopIds,
  ]);

  return {
    siteCollectItemInfo: sanitizeOptionalFields(withDeliveryOptionDefaults(ensuredShopConfig.itemInfo)),
    claimToShopIds: normalizedClaimToShopIds,
    imagePlan: normalizedImagePlan,
    specPlan: simplifiedSpec,
  };
}

// 调用当前 AI 提供方优化单个商品标题，只返回最终标题文本，避免把解释内容写回商品。
async function optimizeProductTitleWithKimi({
  title,
  categoryName = DEFAULT_CATEGORY_NAME,
  site,
  item = {},
  itemInfo = {},
  model = getTitleOptimizeModel(),
  maxTitleLength = DEFAULT_TITLE_MAX_LENGTH,
} = {}) {
  const originalTitle = normalizeOptimizedTitle(title, maxTitleLength);

  if (!originalTitle) {
    throw new Error('Cannot optimize an empty product title.');
  }

  const messages = [
    {
      role: 'system',
      content: [
        '你是 TikTok Shop 商品标题优化助手。',
        '你的任务是把原始中文商品标题翻译并优化成自然、可搜索、适合 TikTok Shop 东南亚站点的英文标题。',
        'optimizedTitle 必须是英文标题，不允许包含中文、日文、韩文等 CJK 字符。',
        '中文品牌名如无法确认官方英文名，必须直接删除，不要转写为拼音，也不要保留中文字符。',
        '可以在标题中适当增加 1 到 3 个东南亚站点美妆个护类目下的高搜索词，但必须与商品真实类型相关。',
        '可用的安全搜索词示例包括 beauty、skincare、makeup、cosmetic、personal care、daily use、travel size、portable、facial care、body care、hair care、moisturizing。',
        '不要编造品牌、材质、认证、功效、适用人群、数量、规格或赠品。',
        '不要添加与商品无关的搜索词，不要添加医疗、药品、治疗、强功效、违规或夸大类词汇。',
        '不要使用表情、话题标签、夸大词、营销口号、Markdown 或解释文字。',
        '要参考TikTok Shop东南亚地区马来西亚、菲律宾、泰国、越南的政策，不要使用任何可能会导致商品上架失败的敏感词汇',
        `标题不得包含这些敏感词或其英文表达：${SENSITIVE_WORDS.join('、')}`,
        `标题最长 ${maxTitleLength} 个字符。`,
        '只返回 JSON，格式为 {"optimizedTitle":"优化后的标题"}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        site,
        categoryName,
        originalTitle,
        itemNum: item.itemNum,
        price: item.price,
        productAttributes: itemInfo.productAttributes || [],
        skuPropertyList: itemInfo.skuPropertyList || [],
      }),
    },
  ];
  const { payload } = await createAiJsonChatCompletion({
    model,
    temperature: DEFAULT_KIMI_TEMPERATURE,
    messages,
  }, { createChatCompletion: createAiChatCompletion });

  const optimizedTitle = ensureOptimizedTitleMinLength(
    payload.optimizedTitle || payload.title,
    {
      originalTitle,
      maxLength: maxTitleLength,
    },
  );

  if (!optimizedTitle) {
    throw new Error('AI did not return a usable optimized title.');
  }
  if (containsCjkText(optimizedTitle)) {
    throw new Error(`AI returned a non-English product title: ${optimizedTitle}`);
  }

  let weightEstimation = null;
  try {
    weightEstimation = await estimateGrossWeightWithMimo({
      item,
      itemInfo,
      site,
      categoryName,
      model,
    });
  } catch (error) {
    weightEstimation = null;
  }

  return {
    optimizedTitle,
    estimatedGrossWeightKg: weightEstimation ? weightEstimation.estimatedGrossWeightKg : null,
    weightEstimateSource: weightEstimation ? weightEstimation.source : null,
    weightEstimateConfidence: weightEstimation ? weightEstimation.confidence : null,
    weightEstimateEvidence: weightEstimation ? weightEstimation.evidence : null,
    weightEstimateSourceUrl: weightEstimation ? weightEstimation.sourceUrl : null,
    weightEstimateImageUrlCount: weightEstimation ? weightEstimation.imageUrlCount : 0,
  };
}

async function resolveTargetItems(searchParams = {}) {
  const detailIds = normalizeIdList(searchParams.detailIds);

  if (detailIds.length > 0) {
    return detailIds.map((detailId) => ({
      collectBoxDetailId: detailId,
      detailId,
    }));
  }

  const items = await collectCollectBoxItems(searchParams);
  return normalizeItemSelectionMode(searchParams.itemSelectionMode) === 'range' && hasItemRangeSelection(searchParams)
    ? selectItemsByItemRange(items, searchParams)
    : items;
}

// 拉取某个商品在某个站点下的完整编辑详情，后续保存时要基于这份详情改字段。
async function getSiteCollectItemInfo({ detailId, site }) {
  if (!detailId) {
    throw new Error('detailId is required to load collect item info.');
  }
  if (!site) {
    throw new Error('site is required to load collect item info.');
  }

  return requestMiaoshou(GET_SITE_COLLECT_ITEM_INFO_PATH, {
    method: 'POST',
    body: { detailId, site },
  });
}

// 保存站点维度的采集箱商品详情。这个函数会写线上数据，调用前要确认 apply=true。
async function saveSiteCollectItemInfo(saveBody) {
  return requestMiaoshou(SAVE_SITE_COLLECT_ITEM_INFO_PATH, {
    method: 'POST',
    body: saveBody,
  });
}

async function claimItemsToShops({ detailIds, shopIds }) {
  const normalizedDetailIds = normalizeIdList(detailIds);
  const normalizedShopIds = normalizeIdList(shopIds);

  if (normalizedDetailIds.length === 0) {
    throw new Error('detailIds is required to claim shops.');
  }
  if (normalizedShopIds.length === 0) {
    throw new Error('shopIds is required to claim shops.');
  }

  return requestMiaoshou(CLAIM_TO_SHOP_PATH, {
    method: 'POST',
    body: {
      detailIds: normalizedDetailIds,
      shopIds: normalizedShopIds,
    },
  });
}

async function saveMoveCollectTask({ detailIds, shopIds }) {
  const normalizedDetailIds = normalizeNumericIdList(detailIds);
  const normalizedShopIds = normalizeNumericIdList(shopIds);

  if (normalizedDetailIds.length === 0) {
    throw new Error('detailIds is required to save move collect task.');
  }
  if (normalizedShopIds.length === 0) {
    throw new Error('shopIds is required to save move collect task.');
  }

  return requestMiaoshou(SAVE_MOVE_COLLECT_TASK_PATH, {
    method: 'POST',
    body: {
      detailIds: normalizedDetailIds,
      shopIds: normalizedShopIds,
    },
  });
}

async function saveMoveCollectTaskInShopBatches({
  detailIds,
  shopIds,
  batchSize = DEFAULT_PUBLISH_SHOP_BATCH_SIZE,
  intervalMs = DEFAULT_PUBLISH_SHOP_BATCH_INTERVAL_MS,
} = {}) {
  const normalizedDetailIds = normalizeNumericIdList(detailIds);
  const normalizedShopIds = normalizeNumericIdList(shopIds);

  if (normalizedDetailIds.length === 0) {
    throw new Error('detailIds is required to save move collect task.');
  }
  if (normalizedShopIds.length === 0) {
    throw new Error('shopIds is required to save move collect task.');
  }

  const chunks = chunkArray(normalizedShopIds, Math.max(1, batchSize));
  const batchResults = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const batchShopIds = chunks[index];
    const batchResult = {
      batchNo: index + 1,
      batchCount: chunks.length,
      shopIds: batchShopIds,
      shopCount: batchShopIds.length,
      applied: false,
    };

    try {
      batchResult.result = await saveMoveCollectTask({
        detailIds: normalizedDetailIds,
        shopIds: batchShopIds,
      });
      batchResult.applied = true;
      batchResults.push(batchResult);
    } catch (error) {
      batchResult.error = error.message || String(error);
      batchResults.push(batchResult);
      const batchError = new Error(
        `发布第 ${batchResult.batchNo}/${batchResult.batchCount} 批店铺失败：${batchResult.error}`,
      );
      batchError.publishBatchResults = batchResults;
      batchError.failedBatch = batchResult;
      throw batchError;
    }

    if (index < chunks.length - 1) {
      await sleep(intervalMs);
    }
  }

  return {
    detailIds: normalizedDetailIds,
    shopIds: normalizedShopIds,
    shopCount: normalizedShopIds.length,
    batchSize: Math.max(1, batchSize),
    batchCount: chunks.length,
    batches: batchResults,
  };
}

async function resolvePublishShopIdsForDetail({
  detailId,
  sourceSite = 'PH',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  shopGroupIndex = null,
  publishScope = 'mapped',
  preferredSourceShopId = '',
} = {}) {
  const sites = uniqueIdList([sourceSite, ...groupSites]).map((site) => String(site).toUpperCase());

  if (String(publishScope || '').toLowerCase() === 'groupallshops') {
    const sourceDetail = await getSiteCollectItemInfo({ detailId, site: String(sourceSite || '').toUpperCase() });
    const sourceData = sourceDetail && sourceDetail.data ? sourceDetail.data : sourceDetail;
    const sourceItemInfo = sourceData.siteCollectItemInfo || sourceData.collectItemInfo || sourceData.itemInfo || sourceData;
    const resolvedShopGroupIndex = shopGroupIndex || await buildShopGroupIndex({
      platform: 'tiktok',
      sites,
    });
    const primaryGroupKey = pickPrimaryGroupKeyFromSourceInfo(
      sourceItemInfo,
      sourceSite,
      resolvedShopGroupIndex,
      preferredSourceShopId,
    );
    const groupShopIds = buildGroupShopIdsByGroupKey(resolvedShopGroupIndex, primaryGroupKey, sites);

    if (groupShopIds.length > 0) {
      const groupMap = buildShopGroupMap(resolvedShopGroupIndex);
      const group = primaryGroupKey ? groupMap.get(primaryGroupKey) : null;
      const siteSummaries = sites.map((site) => ({
        site,
        shopCount: Array.isArray(group && group.shops)
          ? group.shops.filter((shop) => String(shop.site || '').toUpperCase() === site).length
          : 0,
      }));

      return {
        detailId,
        shopIds: normalizeNumericIdList(groupShopIds),
        siteSummaries,
        primaryGroupKey,
      };
    }
  }

  const siteSummaries = [];
  const collectedShopIds = [];

  for (const site of sites) {
    try {
      const detail = await getSiteCollectItemInfo({ detailId, site });
      const data = detail && detail.data ? detail.data : detail;
      const itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
      const selectedShopIds = uniqueIdList(
        Array.isArray(itemInfo.collectBoxDetailShopList)
          ? itemInfo.collectBoxDetailShopList.map((shop) => shop.shopId)
          : [],
      );
      const skuMappedShopIds = uniqueIdList(
        Object.values(itemInfo.skuMap || {})
          .flatMap((skuValue) => Object.keys(
            (skuValue && skuValue.shopIdToWarehouseIdAndStockMap)
              ? skuValue.shopIdToWarehouseIdAndStockMap
              : {},
          )),
      );
      const claimShopIds = uniqueIdList(Array.isArray(data.claimToShopIds) ? data.claimToShopIds : []);
      // 发布时优先使用站点内已选店铺；仅在源站点无已选店铺时，回退到 claimToShopIds。
      const siteShopIds = selectedShopIds.length > 0 || skuMappedShopIds.length > 0
        ? uniqueIdList([...selectedShopIds, ...skuMappedShopIds])
        : (String(site).toUpperCase() === String(sourceSite).toUpperCase() ? claimShopIds : []);
      collectedShopIds.push(...siteShopIds);
      siteSummaries.push({
        site,
        shopCount: siteShopIds.length,
      });
    } catch (error) {
      siteSummaries.push({
        site,
        shopCount: 0,
        error: error.message || String(error),
      });
    }
  }

  return {
    detailId,
    shopIds: uniqueIdList(collectedShopIds),
    siteSummaries,
  };
}

async function getShopList({
  platform = 'tiktok',
  site,
  pageNo = 1,
  pageSize = 100,
} = {}) {
  if (!platform) {
    throw new Error('platform is required to load shop list.');
  }
  if (!site) {
    throw new Error('site is required to load shop list.');
  }

  return requestMiaoshou(GET_SHOP_LIST_PATH, {
    method: 'POST',
    body: {
      platform,
      site,
      pageNo,
      pageSize,
    },
  });
}

async function getShopWarehouseList({
  site,
  shopIds = [],
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const normalizedShopIds = normalizeIdList(shopIds);

  if (!normalizedSite) {
    throw new Error('site is required to load shop warehouse list.');
  }
  if (normalizedShopIds.length === 0) {
    throw new Error('shopIds is required to load shop warehouse list.');
  }

  return requestMiaoshou(GET_SHOP_WAREHOUSE_LIST_PATH, {
    method: 'POST',
    body: {
      shopIds: normalizedShopIds,
      site: normalizedSite,
    },
  });
}

async function collectShopWarehouseListBySite({
  site,
  shopIds = [],
  batchSize = 50,
} = {}) {
  const normalizedShopIds = normalizeIdList(shopIds);
  if (normalizedShopIds.length === 0) {
    return [];
  }

  const chunks = chunkArray(normalizedShopIds, Math.max(1, batchSize));
  const warehouseList = [];

  for (const ids of chunks) {
    const result = await getShopWarehouseList({
      site,
      shopIds: ids,
    });
    const pageList = result && result.data && Array.isArray(result.data.shopWarehouseList)
      ? result.data.shopWarehouseList
      : [];
    warehouseList.push(...pageList);
  }

  return warehouseList;
}

async function collectShopsBySite({
  platform = 'tiktok',
  site,
  pageSize = 100,
  maxPages = 20,
} = {}) {
  const shopList = [];

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const result = await getShopList({
      platform,
      site,
      pageNo,
      pageSize,
    });
    const pageShopList = result && result.data && Array.isArray(result.data.shopList)
      ? result.data.shopList
      : [];

    shopList.push(...pageShopList);

    if (pageShopList.length < pageSize) {
      break;
    }
  }

  return shopList;
}

async function collectAllShopIdsBySites({
  platform = 'tiktok',
  sites = DEFAULT_TIKTOK_SHOP_SITES,
  pageSize = 100,
  maxPages = 20,
} = {}) {
  const normalizedSites = uniqueIdList(sites).map((site) => String(site).toUpperCase());
  const bySite = {};
  const allShopIds = [];

  for (const site of normalizedSites) {
    const shops = await collectShopsBySite({
      platform,
      site,
      pageSize,
      maxPages,
    });
    const siteShopIds = uniqueIdList(shops.map((shop) => shop.shopId));
    bySite[site] = siteShopIds;
    allShopIds.push(...siteShopIds);
  }

  return {
    platform,
    sites: normalizedSites,
    bySite,
    shopIds: normalizeNumericIdList(uniqueIdList(allShopIds)),
  };
}

function normalizeShopGroupName(shopNick = '', site = '') {
  const normalizedNick = normalizeText(shopNick);

  if (!normalizedNick) {
    return '';
  }

  const siteCode = String(site || '').trim().toUpperCase();
  const siteAliasMap = {
    PH: ['菲律宾', '菲律賓', 'Philippines', 'PH'],
    MY: ['马来', '马来西亚', 'Malaysia', 'MY'],
    TH: ['泰国', 'Thailand', 'TH'],
    VN: ['越南', 'Vietnam', 'VN'],
    SG: ['新加坡', 'Singapore', 'SG'],
  };
  const aliases = [siteCode, ...(siteAliasMap[siteCode] || [])]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let groupName = normalizedNick;

  for (const alias of aliases) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    groupName = groupName.replace(new RegExp(`\\s*(?:-|_|/)?\\s*${escapedAlias}$`, 'i'), '').trim();
  }

  return groupName || normalizedNick;
}

function normalizeGroupTimeBucket(value = '') {
  const normalized = normalizeText(value);
  return normalized || '';
}

function extractGlobalShopId(shop = {}) {
  const candidates = [
    shop.globalShopId,
    shop.globalShopID,
    shop.globalShopid,
    shop.global_shop_id,
    shop.global_shopId,
    shop.globalId,
    shop.global_id,
  ];
  const matched = candidates
    .map((value) => normalizeText(value))
    .find(Boolean);
  return matched || '';
}

function buildShopGroupKey(shop = {}) {
  const globalShopId = extractGlobalShopId(shop);
  if (globalShopId) {
    return `global:${globalShopId}`;
  }

  const baseName = normalizeShopGroupName(shop.shopNick, shop.site);

  if (baseName) {
    return `nick:${baseName.toLowerCase()}`;
  }

  if (shop.gmtExpire) {
    return `time:${normalizeGroupTimeBucket(shop.gmtExpire)}`;
  }

  if (shop.gmtLastAuth) {
    return `time:${normalizeGroupTimeBucket(shop.gmtLastAuth)}`;
  }

  return `shop:${shop.shopId}`;
}

function buildShopGroupLabel(shop = {}) {
  const globalShopId = extractGlobalShopId(shop);
  const baseName = normalizeShopGroupName(shop.shopNick, shop.site);

  if (baseName) {
    return baseName;
  }

  if (globalShopId) {
    return `全球店铺 ${globalShopId}`;
  }

  if (shop.gmtLastAuth || shop.gmtExpire) {
    return `${shop.gmtLastAuth || ''} / ${shop.gmtExpire || ''}`.trim();
  }

  return String(shop.shopId || '');
}

async function buildShopGroupIndex({
  platform = 'tiktok',
  sites = DEFAULT_TIKTOK_SHOP_SITES,
} = {}) {
  const normalizedSites = uniqueIdList(sites);
  const baseGroupsByKey = new Map();
  const shopListsBySite = {};

  for (const site of normalizedSites) {
    const shops = await collectShopsBySite({ platform, site });
    shopListsBySite[site] = shops;

    for (const shop of shops) {
      const normalizedShop = {
        ...shop,
        shopId: String(shop.shopId),
        site: String(shop.site || site).toUpperCase(),
      };
      const groupKey = buildShopGroupKey(normalizedShop);
      const groupLabel = buildShopGroupLabel(normalizedShop);

      if (!baseGroupsByKey.has(groupKey)) {
        baseGroupsByKey.set(groupKey, {
          groupKey,
          groupLabel,
          strategy: groupKey.startsWith('global:')
            ? 'globalShopId'
            : (groupKey.startsWith('nick:') ? 'shopNick' : 'authTime'),
          shops: [],
        });
      }

      baseGroupsByKey.get(groupKey).shops.push(normalizedShop);
    }
  }

  const finalizedGroups = [];

  for (const baseGroup of baseGroupsByKey.values()) {
    const shops = Array.isArray(baseGroup.shops) ? baseGroup.shops : [];
    const siteCounter = {};

    for (const shop of shops) {
      const siteKey = String(shop.site || '').toUpperCase();
      siteCounter[siteKey] = (siteCounter[siteKey] || 0) + 1;
    }

    const hasSameSiteCollision = Object.values(siteCounter)
      .some((count) => Number(count || 0) > 1);

    if (!hasSameSiteCollision) {
      finalizedGroups.push(baseGroup);
      continue;
    }

    // If one base key merges multiple global stores, split by full auth/expire timestamps.
    const splitMap = new Map();
    for (const shop of shops) {
      const splitKey = `${normalizeText(shop.gmtLastAuth)}__${normalizeText(shop.gmtExpire)}`
        || `shop:${shop.shopId}`;
      if (!splitMap.has(splitKey)) {
        splitMap.set(splitKey, []);
      }
      splitMap.get(splitKey).push(shop);
    }

    for (const [splitKey, splitShops] of splitMap.entries()) {
      const splitSiteCounter = {};
      for (const shop of splitShops) {
        const siteKey = String(shop.site || '').toUpperCase();
        splitSiteCounter[siteKey] = (splitSiteCounter[siteKey] || 0) + 1;
      }
      const splitStillCollides = Object.values(splitSiteCounter)
        .some((count) => Number(count || 0) > 1);

      if (!splitStillCollides) {
        finalizedGroups.push({
          groupKey: `${baseGroup.groupKey}::${splitKey}`,
          groupLabel: baseGroup.groupLabel,
          strategy: `${baseGroup.strategy}+timeSplit`,
          shops: splitShops,
        });
        continue;
      }

      // Last-resort split: keep one shop per group to avoid invalid same-site duplicates.
      for (const shop of splitShops) {
        finalizedGroups.push({
          groupKey: `${baseGroup.groupKey}::shop:${shop.shopId}`,
          groupLabel: buildShopGroupLabel(shop),
          strategy: `${baseGroup.strategy}+shopSplit`,
          shops: [shop],
        });
      }
    }
  }

  const shopIdToGroupKey = new Map();
  for (const group of finalizedGroups) {
    for (const shop of Array.isArray(group.shops) ? group.shops : []) {
      shopIdToGroupKey.set(String(shop.shopId), group.groupKey);
    }
  }

  return {
    platform,
    sites: normalizedSites,
    shopListsBySite,
    shopIdToGroupKey,
    groups: finalizedGroups.map((group) => ({
      ...group,
      shops: group.shops.sort((left, right) => String(left.site).localeCompare(String(right.site))),
    })),
  };
}

function summarizeShopGroups(shopGroupIndex = {}) {
  const groups = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];

  return groups
    .filter((group) => new Set(group.shops.map((shop) => shop.site)).size >= 2)
    .map((group) => {
      const bySite = {};

      for (const shop of group.shops) {
        bySite[shop.site] = {
          shopId: shop.shopId,
          shopNick: shop.shopNick,
          siteName: shop.siteName,
        };
      }

      return {
        groupKey: group.groupKey,
        groupLabel: group.groupLabel,
        strategy: group.strategy,
        sites: group.shops.map((shop) => shop.site),
        bySite,
      };
    });
}

function getAutoClaimCacheKey(platform = 'tiktok', sites = DEFAULT_TIKTOK_SHOP_SITES) {
  const normalizedSites = uniqueIdList(sites).map((site) => String(site).toUpperCase());
  return `${String(platform || 'tiktok').toLowerCase()}::${normalizedSites.join(',')}`;
}

async function getShopGroupIndexFromCache({
  platform = 'tiktok',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
} = {}) {
  const normalizedSites = uniqueIdList(groupSites).map((site) => String(site).toUpperCase());
  const cacheKey = getAutoClaimCacheKey(platform, normalizedSites);
  let shopGroupIndex = autoClaimShopGroupIndexCache.get(cacheKey);

  if (!shopGroupIndex) {
    shopGroupIndex = await buildShopGroupIndex({
      platform,
      sites: normalizedSites,
    });
    autoClaimShopGroupIndexCache.set(cacheKey, shopGroupIndex);
  }

  return shopGroupIndex;
}

function summarizeClaimCoverageByGroup(shopIds = [], shopGroupIndex = {}, requiredGroupKeys = null) {
  const normalizedShopIds = uniqueIdList(shopIds);
  const coveredGroupKeys = new Set();

  for (const shopId of normalizedShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(shopId))
      : null;
    if (groupKey) {
      coveredGroupKeys.add(groupKey);
    }
  }

  const requiredGroups = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];
  const resolvedRequiredGroupKeys = Array.isArray(requiredGroupKeys) && requiredGroupKeys.length > 0
    ? uniqueIdList(requiredGroupKeys)
    : requiredGroups.map((group) => group.groupKey);
  const missingGroupKeys = resolvedRequiredGroupKeys.filter((groupKey) => !coveredGroupKeys.has(groupKey));

  return {
    requiredGroupCount: resolvedRequiredGroupKeys.length,
    coveredGroupCount: coveredGroupKeys.size,
    coveredGroupKeys: [...coveredGroupKeys],
    missingGroupCount: missingGroupKeys.length,
    missingGroupKeys,
    complete: missingGroupKeys.length === 0,
  };
}

function summarizeBlockingClaimCoverage(coverage = {}, shopGroupIndex = {}, sourceSite = '') {
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const normalizedSourceSite = String(sourceSite || '').toUpperCase();
  const coveredLabels = new Set(
    (Array.isArray(coverage.coveredGroupKeys) ? coverage.coveredGroupKeys : [])
      .map((groupKey) => groupMap.get(groupKey))
      .filter(Boolean)
      .map((group) => normalizeText(group.groupLabel || ''))
      .filter(Boolean),
  );
  const blockingMissingGroupKeys = (Array.isArray(coverage.missingGroupKeys)
    ? coverage.missingGroupKeys
    : []).filter((groupKey) => {
    const group = groupMap.get(groupKey);
    if (!group || !Array.isArray(group.shops) || group.shops.length === 0) {
      return true;
    }

    const hasSourceSiteShop = group.shops.some(
      (shop) => String(shop.site || '').toUpperCase() === normalizedSourceSite,
    );
    if (hasSourceSiteShop) {
      return true;
    }

    const groupLabel = normalizeText(group.groupLabel || '');
    return !groupLabel || !coveredLabels.has(groupLabel);
  });

  return {
    blockingMissingGroupKeys,
    blockingMissingGroupCount: blockingMissingGroupKeys.length,
    blockingComplete: blockingMissingGroupKeys.length === 0,
  };
}

function selectOneSiteShopPerGroup(
  group = {},
  preferredSites = [],
  {
    preferredShopIdSet = null,
  } = {},
) {
  const shops = Array.isArray(group.shops) ? group.shops : [];
  if (shops.length === 0) {
    return null;
  }

  const normalizedPreferredSites = uniqueIdList(preferredSites).map((site) => String(site).toUpperCase());
  const preferredShopIds = preferredShopIdSet instanceof Set
    ? preferredShopIdSet
    : new Set(uniqueIdList(preferredShopIdSet || []));

  for (const site of normalizedPreferredSites) {
    const matchedPreferred = shops.find((shop) => (
      String(shop.site || '').toUpperCase() === site
      && preferredShopIds.has(String(shop.shopId))
    ));
    if (matchedPreferred) {
      return matchedPreferred;
    }
  }

  const anyPreferred = shops.find((shop) => preferredShopIds.has(String(shop.shopId)));
  if (anyPreferred) {
    return anyPreferred;
  }

  for (const site of normalizedPreferredSites) {
    const matched = shops.find((shop) => String(shop.site || '').toUpperCase() === site);
    if (matched) {
      return matched;
    }
  }

  return shops[0];
}

function pickRandomShopFromCandidates(shops = []) {
  const normalized = Array.isArray(shops) ? shops.filter(Boolean) : [];
  if (normalized.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * normalized.length);
  return normalized[index];
}

function selectRandomSiteShopPerGroup(
  group = {},
  preferredSites = [],
  {
    preferredShopIdSet = null,
  } = {},
) {
  const shops = Array.isArray(group.shops) ? group.shops : [];
  if (shops.length === 0) {
    return null;
  }

  const normalizedPreferredSites = uniqueIdList(preferredSites).map((site) => String(site).toUpperCase());
  const preferredShopIds = preferredShopIdSet instanceof Set
    ? preferredShopIdSet
    : new Set(uniqueIdList(preferredShopIdSet || []));

  for (const site of normalizedPreferredSites) {
    const siteMappedShops = shops.filter((shop) => (
      String(shop.site || '').toUpperCase() === site
      && preferredShopIds.has(String(shop.shopId))
    ));
    const selected = pickRandomShopFromCandidates(siteMappedShops);
    if (selected) {
      return selected;
    }
  }

  const mappedShops = shops.filter((shop) => preferredShopIds.has(String(shop.shopId)));
  const mappedSelected = pickRandomShopFromCandidates(mappedShops);
  if (mappedSelected) {
    return mappedSelected;
  }

  for (const site of normalizedPreferredSites) {
    const siteShops = shops.filter((shop) => String(shop.site || '').toUpperCase() === site);
    const selected = pickRandomShopFromCandidates(siteShops);
    if (selected) {
      return selected;
    }
  }

  return pickRandomShopFromCandidates(shops);
}

function buildAutoClaimShopIdsFromGroupIndex(
  shopGroupIndex = {},
  {
    preferredSite = 'PH',
    groupSites = DEFAULT_TIKTOK_SHOP_SITES,
    existingShopIds = [],
    preferredShopIdSet = null,
    forceRebuild = false,
    randomize = false,
  } = {},
) {
  const groups = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];
  const preferredSites = uniqueIdList([preferredSite, ...groupSites]).map((site) => String(site).toUpperCase());
  const normalizedExistingShopIds = forceRebuild ? [] : uniqueIdList(existingShopIds);
  const existingCoveredGroupMap = new Map();
  const shopIds = [];

  for (const existingShopId of normalizedExistingShopIds) {
    const existingGroupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(existingShopId))
      : null;
    if (existingGroupKey && !existingCoveredGroupMap.has(existingGroupKey)) {
      existingCoveredGroupMap.set(existingGroupKey, String(existingShopId));
    }
  }

  for (const group of groups) {
    const coveredShopId = existingCoveredGroupMap.get(group.groupKey);
    if (coveredShopId) {
      shopIds.push(coveredShopId);
      continue;
    }

    const selectedShop = randomize
      ? selectRandomSiteShopPerGroup(group, preferredSites, { preferredShopIdSet })
      : selectOneSiteShopPerGroup(group, preferredSites, { preferredShopIdSet });
    if (selectedShop && selectedShop.shopId) {
      shopIds.push(String(selectedShop.shopId));
    }
  }

  return uniqueIdList(shopIds);
}

function buildAllSourceSiteShopIdsFromGroupIndex(
  shopGroupIndex = {},
  {
    sourceSite = 'PH',
  } = {},
) {
  const normalizedSourceSite = String(sourceSite || '').toUpperCase();
  const groups = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];
  const shopIds = [];

  for (const group of groups) {
    const sourceShop = (Array.isArray(group.shops) ? group.shops : [])
      .find((shop) => String(shop.site || '').toUpperCase() === normalizedSourceSite);
    if (sourceShop && sourceShop.shopId) {
      shopIds.push(String(sourceShop.shopId));
    }
  }

  return normalizeNumericIdList(uniqueIdList(shopIds));
}

function buildAutoClaimSingleGroupShopIdsFromGroupIndex(
  shopGroupIndex = {},
  {
    preferredSite = 'PH',
    groupSites = DEFAULT_TIKTOK_SHOP_SITES,
    preferredSourceShopId = '',
  } = {},
) {
  const normalizedPreferredSite = String(preferredSite || '').toUpperCase();
  const normalizedGroupSites = uniqueIdList(groupSites).map((site) => String(site).toUpperCase());
  const groupMap = buildShopGroupMap(shopGroupIndex);

  if (preferredSourceShopId) {
    const preferredGroupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(preferredSourceShopId))
      : null;
    const preferredGroup = preferredGroupKey ? groupMap.get(preferredGroupKey) : null;
    if (preferredGroup && Array.isArray(preferredGroup.shops)) {
      const sourceShop = preferredGroup.shops.find(
        (shop) => String(shop.site || '').toUpperCase() === normalizedPreferredSite,
      );
      if (sourceShop && sourceShop.shopId) {
        return [String(sourceShop.shopId)];
      }
    }
  }

  const groups = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];
  const candidateGroups = groups.filter((group) => Array.isArray(group.shops)
    && group.shops.some((shop) => String(shop.site || '').toUpperCase() === normalizedPreferredSite)
    && group.shops.some((shop) => normalizedGroupSites.includes(String(shop.site || '').toUpperCase())));
  const sortedGroups = [...candidateGroups].sort((left, right) => String(left.groupLabel || '').localeCompare(String(right.groupLabel || '')));

  for (const group of sortedGroups) {
    const sourceShop = group.shops.find((shop) => String(shop.site || '').toUpperCase() === normalizedPreferredSite);
    if (sourceShop && sourceShop.shopId) {
      return [String(sourceShop.shopId)];
    }
  }

  return [];
}

async function getAutoClaimShopIds({
  platform = 'tiktok',
  sourceSite = 'PH',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  mode = 'singleGroup',
  preferredSourceShopId = '',
  existingShopIds = [],
  preferredShopIdSet = null,
  forceRebuild = false,
  randomize = false,
} = {}) {
  const normalizedSites = uniqueIdList(groupSites).map((site) => String(site).toUpperCase());
  const shopGroupIndex = await getShopGroupIndexFromCache({
    platform,
    groupSites: normalizedSites,
  });

  if (String(mode || '').toLowerCase() === 'allgroups') {
    return buildAutoClaimShopIdsFromGroupIndex(shopGroupIndex, {
      preferredSite: sourceSite,
      groupSites: normalizedSites,
      existingShopIds,
      preferredShopIdSet,
      forceRebuild,
      randomize,
    });
  }

  return buildAutoClaimSingleGroupShopIdsFromGroupIndex(shopGroupIndex, {
    preferredSite: sourceSite,
    groupSites: normalizedSites,
    preferredSourceShopId,
  });
}

function collectClaimCoverageShopIds(data = {}, itemInfo = {}) {
  const selectedShopIds = uniqueIdList(
    (Array.isArray(itemInfo.collectBoxDetailShopList) ? itemInfo.collectBoxDetailShopList : [])
      .map((shop) => shop.shopId),
  );
  const claimShopIds = uniqueIdList(Array.isArray(data.claimToShopIds) ? data.claimToShopIds : []);
  // Coverage must only rely on real pre-publish claim selections.
  // skuMap can contain historical/blueprint mappings that are not currently claimed.
  return uniqueIdList([...selectedShopIds, ...claimShopIds]);
}

function isSameIdSet(left = [], right = []) {
  const leftIds = uniqueIdList(left);
  const rightIds = uniqueIdList(right);
  if (leftIds.length !== rightIds.length) {
    return false;
  }

  const rightSet = new Set(rightIds);
  return leftIds.every((id) => rightSet.has(String(id)));
}

function compactClaimShopIdsToOnePerGroup(
  shopIds = [],
  shopGroupIndex = {},
  {
    preferredSite = 'PH',
    groupSites = DEFAULT_TIKTOK_SHOP_SITES,
    preferredShopIdSet = null,
  } = {},
) {
  const normalizedShopIds = uniqueIdList(shopIds);
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const groupedShopIds = new Map();
  const ungroupedShopIds = [];
  const preferredSites = uniqueIdList([preferredSite, ...groupSites])
    .map((site) => String(site).toUpperCase());
  const preferredShopIds = preferredShopIdSet instanceof Set
    ? preferredShopIdSet
    : new Set(uniqueIdList(preferredShopIdSet || []));

  for (const shopId of normalizedShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(shopId))
      : null;
    if (!groupKey) {
      ungroupedShopIds.push(String(shopId));
      continue;
    }
    if (!groupedShopIds.has(groupKey)) {
      groupedShopIds.set(groupKey, []);
    }
    groupedShopIds.get(groupKey).push(String(shopId));
  }

  const compactedShopIds = [];
  for (const [groupKey, candidateShopIds] of groupedShopIds.entries()) {
    const group = groupMap.get(groupKey);
    const candidateSet = new Set(candidateShopIds);
    const candidateShops = Array.isArray(group && group.shops)
      ? group.shops.filter((shop) => candidateSet.has(String(shop.shopId)))
      : [];
    const selectedShop = selectOneSiteShopPerGroup(
      { ...(group || {}), shops: candidateShops },
      preferredSites,
      { preferredShopIdSet: preferredShopIds },
    );

    compactedShopIds.push(String(
      selectedShop && selectedShop.shopId ? selectedShop.shopId : candidateShopIds[0],
    ));
  }

  return uniqueIdList([...compactedShopIds, ...ungroupedShopIds]);
}

function filterSkuMapToShopIds(skuMap = {}, shopIds = []) {
  const selectedShopIdSet = new Set(uniqueIdList(shopIds));
  if (selectedShopIdSet.size === 0) {
    return skuMap || {};
  }

  return Object.fromEntries(
    Object.entries(skuMap || {}).map(([skuKey, skuValue]) => {
      const shopMap = skuValue && skuValue.shopIdToWarehouseIdAndStockMap
        ? skuValue.shopIdToWarehouseIdAndStockMap
        : {};
      return [
        skuKey,
        {
          ...skuValue,
          shopIdToWarehouseIdAndStockMap: Object.fromEntries(
            Object.entries(shopMap)
              .filter(([shopId]) => selectedShopIdSet.has(String(shopId))),
          ),
        },
      ];
    }),
  );
}

function buildCollectBoxShopListForClaimIds(
  itemInfo = {},
  claimShopIds = [],
  shopGroupIndex = {},
  fallbackSite = '',
) {
  const currentShopMap = new Map(
    (Array.isArray(itemInfo.collectBoxDetailShopList) ? itemInfo.collectBoxDetailShopList : [])
      .map((shop) => [String(shop && shop.shopId), shop])
      .filter(([shopId]) => shopId),
  );
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const shopList = [];

  for (const shopId of uniqueIdList(claimShopIds)) {
    const groupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(shopId))
      : null;
    const group = groupKey ? groupMap.get(groupKey) : null;
    const indexedShop = Array.isArray(group && group.shops)
      ? group.shops.find((shop) => String(shop.shopId) === String(shopId))
      : null;
    const sourceShop = currentShopMap.get(String(shopId)) || indexedShop || { shopId, site: fallbackSite };
    const normalizedShop = normalizeCollectBoxShopEntry(
      sourceShop,
      sourceShop && sourceShop.site ? sourceShop.site : fallbackSite,
    );
    if (normalizedShop) {
      shopList.push(normalizedShop);
    }
  }

  return shopList;
}

function restrictItemInfoToClaimShopIds(
  itemInfo = {},
  claimShopIds = [],
  shopGroupIndex = {},
  fallbackSite = '',
) {
  const normalizedClaimShopIds = uniqueIdList(claimShopIds);

  return {
    ...itemInfo,
    collectBoxDetailShopList: buildCollectBoxShopListForClaimIds(
      itemInfo,
      normalizedClaimShopIds,
      shopGroupIndex,
      fallbackSite,
    ),
    skuMap: filterSkuMapToShopIds(itemInfo.skuMap, normalizedClaimShopIds),
  };
}

function applyClaimShopIdsToDetailSnapshot({
  detailData,
  data,
  itemInfo,
  claimShopIds = [],
  shopGroupIndex = {},
  site = '',
} = {}) {
  const normalizedClaimShopIds = normalizeNumericIdList(claimShopIds);
  const updatedItemInfo = restrictItemInfoToClaimShopIds(
    itemInfo,
    normalizedClaimShopIds,
    shopGroupIndex,
    site,
  );
  const updatedData = {
    ...data,
    claimToShopIds: normalizedClaimShopIds,
    site: updatedItemInfo.site || data.site,
    detailId: updatedItemInfo.detailId || data.detailId,
    siteCollectItemInfo: updatedItemInfo,
  };
  const updatedDetail = detailData && detailData.data
    ? { ...detailData, data: updatedData }
    : updatedData;

  return {
    detailData: updatedDetail,
    data: updatedData,
    itemInfo: updatedItemInfo,
    claimShopIds: uniqueIdList(normalizedClaimShopIds),
  };
}

function isGlobalShopSingleSiteConflictError(error) {
  const message = String(error && error.message ? error.message : error || '');
  return (
    message.includes('同个全球店铺下只能选择一个子站点店铺')
    || (message.includes('全球店') && (message.includes('子站点') || message.includes('子站點')))
  );
}

async function resolveBackendCompatibleClaimShopIds({
  detailId,
  candidateShopIds = [],
} = {}) {
  const normalizedCandidateShopIds = uniqueIdList(candidateShopIds);
  const acceptedShopIds = [];

  for (const shopId of normalizedCandidateShopIds) {
    const tryShopIds = [...acceptedShopIds, String(shopId)];
    try {
      await claimItemsToShops({
        detailIds: [detailId],
        shopIds: tryShopIds,
      });
      acceptedShopIds.push(String(shopId));
    } catch (error) {
      if (isGlobalShopSingleSiteConflictError(error)) {
        continue;
      }
      throw error;
    }
  }

  if (acceptedShopIds.length > 0) {
    await claimItemsToShops({
      detailIds: [detailId],
      shopIds: acceptedShopIds,
    });
  }

  return acceptedShopIds;
}

async function claimItemsToShopsResolvingGlobalConflicts({
  detailId,
  shopIds = [],
} = {}) {
  const normalizedShopIds = uniqueIdList(shopIds);
  if (normalizedShopIds.length === 0) {
    throw new Error('Auto-claim failed: no shop candidates were generated.');
  }

  try {
    await claimItemsToShops({
      detailIds: [detailId],
      shopIds: normalizedShopIds,
    });
    return normalizedShopIds;
  } catch (error) {
    if (!isGlobalShopSingleSiteConflictError(error)) {
      throw error;
    }

    const compatibleShopIds = await resolveBackendCompatibleClaimShopIds({
      detailId,
      candidateShopIds: normalizedShopIds,
    });
    if (compatibleShopIds.length === 0) {
      throw new Error('Auto-claim failed: no backend-compatible shop set was found.');
    }

    return uniqueIdList(compatibleShopIds);
  }
}

async function ensurePrePublishShopsForDetail({
  detailId,
  site,
  detailData,
  platform = 'tiktok',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  autoClaimMode = 'allGroups',
  preferredSourceShopId = '',
  preferredWarehouseShopIdSet = null,
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const normalizedGroupSites = uniqueIdList(groupSites).map((item) => String(item).toUpperCase());
  const resolvedGroupSites = normalizedGroupSites.length > 0 ? normalizedGroupSites : DEFAULT_TIKTOK_SHOP_SITES;
  const normalizedMode = String(autoClaimMode || 'allGroups').trim().toLowerCase();
  const resolvedAutoClaimMode = normalizedMode === 'singlegroup' ? 'singleGroup' : 'allGroups';
  const shopGroupIndex = await getShopGroupIndexFromCache({
    platform,
    groupSites: resolvedGroupSites,
  });
  const groupList = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];
  const requiredGroupKeys = groupList
    .filter((group) => Array.isArray(group.shops) && group.shops.length > 0)
    .map((group) => group.groupKey);
  const requiredGroupCount = requiredGroupKeys.length;

  if (requiredGroupCount === 0) {
    throw new Error('店铺分组为空，无法执行认领校验，请先检查店铺授权状态。');
  }

  let currentDetail = detailData;
  let currentData = currentDetail && currentDetail.data ? currentDetail.data : currentDetail;
  let currentItemInfo = currentData.siteCollectItemInfo || currentData.collectItemInfo || currentData.itemInfo || currentData;
  let coverageShopIds = collectClaimCoverageShopIds(currentData, currentItemInfo);
  let coverage = summarizeClaimCoverageByGroup(coverageShopIds, shopGroupIndex, requiredGroupKeys);
  let autoClaimed = false;
  let autoClaimShopIds = [];

  if (!coverage.complete) {
    if (!ENABLE_AUTO_CLAIM_WHEN_MISSING_SHOPS) {
      throw new Error(
        `当前商品未覆盖全部大店铺分组（缺少 ${coverage.missingGroupCount}/${coverage.requiredGroupCount}），且自动认领已关闭。`,
      );
    }

    autoClaimShopIds = await getAutoClaimShopIds({
      platform,
      sourceSite: normalizedSite,
      groupSites: resolvedGroupSites,
      mode: resolvedAutoClaimMode,
      preferredSourceShopId,
      existingShopIds: coverageShopIds,
      preferredShopIdSet: preferredWarehouseShopIdSet,
    });
    if (autoClaimShopIds.length === 0) {
      throw new Error('自动认领未找到可用店铺，无法完成全部大店铺覆盖。');
    }

    let resolvedClaimShopIds = [...autoClaimShopIds];
    try {
      await claimItemsToShops({
        detailIds: [detailId],
        shopIds: resolvedClaimShopIds,
      });
    } catch (error) {
      if (!isGlobalShopSingleSiteConflictError(error)) {
        throw error;
      }

      resolvedClaimShopIds = await resolveBackendCompatibleClaimShopIds({
        detailId,
        candidateShopIds: autoClaimShopIds,
      });
      if (resolvedClaimShopIds.length === 0) {
        throw new Error('Auto-claim failed: no backend-compatible shop set was found.');
      }
    }

    autoClaimShopIds = uniqueIdList(resolvedClaimShopIds);
    await sleep(500);
    autoClaimed = true;

    currentDetail = await getSiteCollectItemInfo({ detailId, site: normalizedSite });
    currentData = currentDetail && currentDetail.data ? currentDetail.data : currentDetail;
    currentItemInfo = currentData.siteCollectItemInfo
      || currentData.collectItemInfo
      || currentData.itemInfo
      || currentData;
    coverageShopIds = collectClaimCoverageShopIds(currentData, currentItemInfo);
    coverage = summarizeClaimCoverageByGroup(coverageShopIds, shopGroupIndex, requiredGroupKeys);

    if (!coverage.complete) {
      throw new Error(
        `自动认领后仍未覆盖全部大店铺分组（缺少 ${coverage.missingGroupCount}/${coverage.requiredGroupCount}）。`,
      );
    }
  }

  return {
    detailData: currentDetail,
    data: currentData,
    itemInfo: currentItemInfo,
    autoClaimed,
    autoClaimShopIds,
    coverage,
    coverageShopIds,
  };
  /*

  if (!ENABLE_AUTO_CLAIM_WHEN_MISSING_SHOPS) {
    throw new Error('当前商品未选择预发布店铺，且自动认领已关闭。');
  }

  const autoClaimShopIds = await getAutoClaimShopIds({
    platform,
    sourceSite: site,
    groupSites,
    mode: autoClaimMode,
    preferredSourceShopId,
  });
  if (autoClaimShopIds.length === 0) {
    throw new Error('当前商品未选择预发布店铺，且自动认领未找到可用店铺。');
  }

  await claimItemsToShops({
    detailIds: [detailId],
    shopIds: autoClaimShopIds,
  });
  await sleep(500);

  const refreshedDetail = await getSiteCollectItemInfo({ detailId, site });
  const refreshedData = refreshedDetail && refreshedDetail.data ? refreshedDetail.data : refreshedDetail;
  const refreshedItemInfo = refreshedData.siteCollectItemInfo
    || refreshedData.collectItemInfo
    || refreshedData.itemInfo
    || refreshedData;

  if (!hasPrePublishShops(refreshedData, refreshedItemInfo)) {
    throw new Error('自动认领后仍未检测到预发布店铺，请检查店铺分组配置。');
  }

  return {
    detailData: refreshedDetail,
    data: refreshedData,
    itemInfo: refreshedItemInfo,
    autoClaimed: true,
    autoClaimShopIds,
  };
  */
}

function buildShopGroupMap(shopGroupIndex = {}) {
  return new Map(
    (Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [])
      .map((group) => [group.groupKey, group]),
  );
}

async function ensurePrePublishShopsForDetailV2({
  detailId,
  site,
  detailData,
  platform = 'tiktok',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  autoClaimMode = 'allGroups',
  preferredSourceShopId = '',
  preferredWarehouseShopIdSet = null,
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const normalizedGroupSites = uniqueIdList(groupSites).map((item) => String(item).toUpperCase());
  const resolvedGroupSites = normalizedGroupSites.length > 0 ? normalizedGroupSites : DEFAULT_TIKTOK_SHOP_SITES;
  const normalizedMode = String(autoClaimMode || 'allGroups').trim().toLowerCase();
  const resolvedAutoClaimMode = normalizedMode === 'singlegroup' ? 'singleGroup' : 'allGroups';
  const shopGroupIndex = await getShopGroupIndexFromCache({
    platform,
    groupSites: resolvedGroupSites,
  });
  const groupList = Array.isArray(shopGroupIndex.groups) ? shopGroupIndex.groups : [];
  const requiredGroupKeys = groupList
    .filter((group) => Array.isArray(group.shops) && group.shops.length > 0)
    .map((group) => group.groupKey);
  const requiredGroupCount = requiredGroupKeys.length;

  if (requiredGroupCount === 0) {
    throw new Error('Shop group index is empty, cannot perform pre-publish claim.');
  }
  if (!ENABLE_AUTO_CLAIM_WHEN_MISSING_SHOPS) {
    throw new Error('Auto-claim is disabled by configuration, cannot continue.');
  }

  let currentDetail = detailData;
  let currentData = currentDetail && currentDetail.data ? currentDetail.data : currentDetail;
  let currentItemInfo = currentData.siteCollectItemInfo || currentData.collectItemInfo || currentData.itemInfo || currentData;
  const rawInitialCoverageShopIds = collectClaimCoverageShopIds(currentData, currentItemInfo);
  const initialCoverageShopIds = compactClaimShopIdsToOnePerGroup(
    rawInitialCoverageShopIds,
    shopGroupIndex,
    {
      preferredSite: normalizedSite,
      groupSites: resolvedGroupSites,
      preferredShopIdSet: preferredWarehouseShopIdSet,
    },
  );
  if (initialCoverageShopIds.length > 0) {
    const compactedSnapshot = applyClaimShopIdsToDetailSnapshot({
      detailData: currentDetail,
      data: currentData,
      itemInfo: currentItemInfo,
      claimShopIds: initialCoverageShopIds,
      shopGroupIndex,
      site: normalizedSite,
    });
    currentDetail = compactedSnapshot.detailData;
    currentData = compactedSnapshot.data;
    currentItemInfo = compactedSnapshot.itemInfo;
  }
  let coverageShopIds = initialCoverageShopIds;
  let coverage = summarizeClaimCoverageByGroup(coverageShopIds, shopGroupIndex, requiredGroupKeys);
  let blockingCoverage = summarizeBlockingClaimCoverage(coverage, shopGroupIndex, normalizedSite);
  let autoClaimed = false;
  let autoClaimShopIds = [];
  let claimSelectionChanged = !isSameIdSet(rawInitialCoverageShopIds, initialCoverageShopIds);
  let warehouseMapped = false;

  // Step 1: preserve an existing one-shop-per-group claim; only fill missing groups.
  const claimModeForStep1 = resolvedAutoClaimMode === 'singleGroup' ? 'singleGroup' : 'allGroups';
  try {
    const plannedClaimShopIds = compactClaimShopIdsToOnePerGroup(await getAutoClaimShopIds({
      platform,
      sourceSite: normalizedSite,
      groupSites: resolvedGroupSites,
      mode: claimModeForStep1,
      preferredSourceShopId,
      existingShopIds: coverageShopIds,
      preferredShopIdSet: preferredWarehouseShopIdSet,
      forceRebuild: false,
      randomize: false,
    }), shopGroupIndex, {
      preferredSite: normalizedSite,
      groupSites: resolvedGroupSites,
      preferredShopIdSet: preferredWarehouseShopIdSet,
    });
    if (plannedClaimShopIds.length === 0) {
      throw new Error('Auto-claim failed: no shop candidates were generated.');
    }

    const plannedCoverage = summarizeClaimCoverageByGroup(plannedClaimShopIds, shopGroupIndex, requiredGroupKeys);
    const plannedBlockingCoverage = summarizeBlockingClaimCoverage(plannedCoverage, shopGroupIndex, normalizedSite);
    if (!plannedBlockingCoverage.blockingComplete) {
      throw new Error(
        `Auto-claim plan incomplete: missing ${plannedBlockingCoverage.blockingMissingGroupCount}/${plannedCoverage.requiredGroupCount} required groups.`,
      );
    }

    const selectedShopIds = uniqueIdList(
      (Array.isArray(currentItemInfo.collectBoxDetailShopList) ? currentItemInfo.collectBoxDetailShopList : [])
        .map((shop) => shop.shopId),
    );
    const needsClaim = !plannedBlockingCoverage.blockingComplete
      || !isSameIdSet(plannedClaimShopIds, coverageShopIds)
      || selectedShopIds.length === 0;

    if (needsClaim) {
      const resolvedClaimShopIds = await claimItemsToShopsResolvingGlobalConflicts({
        detailId,
        shopIds: plannedClaimShopIds,
      });
      autoClaimShopIds = uniqueIdList(resolvedClaimShopIds);
      autoClaimed = true;
      claimSelectionChanged = true;
      await sleep(500);

      currentDetail = await getSiteCollectItemInfo({ detailId, site: normalizedSite });
      currentData = currentDetail && currentDetail.data ? currentDetail.data : currentDetail;
      currentItemInfo = currentData.siteCollectItemInfo
        || currentData.collectItemInfo
        || currentData.itemInfo
        || currentData;
    }

    const rawAfterClaimShopIds = collectClaimCoverageShopIds(currentData, currentItemInfo);
    const compactedAfterClaimShopIds = compactClaimShopIdsToOnePerGroup(
      rawAfterClaimShopIds,
      shopGroupIndex,
      {
        preferredSite: normalizedSite,
        groupSites: resolvedGroupSites,
        preferredShopIdSet: preferredWarehouseShopIdSet,
      },
    );
    if (!isSameIdSet(rawAfterClaimShopIds, compactedAfterClaimShopIds)) {
      claimSelectionChanged = true;
    }
    const compactedAfterClaimSnapshot = applyClaimShopIdsToDetailSnapshot({
      detailData: currentDetail,
      data: currentData,
      itemInfo: currentItemInfo,
      claimShopIds: compactedAfterClaimShopIds,
      shopGroupIndex,
      site: normalizedSite,
    });
    currentDetail = compactedAfterClaimSnapshot.detailData;
    currentData = compactedAfterClaimSnapshot.data;
    currentItemInfo = compactedAfterClaimSnapshot.itemInfo;

    coverageShopIds = compactedAfterClaimShopIds;
    coverage = summarizeClaimCoverageByGroup(coverageShopIds, shopGroupIndex, requiredGroupKeys);
    blockingCoverage = summarizeBlockingClaimCoverage(coverage, shopGroupIndex, normalizedSite);

    for (let attempt = 0; !blockingCoverage.blockingComplete && attempt < 3; attempt += 1) {
      const retryClaimShopIds = compactClaimShopIdsToOnePerGroup(buildAutoClaimShopIdsFromGroupIndex(shopGroupIndex, {
        preferredSite: normalizedSite,
        groupSites: resolvedGroupSites,
        existingShopIds: coverageShopIds,
        preferredShopIdSet: preferredWarehouseShopIdSet,
        randomize: false,
      }), shopGroupIndex, {
        preferredSite: normalizedSite,
        groupSites: resolvedGroupSites,
        preferredShopIdSet: preferredWarehouseShopIdSet,
      });
      const retryCoverage = summarizeClaimCoverageByGroup(retryClaimShopIds, shopGroupIndex, requiredGroupKeys);
      const retryBlockingCoverage = summarizeBlockingClaimCoverage(retryCoverage, shopGroupIndex, normalizedSite);
      if (retryClaimShopIds.length === 0 || !retryBlockingCoverage.blockingComplete) {
        break;
      }

      const resolvedRetryShopIds = await claimItemsToShopsResolvingGlobalConflicts({
        detailId,
        shopIds: retryClaimShopIds,
      });
      autoClaimShopIds = uniqueIdList([...autoClaimShopIds, ...resolvedRetryShopIds]);
      claimSelectionChanged = true;
      await sleep(500);

      currentDetail = await getSiteCollectItemInfo({ detailId, site: normalizedSite });
      currentData = currentDetail && currentDetail.data ? currentDetail.data : currentDetail;
      currentItemInfo = currentData.siteCollectItemInfo
        || currentData.collectItemInfo
        || currentData.itemInfo
        || currentData;
      const rawRetryClaimShopIds = collectClaimCoverageShopIds(currentData, currentItemInfo);
      coverageShopIds = compactClaimShopIdsToOnePerGroup(
        rawRetryClaimShopIds,
        shopGroupIndex,
        {
          preferredSite: normalizedSite,
          groupSites: resolvedGroupSites,
          preferredShopIdSet: preferredWarehouseShopIdSet,
        },
      );
      if (!isSameIdSet(rawRetryClaimShopIds, coverageShopIds)) {
        claimSelectionChanged = true;
      }
      const retryCompactedSnapshot = applyClaimShopIdsToDetailSnapshot({
        detailData: currentDetail,
        data: currentData,
        itemInfo: currentItemInfo,
        claimShopIds: coverageShopIds,
        shopGroupIndex,
        site: normalizedSite,
      });
      currentDetail = retryCompactedSnapshot.detailData;
      currentData = retryCompactedSnapshot.data;
      currentItemInfo = retryCompactedSnapshot.itemInfo;
      coverage = summarizeClaimCoverageByGroup(coverageShopIds, shopGroupIndex, requiredGroupKeys);
      blockingCoverage = summarizeBlockingClaimCoverage(coverage, shopGroupIndex, normalizedSite);
    }

    if (!blockingCoverage.blockingComplete) {
      throw new Error(
        `Auto-claim coverage incomplete: missing ${blockingCoverage.blockingMissingGroupCount}/${coverage.requiredGroupCount} required groups.`,
      );
    }
  } catch (error) {
    if (autoClaimed && initialCoverageShopIds.length > 0) {
      try {
        await claimItemsToShops({
          detailIds: [detailId],
          shopIds: initialCoverageShopIds,
        });
        throw new Error(`${error.message || String(error)} 已恢复原店铺选择。`);
      } catch (restoreError) {
        if (restoreError && String(restoreError.message || restoreError).includes('已恢复原店铺选择')) {
          throw restoreError;
        }
        throw new Error(
          `${error.message || String(error)}；尝试恢复原店铺选择失败：${restoreError.message || String(restoreError)}`,
        );
      }
    }
    throw error;
  }

  // Step 2: ensure claimed child shops all have warehouse mappings via warehouse API.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selectedShopIds = uniqueIdList(
      (Array.isArray(currentItemInfo.collectBoxDetailShopList) ? currentItemInfo.collectBoxDetailShopList : [])
        .map((shop) => shop.shopId),
    );
    if (selectedShopIds.length === 0) {
      throw new Error('No claimed child shops found after claim step.');
    }

    const warehouseBlueprint = await buildWarehouseBlueprintFromShopWarehouseApi({
      site: normalizedSite,
      selectedShopIds,
      selectedShops: Array.isArray(currentItemInfo.collectBoxDetailShopList)
        ? currentItemInfo.collectBoxDetailShopList
        : [],
      currentItemInfo,
    });
    const missingWarehouseShopIds = selectedShopIds.filter((shopId) => {
      const warehouseIds = warehouseBlueprint.shopIdToWarehouseIds
        ? warehouseBlueprint.shopIdToWarehouseIds[String(shopId)]
        : null;
      return !(Array.isArray(warehouseIds) && warehouseIds.length > 0);
    });

    if (missingWarehouseShopIds.length === 0) {
      warehouseMapped = true;
      break;
    }

    const reclaimPlan = buildClaimShopIdsAvoidingMissingSourceShops({
      currentClaimShopIds: selectedShopIds,
      missingSourceShopIds: missingWarehouseShopIds,
      sourceSite: normalizedSite,
      groupSites: resolvedGroupSites,
      shopGroupIndex,
      preferredShopIdSet: preferredWarehouseShopIdSet,
    });
    if (reclaimPlan.claimShopIds.length === 0 || reclaimPlan.replacementLogs.length === 0) {
      throw new Error(
        `Warehouse mapping missing for claimed shops and cannot be auto-replaced: ${missingWarehouseShopIds.join(',')}`,
      );
    }

    const resolvedReclaimShopIds = await claimItemsToShopsResolvingGlobalConflicts({
      detailId,
      shopIds: reclaimPlan.claimShopIds,
    });
    autoClaimShopIds = uniqueIdList([...autoClaimShopIds, ...resolvedReclaimShopIds]);
    autoClaimed = true;
    claimSelectionChanged = true;
    await sleep(500);

    currentDetail = await getSiteCollectItemInfo({ detailId, site: normalizedSite });
    currentData = currentDetail && currentDetail.data ? currentDetail.data : currentDetail;
    currentItemInfo = currentData.siteCollectItemInfo
      || currentData.collectItemInfo
      || currentData.itemInfo
      || currentData;
    const rawReclaimShopIds = collectClaimCoverageShopIds(currentData, currentItemInfo);
    coverageShopIds = compactClaimShopIdsToOnePerGroup(
      rawReclaimShopIds,
      shopGroupIndex,
      {
        preferredSite: normalizedSite,
        groupSites: resolvedGroupSites,
        preferredShopIdSet: preferredWarehouseShopIdSet,
      },
    );
    if (!isSameIdSet(rawReclaimShopIds, coverageShopIds)) {
      claimSelectionChanged = true;
    }
    const compactedReclaimSnapshot = applyClaimShopIdsToDetailSnapshot({
      detailData: currentDetail,
      data: currentData,
      itemInfo: currentItemInfo,
      claimShopIds: coverageShopIds,
      shopGroupIndex,
      site: normalizedSite,
    });
    currentDetail = compactedReclaimSnapshot.detailData;
    currentData = compactedReclaimSnapshot.data;
    currentItemInfo = compactedReclaimSnapshot.itemInfo;
    coverage = summarizeClaimCoverageByGroup(coverageShopIds, shopGroupIndex, requiredGroupKeys);
    blockingCoverage = summarizeBlockingClaimCoverage(coverage, shopGroupIndex, normalizedSite);
  }

  if (!warehouseMapped) {
    throw new Error('Warehouse mapping validation failed after retries.');
  }

  return {
    detailData: currentDetail,
    data: currentData,
    itemInfo: currentItemInfo,
    autoClaimed,
    autoClaimShopIds,
    claimSelectionChanged,
    coverage: {
      ...coverage,
      blockingMissingGroupKeys: blockingCoverage.blockingMissingGroupKeys,
      blockingMissingGroupCount: blockingCoverage.blockingMissingGroupCount,
      blockingComplete: blockingCoverage.blockingComplete,
    },
    coverageShopIds,
    warehouseMapped,
  };
}

function pickPrimaryGroupKeyFromSourceInfo(
  sourceItemInfo = {},
  sourceSite = '',
  shopGroupIndex = {},
  preferredSourceShopId = '',
) {
  const sourceShopIds = uniqueIdList(
    (Array.isArray(sourceItemInfo.collectBoxDetailShopList) ? sourceItemInfo.collectBoxDetailShopList : [])
      .map((shop) => shop.shopId),
  );
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const preferredShopId = String(preferredSourceShopId || '').trim();

  if (preferredShopId) {
    const preferredGroupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(preferredShopId)
      : null;
    if (preferredGroupKey && groupMap.has(preferredGroupKey)) {
      return preferredGroupKey;
    }
  }

  for (const sourceShopId of sourceShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(sourceShopId))
      : null;
    const group = groupKey ? groupMap.get(groupKey) : null;
    const hasSourceSiteShop = Boolean(group && Array.isArray(group.shops)
      && group.shops.some((shop) => String(shop.site || '').toUpperCase() === String(sourceSite || '').toUpperCase()));
    if (groupKey && hasSourceSiteShop) {
      return groupKey;
    }
  }

  return null;
}

function filterSourceItemInfoByGroupKey(sourceItemInfo = {}, shopGroupIndex = {}, groupKey = '') {
  if (!groupKey) {
    return sourceItemInfo;
  }

  const filteredShopList = (Array.isArray(sourceItemInfo.collectBoxDetailShopList)
    ? sourceItemInfo.collectBoxDetailShopList
    : []).filter((shop) => {
    const shopId = String(shop && shop.shopId ? shop.shopId : '');
    const currentGroupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(shopId)
      : null;
    return currentGroupKey === groupKey;
  });

  return {
    ...sourceItemInfo,
    collectBoxDetailShopList: filteredShopList,
  };
}

function buildGroupShopIdsByGroupKey(
  shopGroupIndex = {},
  groupKey = '',
  limitedSites = [],
) {
  if (!groupKey) {
    return [];
  }
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const group = groupMap.get(groupKey);
  if (!group || !Array.isArray(group.shops)) {
    return [];
  }

  const normalizedSites = uniqueIdList(limitedSites).map((site) => String(site).toUpperCase());
  const hasSiteLimit = normalizedSites.length > 0;
  const siteSet = new Set(normalizedSites);

  return uniqueIdList(group.shops
    .filter((shop) => !hasSiteLimit || siteSet.has(String(shop.site || '').toUpperCase()))
    .map((shop) => shop.shopId));
}

function buildSourceSiteClaimShopIdsForGroupKey(
  shopGroupIndex = {},
  groupKey = '',
  sourceSite = '',
) {
  if (!groupKey || !sourceSite) {
    return [];
  }
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const group = groupMap.get(groupKey);
  if (!group || !Array.isArray(group.shops)) {
    return [];
  }

  const sourceSiteKey = String(sourceSite).toUpperCase();
  const sourceSiteShops = group.shops.filter((shop) => String(shop.site || '').toUpperCase() === sourceSiteKey);
  if (sourceSiteShops.length === 0) {
    return [];
  }

  return normalizeNumericIdList(uniqueIdList(sourceSiteShops.map((shop) => shop.shopId)));
}

// 只替换站点商品详情里的 cid，其它字段原样保留，降低误改标题/价格/SKU 的风险。
async function buildUpdatedSiteCollectItemInfo(apiData, category) {
  const data = apiData && apiData.data ? apiData.data : apiData;
  const siteCollectItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults(
    data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data,
  ));
  const translatedSkuPropertyList = await translateSkuPropertyListToEnglish(
    siteCollectItemInfo.skuPropertyList,
  );
  const updatedInfo = {
    ...siteCollectItemInfo,
    title: sanitizeSensitiveWordsFromText(siteCollectItemInfo.title, DEFAULT_TITLE_MAX_LENGTH),
    cid: String(category.cid),
    skuPropertyList: translatedSkuPropertyList,
  };

  return {
    saveBody: {
      ...data,
      site: updatedInfo.site,
      detailId: updatedInfo.detailId,
      siteCollectItemInfo: updatedInfo,
    },
    oldCid: siteCollectItemInfo.cid,
    newCid: updatedInfo.cid,
  };
}

// 只替换商品详情里的 title / cid 字段，其它字段原样保留，避免误改价格、SKU、库存等敏感信息。
async function buildUpdatedTitleSiteCollectItemInfo(
  apiData,
  optimizedTitle,
  maxTitleLength,
  category,
  grossWeightKg = null,
  sourcePriceCny = null,
  sourcePriceAdjustmentCny = null,
  sourcePriceAdjustmentThresholdCny = null,
  {
    imageAuditModel = getImageAuditModel(),
    skuTranslationModel = getSkuTranslationModel(),
    sourcePriceExtraCny = 0,
    skuWeightPaddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
  } = {},
) {
  const data = apiData && apiData.data ? apiData.data : apiData;
  const siteCollectItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults(
    data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data,
  ));
  const oldMainImageUrls = dedupeImageUrls(Array.isArray(siteCollectItemInfo.imgUrls) ? siteCollectItemInfo.imgUrls : []);
  const oldDetailImageUrls = dedupeImageUrls(extractImageUrlsFromNotes(siteCollectItemInfo.notes));
  const normalizedPreparedSpec = buildNormalizedPreparedSpec(siteCollectItemInfo);
  const oldSkuImageUrls = collectSkuImageUrlsFromPropertyList(normalizedPreparedSpec.skuPropertyList);
  const imageRelevanceMap = await buildImageRelevanceMapWithMimo({
    imageUrls: [...oldSkuImageUrls, ...oldDetailImageUrls, ...oldMainImageUrls],
    title: optimizedTitle || siteCollectItemInfo.title,
    categoryName: category && category.name ? category.name : DEFAULT_CATEGORY_NAME,
    model: imageAuditModel,
  });
  const imagePlan = buildStrictCleanImagePlan(siteCollectItemInfo, imageRelevanceMap);
  const oldTitle = normalizeOptimizedTitle(siteCollectItemInfo.title, maxTitleLength);
  const oldRawNotes = String(siteCollectItemInfo.notes || '');
  const oldNotes = buildImageOnlyNotesHtml(extractImageUrlsFromNotes(siteCollectItemInfo.notes));
  const translatedSkuPropertyList = await translateSkuPropertyListToEnglish(
    normalizedPreparedSpec.skuPropertyList,
    { model: skuTranslationModel },
  );
  const shouldAddWeightPadding = containsCjkText(siteCollectItemInfo.title)
    || !siteCollectItemInfo.cid
    || (category && String(siteCollectItemInfo.cid || '') !== String(category.cid));
  const prepared = buildPreparedSiteCollectItemInfo(siteCollectItemInfo, {
    optimizedTitle,
    maxTitleLength,
    category,
    claimToShopIds: data.claimToShopIds,
    grossWeightKg,
    sourcePriceCny,
    sourcePriceAdjustmentCny,
    sourcePriceAdjustmentThresholdCny,
    sourcePriceExtraCny,
    skuWeightPaddingGrams,
    imagePlan,
    imageRelevanceMap,
    translatedSkuPropertyList,
    preparedSpec: normalizedPreparedSpec,
    addWeightPadding: shouldAddWeightPadding,
  });
  const updatedInfo = prepared.siteCollectItemInfo;
  const newTitle = updatedInfo.title;
  const newNotes = String(updatedInfo.notes || '');
  const newMainImageUrls = dedupeImageUrls(Array.isArray(updatedInfo.imgUrls) ? updatedInfo.imgUrls : []);
  const newDetailImageUrls = dedupeImageUrls(extractImageUrlsFromNotes(updatedInfo.notes));
  const oldSpecDimension = Array.isArray(siteCollectItemInfo.skuPropertyList)
    ? siteCollectItemInfo.skuPropertyList.length
    : 0;
  const newSpecDimension = Array.isArray(updatedInfo.skuPropertyList)
    ? updatedInfo.skuPropertyList.length
    : 0;
  const oldSpecSnapshot = JSON.stringify(
    (Array.isArray(siteCollectItemInfo.skuPropertyList) ? siteCollectItemInfo.skuPropertyList : []).map((property) => ({
      attrName: normalizeText(property && property.attrName),
      values: (Array.isArray(property && property.attrValueList) ? property.attrValueList : [])
        .map((value) => normalizeText(value && value.attrValue)),
    })),
  );
  const newSpecSnapshot = JSON.stringify(
    (Array.isArray(updatedInfo.skuPropertyList) ? updatedInfo.skuPropertyList : []).map((property) => ({
      attrName: normalizeText(property && property.attrName),
      values: (Array.isArray(property && property.attrValueList) ? property.attrValueList : [])
        .map((value) => normalizeText(value && value.attrValue)),
    })),
  );
  const specChanged = oldSpecSnapshot !== newSpecSnapshot;
  const oldWeight = parsePositiveNumber(siteCollectItemInfo.weight);
  const newWeight = parsePositiveNumber(updatedInfo.weight);
  const oldSourcePriceCny = extractRepresentativeOriginPrice(siteCollectItemInfo);
  const newSourcePriceCny = extractRepresentativeOriginPrice(updatedInfo);
  const oldSkuOriginPriceSnapshot = JSON.stringify(buildSkuOriginPriceSnapshot(siteCollectItemInfo.skuMap));
  const newSkuOriginPriceSnapshot = JSON.stringify(buildSkuOriginPriceSnapshot(updatedInfo.skuMap));

  return {
    saveBody: {
      ...data,
      claimToShopIds: prepared.claimToShopIds,
      site: updatedInfo.site,
      detailId: updatedInfo.detailId,
      siteCollectItemInfo: updatedInfo,
    },
    oldTitle,
    newTitle,
    oldCid: siteCollectItemInfo.cid,
    newCid: updatedInfo.cid,
    oldNotesImageCount: extractImageUrlsFromNotes(oldNotes).length,
    newNotesImageCount: extractImageUrlsFromNotes(newNotes).length,
    notesChanged: oldRawNotes !== newNotes,
    oldMainImageCount: oldMainImageUrls.length,
    newMainImageCount: newMainImageUrls.length,
    mainImagesChanged: JSON.stringify(oldMainImageUrls) !== JSON.stringify(newMainImageUrls),
    oldDetailFirstImage: oldDetailImageUrls[0] || '',
    newDetailFirstImage: newDetailImageUrls[0] || '',
    imageRemovedMainCount: imagePlan.removedMainImageCount,
    imageRemovedDetailCount: imagePlan.removedDetailImageCount,
    oldSpecDimension,
    newSpecDimension,
    removedSecondSpec: prepared.specPlan && prepared.specPlan.simplified
      ? prepared.specPlan.removedSpec
      : null,
    specChanged,
    oldWeight,
    newWeight,
    weightChanged: parsePositiveNumber(oldWeight) !== parsePositiveNumber(newWeight),
    oldSourcePriceCny,
    newSourcePriceCny,
    sourcePriceChanged: oldSourcePriceCny !== newSourcePriceCny
      || oldSkuOriginPriceSnapshot !== newSkuOriginPriceSnapshot,
  };
}

async function buildUpdatedShopConfigSiteCollectItemInfo(apiData, referenceShopConfig) {
  const data = apiData && apiData.data ? apiData.data : apiData;
  const siteCollectItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults(
    data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data,
  ));
  const normalizedPreparedSpec = buildNormalizedPreparedSpec(siteCollectItemInfo);
  const translatedSkuPropertyList = await translateSkuPropertyListToEnglish(
    normalizedPreparedSpec.skuPropertyList,
  );
  const prepared = buildPreparedSiteCollectItemInfo(siteCollectItemInfo, {
    claimToShopIds: data.claimToShopIds,
    referenceShopConfig,
    translatedSkuPropertyList,
    preparedSpec: normalizedPreparedSpec,
  });
  const updatedInfo = prepared.siteCollectItemInfo;

  return {
    saveBody: {
      ...data,
      claimToShopIds: prepared.claimToShopIds,
      site: updatedInfo.site,
      detailId: updatedInfo.detailId,
      siteCollectItemInfo: updatedInfo,
    },
    oldClaimToShopCount: Array.isArray(data.claimToShopIds) ? data.claimToShopIds.length : 0,
    newClaimToShopCount: Array.isArray(prepared.claimToShopIds) ? prepared.claimToShopIds.length : 0,
    oldSelectedShopCount: Array.isArray(siteCollectItemInfo.collectBoxDetailShopList)
      ? siteCollectItemInfo.collectBoxDetailShopList.length
      : 0,
    newSelectedShopCount: Array.isArray(updatedInfo.collectBoxDetailShopList)
      ? updatedInfo.collectBoxDetailShopList.length
      : 0,
  };
}

function extractWarehouseBlueprint(itemInfo = {}, selectedShopIds = []) {
  const collectBoxDetailShopList = Array.isArray(itemInfo.collectBoxDetailShopList)
    ? itemInfo.collectBoxDetailShopList
    : [];
  const selectedShopIdSet = new Set(uniqueIdList(selectedShopIds));
  const shopIdToWarehouseIds = {};

  for (const skuValue of Object.values(itemInfo.skuMap || {})) {
    const shopMap = skuValue && skuValue.shopIdToWarehouseIdAndStockMap
      ? skuValue.shopIdToWarehouseIdAndStockMap
      : {};

    for (const [shopId, warehouseMap] of Object.entries(shopMap)) {
      if (selectedShopIdSet.size > 0 && !selectedShopIdSet.has(String(shopId))) {
        continue;
      }

      const warehouseIds = Object.keys(warehouseMap || {});

      if (warehouseIds.length > 0 && !shopIdToWarehouseIds[String(shopId)]) {
        shopIdToWarehouseIds[String(shopId)] = warehouseIds;
      }
    }
  }

  return {
    collectBoxDetailShopList: cloneJson(
      selectedShopIdSet.size > 0
        ? collectBoxDetailShopList.filter((shop) => selectedShopIdSet.has(String(shop.shopId)))
        : collectBoxDetailShopList,
    ) || [],
    shopIdToWarehouseIds,
  };
}

function buildWarehouseStockMapFromBlueprint(warehouseBlueprint = {}, stockValue = '') {
  const stockTotal = Math.max(0, Math.floor(parseNumber(stockValue, 0)));
  const warehouseEntries = Object.entries(warehouseBlueprint.shopIdToWarehouseIds || {})
    .flatMap(([shopId, warehouseIds]) => uniqueIdList(warehouseIds)
      .map((warehouseId) => ({
        shopId: String(shopId),
        warehouseId: String(warehouseId),
      })));

  if (warehouseEntries.length === 0) {
    return {};
  }

  const baseStock = Math.floor(stockTotal / warehouseEntries.length);
  let remainder = stockTotal % warehouseEntries.length;
  const distributedStockMap = {};

  for (const { shopId, warehouseId } of warehouseEntries) {
    if (!distributedStockMap[shopId]) {
      distributedStockMap[shopId] = {};
    }

    const stockForWarehouse = baseStock + (remainder > 0 ? 1 : 0);
    distributedStockMap[shopId][warehouseId] = String(stockForWarehouse);

    if (remainder > 0) {
      remainder -= 1;
    }
  }

  return distributedStockMap;
}

function buildCrossSiteComparableSnapshot(itemInfo = {}) {
  const normalized = sanitizeOptionalFields(withDeliveryOptionDefaults(itemInfo));

  return {
    ...normalized,
    site: '',
    detailId: '',
    collectBoxDetailShopList: [],
    skuMap: Object.fromEntries(
      Object.entries(normalized.skuMap || {}).map(([skuKey, skuValue]) => [
        skuKey,
        {
          ...skuValue,
          shopIdToWarehouseIdAndStockMap: {},
        },
      ]),
    ),
  };
}

function inferTargetSitesFromSourceInfo(sourceItemInfo, sourceSite, shopGroupIndex = {}) {
  const sourceShopIds = uniqueIdList(
    (Array.isArray(sourceItemInfo.collectBoxDetailShopList) ? sourceItemInfo.collectBoxDetailShopList : [])
      .map((shop) => shop.shopId),
  );
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const targetSites = new Set();

  for (const shopId of sourceShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey && shopGroupIndex.shopIdToGroupKey.get(String(shopId));
    const group = groupKey ? groupMap.get(groupKey) : null;

    if (!group) {
      continue;
    }

    for (const shop of group.shops) {
      if (String(shop.site).toUpperCase() !== String(sourceSite).toUpperCase()) {
        targetSites.add(String(shop.site).toUpperCase());
      }
    }
  }

  return [...targetSites];
}

function buildSiteSelectionMapFromSourceInfo(
  sourceItemInfo = {},
  sourceSite = '',
  shopGroupIndex = {},
  limitedSites = [],
) {
  const sourceShopIds = uniqueIdList(
    (Array.isArray(sourceItemInfo.collectBoxDetailShopList) ? sourceItemInfo.collectBoxDetailShopList : [])
      .map((shop) => shop.shopId),
  );
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const hasSiteLimit = uniqueIdList(limitedSites).length > 0;
  const siteLimitSet = new Set(
    uniqueIdList([sourceSite, ...limitedSites]).map((site) => String(site).toUpperCase()),
  );
  const selectionMap = {};

  for (const sourceShopId of sourceShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey && shopGroupIndex.shopIdToGroupKey.get(String(sourceShopId));
    const group = groupKey ? groupMap.get(groupKey) : null;

    if (!group) {
      continue;
    }

    for (const shop of group.shops) {
      const site = String(shop.site || '').toUpperCase();

      if (hasSiteLimit && !siteLimitSet.has(site)) {
        continue;
      }

      if (!selectionMap[site]) {
        selectionMap[site] = [];
      }

      if (!selectionMap[site].some((item) => String(item.shopId) === String(shop.shopId))) {
        selectionMap[site].push({
          ...shop,
          shopId: String(shop.shopId),
          site,
        });
      }
    }
  }

  return selectionMap;
}

function buildOneShopPerGroupClaimIdsFromSourceInfo(
  sourceItemInfo = {},
  sourceSite = '',
  shopGroupIndex = {},
  preferredSites = [],
) {
  const sourceShopIds = uniqueIdList(
    (Array.isArray(sourceItemInfo.collectBoxDetailShopList) ? sourceItemInfo.collectBoxDetailShopList : [])
      .map((shop) => shop.shopId),
  );
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const normalizedPreferredSites = uniqueIdList([sourceSite, ...preferredSites])
    .map((site) => String(site).toUpperCase());
  const claimShopIds = [];

  for (const sourceShopId of sourceShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey && shopGroupIndex.shopIdToGroupKey.get(String(sourceShopId));
    const group = groupKey ? groupMap.get(groupKey) : null;

    if (!group) {
      claimShopIds.push(String(sourceShopId));
      continue;
    }

    const selectedShop = selectOneSiteShopPerGroup(group, normalizedPreferredSites);
    if (selectedShop && selectedShop.shopId) {
      claimShopIds.push(String(selectedShop.shopId));
    }
  }

  return normalizeNumericIdList(uniqueIdList(claimShopIds));
}

function mergeWarehouseBlueprint(baseBlueprint = {}, extraBlueprint = {}) {
  const shopMap = new Map();

  for (const shop of [
    ...(Array.isArray(baseBlueprint.collectBoxDetailShopList) ? baseBlueprint.collectBoxDetailShopList : []),
    ...(Array.isArray(extraBlueprint.collectBoxDetailShopList) ? extraBlueprint.collectBoxDetailShopList : []),
  ]) {
    shopMap.set(String(shop.shopId), {
      ...shopMap.get(String(shop.shopId)),
      ...shop,
      shopId: String(shop.shopId),
    });
  }

  return {
    collectBoxDetailShopList: [...shopMap.values()],
    shopIdToWarehouseIds: {
      ...(baseBlueprint.shopIdToWarehouseIds || {}),
      ...(extraBlueprint.shopIdToWarehouseIds || {}),
    },
  };
}

function hasWarehouseBlueprintCoverage(warehouseBlueprint = {}, selectedShopIds = []) {
  const selectedShopIdList = uniqueIdList(selectedShopIds);

  return selectedShopIdList.every((shopId) => {
    const hasShopEntry = (Array.isArray(warehouseBlueprint.collectBoxDetailShopList)
      ? warehouseBlueprint.collectBoxDetailShopList
      : []).some((shop) => String(shop.shopId) === String(shopId));
    const warehouseIds = warehouseBlueprint.shopIdToWarehouseIds
      ? warehouseBlueprint.shopIdToWarehouseIds[String(shopId)]
      : null;

    return hasShopEntry && Array.isArray(warehouseIds) && warehouseIds.length > 0;
  });
}

function pickWarehouseBlueprintForShopIds(warehouseBlueprint = {}, selectedShopIds = []) {
  const selectedShopIdSet = new Set(uniqueIdList(selectedShopIds));

  return {
    collectBoxDetailShopList: (Array.isArray(warehouseBlueprint.collectBoxDetailShopList)
      ? warehouseBlueprint.collectBoxDetailShopList
      : []).filter((shop) => selectedShopIdSet.has(String(shop.shopId))),
    shopIdToWarehouseIds: Object.fromEntries(
      Object.entries(warehouseBlueprint.shopIdToWarehouseIds || {})
        .filter(([shopId]) => selectedShopIdSet.has(String(shopId))),
    ),
  };
}

function hasAnyWarehouseBlueprintEntries(warehouseBlueprint = {}) {
  return (
    Array.isArray(warehouseBlueprint.collectBoxDetailShopList)
    && warehouseBlueprint.collectBoxDetailShopList.length > 0
    && Object.keys(warehouseBlueprint.shopIdToWarehouseIds || {}).length > 0
  );
}

function normalizeCollectBoxShopEntry(shop = {}, site = '') {
  const shopId = String(shop && shop.shopId ? shop.shopId : '').trim();
  if (!shopId) {
    return null;
  }

  return {
    ...shop,
    shopId,
    site: String(shop.site || site || '').toUpperCase(),
    brandId: shop.brandId !== undefined && shop.brandId !== null
      ? String(shop.brandId)
      : '0',
    brandName: normalizeText(shop.brandName) || 'No Brand',
    deliveryOptionSetType: shop.deliveryOptionSetType || DEFAULT_DELIVERY_OPTION_SET_TYPE,
    deliveryOptionIds: Array.isArray(shop.deliveryOptionIds) ? shop.deliveryOptionIds : [],
    manufacturerIds: Array.isArray(shop.manufacturerIds) ? shop.manufacturerIds : [],
    responsiblePersonIds: Array.isArray(shop.responsiblePersonIds) ? shop.responsiblePersonIds : [],
    sizeChartTemplateId: shop.sizeChartTemplateId || '',
  };
}

function buildSelectedShopEntryMap({
  site = '',
  selectedShopIds = [],
  selectedShops = [],
  currentItemInfo = {},
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const selectedShopIdSet = new Set(uniqueIdList(selectedShopIds));
  const selectedShopMap = new Map();

  for (const source of [
    ...(Array.isArray(currentItemInfo.collectBoxDetailShopList) ? currentItemInfo.collectBoxDetailShopList : []),
    ...(Array.isArray(selectedShops) ? selectedShops : []),
  ]) {
    const normalized = normalizeCollectBoxShopEntry(source, normalizedSite);
    if (!normalized) {
      continue;
    }
    if (selectedShopIdSet.size > 0 && !selectedShopIdSet.has(String(normalized.shopId))) {
      continue;
    }
    selectedShopMap.set(String(normalized.shopId), normalized);
  }

  for (const shopId of selectedShopIdSet) {
    if (!selectedShopMap.has(String(shopId))) {
      const fallbackShop = normalizeCollectBoxShopEntry({ shopId, site: normalizedSite }, normalizedSite);
      if (fallbackShop) {
        selectedShopMap.set(String(shopId), fallbackShop);
      }
    }
  }

  return selectedShopMap;
}

function collectActiveWarehouseIds(warehouseList = []) {
  const normalizedList = Array.isArray(warehouseList) ? warehouseList : [];
  const activeWarehouses = normalizedList.filter((warehouse) => String(warehouse.warehouseEffectStatus || '1') === '1');
  const resolvedList = activeWarehouses.length > 0 ? activeWarehouses : normalizedList;
  return uniqueIdList(resolvedList.map((warehouse) => warehouse && warehouse.warehouseId));
}

async function buildWarehouseBlueprintFromShopWarehouseApi({
  site,
  selectedShopIds = [],
  selectedShops = [],
  currentItemInfo = {},
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const normalizedSelectedShopIds = uniqueIdList(selectedShopIds);
  const selectedShopMap = buildSelectedShopEntryMap({
    site: normalizedSite,
    selectedShopIds: normalizedSelectedShopIds,
    selectedShops,
    currentItemInfo,
  });
  const resultList = await collectShopWarehouseListBySite({
    site: normalizedSite,
    shopIds: normalizedSelectedShopIds,
  });
  const warehouseInfoByShopId = new Map(
    (Array.isArray(resultList) ? resultList : [])
      .map((entry) => [String(entry.shopId), entry]),
  );

  const collectBoxDetailShopList = [];
  const shopIdToWarehouseIds = {};

  for (const shopId of normalizedSelectedShopIds) {
    const normalizedShop = selectedShopMap.get(String(shopId));
    if (normalizedShop) {
      collectBoxDetailShopList.push(normalizedShop);
    }
    const warehouseEntry = warehouseInfoByShopId.get(String(shopId));
    const warehouseIds = collectActiveWarehouseIds(warehouseEntry && warehouseEntry.warehouseList);
    if (warehouseIds.length > 0) {
      shopIdToWarehouseIds[String(shopId)] = warehouseIds;
    }
  }

  return {
    collectBoxDetailShopList,
    shopIdToWarehouseIds,
  };
}

function buildWarehouseCoverageCacheKey({
  platform = 'tiktok',
  sites = DEFAULT_TIKTOK_SHOP_SITES,
  candidateDetailIds = [],
} = {}) {
  const normalizedSites = uniqueIdList(sites).map((site) => String(site).toUpperCase()).sort();
  const normalizedDetailCount = uniqueIdList(candidateDetailIds).length;
  return `${String(platform || 'tiktok').toLowerCase()}::${normalizedSites.join(',')}::${normalizedDetailCount}`;
}

function collectMappedShopIdsFromItemInfo(itemInfo = {}) {
  const mappedShopIds = new Set();

  for (const skuValue of Object.values(itemInfo.skuMap || {})) {
    const shopMap = skuValue && skuValue.shopIdToWarehouseIdAndStockMap
      ? skuValue.shopIdToWarehouseIdAndStockMap
      : {};

    for (const [shopId, warehouseMap] of Object.entries(shopMap)) {
      if (Object.keys(warehouseMap || {}).length > 0) {
        mappedShopIds.add(String(shopId));
      }
    }
  }

  return mappedShopIds;
}

async function buildWarehouseCoverageIndex({
  platform = 'tiktok',
  sites = DEFAULT_TIKTOK_SHOP_SITES,
  candidateDetailIds = [],
} = {}) {
  const normalizedSites = uniqueIdList(sites).map((site) => String(site).toUpperCase());
  const normalizedDetailIds = uniqueIdList(candidateDetailIds).map((value) => String(value));
  const cacheKey = buildWarehouseCoverageCacheKey({
    platform,
    sites: normalizedSites,
    candidateDetailIds: normalizedDetailIds,
  });
  const cached = warehouseCoverageIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const mappedShopIdSet = new Set();

  let shopWarehouseApiSucceeded = false;
  for (const site of normalizedSites) {
    try {
      const shops = await collectShopsBySite({
        platform,
        site,
      });
      const siteShopIds = uniqueIdList(shops.map((shop) => shop.shopId));
      if (siteShopIds.length === 0) {
        continue;
      }
      const shopWarehouseList = await collectShopWarehouseListBySite({
        site,
        shopIds: siteShopIds,
      });
      for (const entry of shopWarehouseList) {
        const shopId = String(entry && entry.shopId ? entry.shopId : '').trim();
        if (!shopId) {
          continue;
        }
        const warehouseIds = collectActiveWarehouseIds(entry.warehouseList);
        if (warehouseIds.length > 0) {
          mappedShopIdSet.add(shopId);
        }
      }
      shopWarehouseApiSucceeded = true;
    } catch (error) {
      continue;
    }
  }

  if (!shopWarehouseApiSucceeded || mappedShopIdSet.size === 0) {
    for (const detailId of normalizedDetailIds) {
      for (const site of normalizedSites) {
        try {
          const detail = await getSiteCollectItemInfo({ detailId, site });
          const data = detail && detail.data ? detail.data : detail;
          const itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
          const mappedForItem = collectMappedShopIdsFromItemInfo(itemInfo);
          for (const shopId of mappedForItem) {
            mappedShopIdSet.add(String(shopId));
          }
        } catch (error) {
          continue;
        }
      }
    }
  }

  const index = {
    platform,
    sites: normalizedSites,
    candidateDetailCount: normalizedDetailIds.length,
    mappedShopIdSet,
  };
  warehouseCoverageIndexCache.set(cacheKey, index);
  return index;
}

async function collectBlueprintCandidateDetailIds({
  pageNo = 0,
  pageSize = 20,
  maxPages = 20,
} = {}) {
  const items = await collectCollectBoxItems({
    pageNo,
    pageSize,
    maxPages,
  });

  return uniqueIdList(items.map((item) => item.detailId || item.collectBoxDetailId));
}

async function resolveSiteWarehouseBlueprint({
  site,
  selectedShopIds = [],
  selectedShops = [],
  currentItemInfo,
  candidateDetailIds = [],
  blueprintCacheBySite,
} = {}) {
  const normalizedSelectedShopIds = uniqueIdList(selectedShopIds);
  const siteKey = String(site || '').toUpperCase();
  const selectedShopMap = buildSelectedShopEntryMap({
    site: siteKey,
    selectedShopIds: normalizedSelectedShopIds,
    selectedShops,
    currentItemInfo,
  });
  let mergedBlueprint = mergeWarehouseBlueprint(
    blueprintCacheBySite && blueprintCacheBySite.get(siteKey),
    {
      collectBoxDetailShopList: [...selectedShopMap.values()],
      shopIdToWarehouseIds: {},
    },
  );
  mergedBlueprint = mergeWarehouseBlueprint(
    mergedBlueprint,
    extractWarehouseBlueprint(currentItemInfo, normalizedSelectedShopIds),
  );

  if (hasWarehouseBlueprintCoverage(mergedBlueprint, normalizedSelectedShopIds)) {
    if (blueprintCacheBySite) {
      blueprintCacheBySite.set(siteKey, mergedBlueprint);
    }
    return mergedBlueprint;
  }

  for (const detailId of uniqueIdList(candidateDetailIds)) {
    try {
      const detail = await getSiteCollectItemInfo({ detailId, site: siteKey });
      const data = detail && detail.data ? detail.data : detail;
      const itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
      mergedBlueprint = mergeWarehouseBlueprint(
        mergedBlueprint,
        extractWarehouseBlueprint(itemInfo, normalizedSelectedShopIds),
      );

      if (hasWarehouseBlueprintCoverage(mergedBlueprint, normalizedSelectedShopIds)) {
        break;
      }
    } catch (error) {
      continue;
    }
  }

  if (blueprintCacheBySite) {
    blueprintCacheBySite.set(siteKey, mergedBlueprint);
  }

  if (!hasWarehouseBlueprintCoverage(mergedBlueprint, normalizedSelectedShopIds)) {
    try {
      const apiBlueprint = await buildWarehouseBlueprintFromShopWarehouseApi({
        site: siteKey,
        selectedShopIds: normalizedSelectedShopIds,
        selectedShops: [...selectedShopMap.values()],
        currentItemInfo,
      });
      mergedBlueprint = mergeWarehouseBlueprint(mergedBlueprint, apiBlueprint);
      if (blueprintCacheBySite) {
        blueprintCacheBySite.set(siteKey, mergedBlueprint);
      }
    } catch (error) {
      // keep merged blueprint from detail-based fallback
    }
  }

  if (!hasWarehouseBlueprintCoverage(mergedBlueprint, normalizedSelectedShopIds)) {
    const missingShopIds = normalizedSelectedShopIds.filter((shopId) => {
      const warehouseIds = mergedBlueprint.shopIdToWarehouseIds
        ? mergedBlueprint.shopIdToWarehouseIds[String(shopId)]
        : null;

      return !(Array.isArray(warehouseIds) && warehouseIds.length > 0);
    });

    throw new Error(`Unable to resolve warehouse blueprint for site ${siteKey}. Missing shops: ${missingShopIds.join(', ')}`);
  }

  return mergedBlueprint;
}

function parseMissingShopIdsFromWarehouseError(error) {
  const message = String(error && error.message ? error.message : error || '');
  const matched = message.match(/Missing shops:\s*([0-9,\s]+)/i);
  if (!matched || !matched[1]) {
    return [];
  }
  return uniqueIdList(
    matched[1]
      .split(',')
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
}

function buildClaimShopIdsAvoidingMissingSourceShops({
  currentClaimShopIds = [],
  missingSourceShopIds = [],
  sourceSite = 'PH',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  shopGroupIndex = {},
  preferredShopIdSet = null,
} = {}) {
  const normalizedSourceSite = String(sourceSite || '').toUpperCase();
  const normalizedCurrentClaimShopIds = uniqueIdList(currentClaimShopIds);
  const normalizedMissingShopIds = uniqueIdList(missingSourceShopIds);
  const normalizedGroupSites = uniqueIdList(groupSites).map((site) => String(site).toUpperCase());
  const groupMap = buildShopGroupMap(shopGroupIndex);
  const claimShopIdSet = new Set(normalizedCurrentClaimShopIds);
  const replacementLogs = [];
  const unresolvedMissingShopIds = [];

  for (const missingShopId of normalizedMissingShopIds) {
    const groupKey = shopGroupIndex.shopIdToGroupKey
      ? shopGroupIndex.shopIdToGroupKey.get(String(missingShopId))
      : null;
    const group = groupKey ? groupMap.get(groupKey) : null;

    if (!group || !Array.isArray(group.shops) || group.shops.length === 0) {
      unresolvedMissingShopIds.push(String(missingShopId));
      continue;
    }

    const groupCurrentShopIds = normalizedCurrentClaimShopIds.filter((shopId) => (
      (shopGroupIndex.shopIdToGroupKey
        ? shopGroupIndex.shopIdToGroupKey.get(String(shopId))
        : null) === groupKey
    ));

    const candidatePreferredSites = [
      ...normalizedGroupSites.filter((site) => site !== normalizedSourceSite),
      normalizedSourceSite,
    ];
    const replacementShop = selectOneSiteShopPerGroup(group, candidatePreferredSites, {
      preferredShopIdSet,
    });
    const replacementShopId = replacementShop && replacementShop.shopId
      ? String(replacementShop.shopId)
      : '';

    if (!replacementShopId) {
      unresolvedMissingShopIds.push(String(missingShopId));
      continue;
    }

    const hadSourceMissingInCurrent = groupCurrentShopIds.some(
      (shopId) => String(shopId) === String(missingShopId),
    );

    if (!hadSourceMissingInCurrent) {
      continue;
    }

    for (const existingShopId of groupCurrentShopIds) {
      claimShopIdSet.delete(String(existingShopId));
    }
    claimShopIdSet.add(String(replacementShopId));
    replacementLogs.push({
      groupKey,
      fromShopId: String(missingShopId),
      toShopId: String(replacementShopId),
      toSite: String(replacementShop.site || '').toUpperCase(),
    });
  }

  return {
    claimShopIds: uniqueIdList([...claimShopIdSet]),
    replacementLogs,
    unresolvedMissingShopIds: uniqueIdList(unresolvedMissingShopIds),
  };
}

async function resolveDefaultSiteWarehouseBlueprint({
  site,
  currentItemInfo,
  candidateDetailIds = [],
  blueprintCacheBySite,
} = {}) {
  const siteKey = String(site || '').toUpperCase();
  let mergedBlueprint = mergeWarehouseBlueprint(
    blueprintCacheBySite && blueprintCacheBySite.get(siteKey),
    extractWarehouseBlueprint(currentItemInfo),
  );

  if (hasAnyWarehouseBlueprintEntries(mergedBlueprint)) {
    if (blueprintCacheBySite) {
      blueprintCacheBySite.set(siteKey, mergedBlueprint);
    }
    return mergedBlueprint;
  }

  for (const detailId of uniqueIdList(candidateDetailIds)) {
    try {
      const detail = await getSiteCollectItemInfo({ detailId, site: siteKey });
      const data = detail && detail.data ? detail.data : detail;
      const itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
      mergedBlueprint = mergeWarehouseBlueprint(
        mergedBlueprint,
        extractWarehouseBlueprint(itemInfo),
      );

      if (hasAnyWarehouseBlueprintEntries(mergedBlueprint)) {
        break;
      }
    } catch (error) {
      continue;
    }
  }

  if (blueprintCacheBySite) {
    blueprintCacheBySite.set(siteKey, mergedBlueprint);
  }

  if (!hasAnyWarehouseBlueprintEntries(mergedBlueprint)) {
    throw new Error(`Unable to resolve default site blueprint for site ${siteKey}.`);
  }

  return mergedBlueprint;
}

function buildSyncedSkuMapForTarget(sourceItemInfo = {}, targetWarehouseBlueprint = {}) {
  const sourceSkuMap = cloneJson(sourceItemInfo.skuMap) || {};
  const fallbackWeight = resolveFallbackWeight(sourceItemInfo, sourceSkuMap);

  return Object.fromEntries(
    Object.entries(sourceSkuMap).map(([skuKey, skuValue]) => [
      skuKey,
      {
        ...skuValue,
        weight: parsePositiveNumber(skuValue && skuValue.weight) || fallbackWeight,
        shopIdToWarehouseIdAndStockMap: buildWarehouseStockMapFromBlueprint(
          targetWarehouseBlueprint,
          skuValue.stock,
        ),
      },
    ]),
  );
}

async function buildCrossSiteFieldSyncSaveBody(
  sourceApiData,
  targetApiData,
  {
    targetSelectedShopList = [],
    targetWarehouseBlueprint = {},
    claimToShopIds = [],
  } = {},
) {
  const sourceData = sourceApiData && sourceApiData.data ? sourceApiData.data : sourceApiData;
  const targetData = targetApiData && targetApiData.data ? targetApiData.data : targetApiData;
  const sourceItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults(
    sourceData.siteCollectItemInfo || sourceData.collectItemInfo || sourceData.itemInfo || sourceData,
  ));
  const targetItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults(
    targetData.siteCollectItemInfo || targetData.collectItemInfo || targetData.itemInfo || targetData,
  ));
  const normalizedSourceSpec = buildNormalizedPreparedSpec(sourceItemInfo);
  const translatedSourceSkuPropertyList = await translateSkuPropertyListToEnglish(
    normalizedSourceSpec.skuPropertyList,
  );
  const sourceWeight = resolveFallbackWeight(sourceItemInfo, normalizedSourceSpec.skuMap);
  const sourceItemInfoForSync = sanitizeOptionalFields(withDeliveryOptionDefaults({
    ...cloneJson(sourceItemInfo),
    weight: sourceWeight,
    skuPropertyList: translatedSourceSkuPropertyList,
    skuMap: cleanSkuMap(
      normalizedSourceSpec.skuMap,
      { ...sourceItemInfo, weight: sourceWeight, skuPropertyList: normalizedSourceSpec.skuPropertyList },
      sourceWeight,
      { forceUnifiedWeight: false, addWeightPadding: false },
    ),
  }));

  if (!Array.isArray(targetSelectedShopList) || targetSelectedShopList.length === 0) {
    throw new Error(`Target site ${targetItemInfo.site} has no selected shop blueprint.`);
  }

  const syncedItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults({
    ...cloneJson(sourceItemInfoForSync),
    site: targetItemInfo.site,
    detailId: targetItemInfo.detailId,
    weight: sourceWeight,
    skuPropertyList: cloneJson(sourceItemInfoForSync.skuPropertyList),
    collectBoxDetailShopList: cloneJson(targetSelectedShopList),
    skuMap: buildSyncedSkuMapForTarget(sourceItemInfoForSync, targetWarehouseBlueprint),
  }));

  const currentComparable = buildCrossSiteComparableSnapshot(targetItemInfo);
  const syncedComparable = buildCrossSiteComparableSnapshot(syncedItemInfo);
  const changed = JSON.stringify(currentComparable) !== JSON.stringify(syncedComparable);
  const normalizedClaimToShopIds = Array.isArray(claimToShopIds) && claimToShopIds.length > 0
    ? normalizeNumericIdList(claimToShopIds)
    : normalizeNumericIdList(
      Array.isArray(targetSelectedShopList) ? targetSelectedShopList.map((shop) => shop.shopId) : [],
    );

  return {
    saveBody: {
      ...targetData,
      claimToShopIds: normalizedClaimToShopIds,
      site: syncedItemInfo.site,
      detailId: syncedItemInfo.detailId,
      siteCollectItemInfo: syncedItemInfo,
    },
    changed,
    oldTitle: targetItemInfo.title,
    newTitle: syncedItemInfo.title,
    oldCid: targetItemInfo.cid,
    newCid: syncedItemInfo.cid,
    selectedShopCount: Array.isArray(syncedItemInfo.collectBoxDetailShopList)
      ? syncedItemInfo.collectBoxDetailShopList.length
      : 0,
    skuCount: Object.keys(syncedItemInfo.skuMap || {}).length,
  };
}

async function syncSiteFieldsAcrossSites({
  sourceSite,
  targetSites = [],
  searchParams = {},
  platform = 'tiktok',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  apply = false,
  requestIntervalMs = 1200,
  syncScope = 'group',
  preferredSourceShopId = '',
  onProgress = null,
} = {}) {
  if (!sourceSite) {
    throw new Error('Missing --site. Example: node miaoshou_auto.js sync-site-fields --site PH --detail-ids 123');
  }

  const items = await resolveTargetItems(searchParams);
  const normalizedSourceSite = String(sourceSite).toUpperCase();
  const providedTargetSites = uniqueIdList(targetSites).map((site) => String(site).toUpperCase());
  const normalizedGroupSites = uniqueIdList(
    providedTargetSites.length > 0
      ? [normalizedSourceSite, ...providedTargetSites]
      : groupSites,
  ).map((site) => String(site).toUpperCase());
  const shopGroupIndex = await buildShopGroupIndex({ platform, sites: normalizedGroupSites });
  const blueprintCacheBySite = new Map();
  const candidateDetailIds = await collectBlueprintCandidateDetailIds();
  const warehouseCoverageIndex = await buildWarehouseCoverageIndex({
    platform,
    sites: normalizedGroupSites,
    candidateDetailIds,
  });
  const mappedShopIdSet = warehouseCoverageIndex.mappedShopIdSet;
  const results = [];
  let completedCount = 0;

  for (const item of items) {
    const detailId = item.detailId || item.collectBoxDetailId;

    try {
      const sourceDetail = await getSiteCollectItemInfo({ detailId, site: normalizedSourceSite });
      const sourceData = sourceDetail && sourceDetail.data ? sourceDetail.data : sourceDetail;
      const sourceItemInfo = sourceData.siteCollectItemInfo || sourceData.collectItemInfo || sourceData.itemInfo || sourceData;
      const normalizedSyncScope = String(syncScope || '').toLowerCase();
      const primaryGroupKey = pickPrimaryGroupKeyFromSourceInfo(
        sourceItemInfo,
        normalizedSourceSite,
        shopGroupIndex,
        preferredSourceShopId,
      );
      const sourceItemInfoForSync = normalizedSyncScope === 'singlegroup' && primaryGroupKey
        ? filterSourceItemInfoByGroupKey(sourceItemInfo, shopGroupIndex, primaryGroupKey)
        : sourceItemInfo;
      const inferredTargetSites = inferTargetSitesFromSourceInfo(
        sourceItemInfoForSync,
        normalizedSourceSite,
        shopGroupIndex,
      );
      const requestedTargetSites = providedTargetSites
        .filter((site) => site !== normalizedSourceSite);
      const resolvedTargetSites = requestedTargetSites.length > 0
        ? requestedTargetSites.filter((site) => inferredTargetSites.includes(site))
        : inferredTargetSites;

      if (resolvedTargetSites.length === 0) {
        const requestedText = requestedTargetSites.length > 0
          ? ` requested=${requestedTargetSites.join(',')}`
          : '';
        const inferredText = inferredTargetSites.length > 0
          ? ` inferred=${inferredTargetSites.join(',')}`
          : ' inferred=none';
        results.push({
          detailId,
          sourceSite: normalizedSourceSite,
          skipped: true,
          syncRequired: false,
          reason: `No related target sites were inferred from the current source shop selection.${requestedText}${inferredText}`,
        });
        completedCount += 1;
        emitProgress(onProgress, {
          phase: 'sync',
          completed: completedCount,
          total: items.length,
          detailId: String(detailId),
        });
        continue;
      }

      const targetPlans = [];

      for (const targetSite of resolvedTargetSites) {
        try {
          const targetDetail = await getSiteCollectItemInfo({ detailId, site: targetSite });
          const targetData = targetDetail && targetDetail.data ? targetDetail.data : targetDetail;
          const targetItemInfo = targetData.siteCollectItemInfo || targetData.collectItemInfo || targetData.itemInfo || targetData;
          const existingTargetShops = Array.isArray(targetItemInfo.collectBoxDetailShopList)
            ? targetItemInfo.collectBoxDetailShopList
            : [];
          const existingTargetShopIds = uniqueIdList(existingTargetShops.map((shop) => shop && shop.shopId));

          if (existingTargetShopIds.length === 0) {
            targetPlans.push({
              targetSite,
              skipped: true,
              syncRequired: false,
              reason: `Target site ${targetSite} has no existing selected shops; skipped to avoid auto-claiming target site.`,
            });
            continue;
          }

          const precheckMissingShopIds = existingTargetShopIds
            .filter((shopId) => !mappedShopIdSet.has(String(shopId)));
          if (precheckMissingShopIds.length > 0) {
            throw new Error(
              `Warehouse precheck failed for site ${targetSite}. No known warehouse mapping for shops: ${precheckMissingShopIds.join(', ')}`,
            );
          }

          const inferredBlueprint = await resolveSiteWarehouseBlueprint({
            site: targetSite,
            selectedShopIds: existingTargetShopIds,
            selectedShops: existingTargetShops,
            currentItemInfo: targetItemInfo,
            candidateDetailIds,
            blueprintCacheBySite,
          });
          const selectedShopBlueprint = pickWarehouseBlueprintForShopIds(
            inferredBlueprint,
            existingTargetShopIds,
          );

          if (!hasWarehouseBlueprintCoverage(
            selectedShopBlueprint,
            existingTargetShopIds,
          )) {
            throw new Error(
              `Mapped target shops for site ${targetSite} have incomplete warehouse mapping.`,
            );
          }

          targetPlans.push({
            targetSite,
            targetDetail,
            targetItemInfo,
            selectedShopBlueprint,
            claimToShopIds: normalizeNumericIdList(existingTargetShopIds),
            selectionStrategy: 'existingTargetShops',
          });
        } catch (error) {
          targetPlans.push({
            targetSite,
            error: error.message || String(error),
          });
        }
      }

      for (const plan of targetPlans) {
        const result = {
          detailId,
          sourceSite: normalizedSourceSite,
          targetSite: plan.targetSite,
          applied: false,
          skipped: false,
          syncRequired: true,
        };

        try {
          if (plan.skipped && plan.syncRequired === false) {
            Object.assign(result, {
              skipped: true,
              syncRequired: false,
              reason: plan.reason || 'Target site skipped.',
            });
            results.push(result);
            await sleep(requestIntervalMs);
            continue;
          }

          if (plan.error) {
            throw new Error(plan.error);
          }

          const updated = await buildCrossSiteFieldSyncSaveBody(sourceDetail, plan.targetDetail, {
            targetSelectedShopList: plan.selectedShopBlueprint.collectBoxDetailShopList,
            targetWarehouseBlueprint: plan.selectedShopBlueprint,
            claimToShopIds: plan.claimToShopIds,
          });

          Object.assign(result, {
            selectionStrategy: plan.selectionStrategy,
            changed: updated.changed,
            oldTitle: updated.oldTitle,
            newTitle: updated.newTitle,
            oldCid: updated.oldCid,
            newCid: updated.newCid,
            selectedShopCount: updated.selectedShopCount,
            skuCount: updated.skuCount,
          });

          if (apply && updated.changed) {
            try {
              await saveSiteCollectItemInfo(updated.saveBody);
              result.applied = true;
            } catch (saveError) {
              const saveErrorMessage = saveError && saveError.message
                ? saveError.message
                : String(saveError);

              if (!saveErrorMessage.includes('产品数据发生变动')) {
                throw saveError;
              }

              const latestTargetDetail = await getSiteCollectItemInfo({
                detailId,
                site: plan.targetSite,
              });
              const retried = await buildCrossSiteFieldSyncSaveBody(sourceDetail, latestTargetDetail, {
                targetSelectedShopList: plan.selectedShopBlueprint.collectBoxDetailShopList,
                targetWarehouseBlueprint: plan.selectedShopBlueprint,
                claimToShopIds: plan.claimToShopIds,
              });

              Object.assign(result, {
                retryOnConflict: true,
                changed: retried.changed,
                oldTitle: retried.oldTitle,
                newTitle: retried.newTitle,
                oldCid: retried.oldCid,
                newCid: retried.newCid,
                selectedShopCount: retried.selectedShopCount,
                skuCount: retried.skuCount,
              });

              if (retried.changed) {
                await saveSiteCollectItemInfo(retried.saveBody);
                result.applied = true;
              }
            }
          }
        } catch (error) {
          result.skipped = true;
          result.error = error.message || String(error);
        }

        results.push(result);
        await sleep(requestIntervalMs);
      }
    } catch (error) {
      results.push({
        detailId,
        sourceSite: normalizedSourceSite,
        skipped: true,
        syncRequired: true,
        error: error.message || String(error),
      });
    }

    completedCount += 1;
    emitProgress(onProgress, {
      phase: 'sync',
      completed: completedCount,
      total: items.length,
      detailId: String(detailId),
    });
  }

  return {
    apply,
    platform,
    sourceSite: normalizedSourceSite,
    targetSites: providedTargetSites,
    inferredByShopGroups: providedTargetSites.length === 0,
    totalCount: items.length,
    appliedCount: results.filter((item) => item.applied).length,
    changedCount: results.filter((item) => item.changed).length,
    skippedCount: results.filter((item) => item.skipped).length,
    errorCount: results.filter((item) => item.error).length,
    results,
  };
}

// 主业务：查询采集箱商品 -> 拉取编辑详情 -> 用 Kimi 优化标题 -> 可选保存。
// 默认 apply=false 只输出新旧标题对照；加 --apply 才会真正写回妙手。
async function optimizeQueriedItemTitles({
  site,
  categoryName = DEFAULT_CATEGORY_NAME,
  searchParams = {},
  batchSize = 5,
  requestIntervalMs = 1500,
  apply = false,
  model = '',
  maxTitleLength = DEFAULT_TITLE_MAX_LENGTH,
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  autoClaimMode = 'allGroups',
  preferredSourceShopId = '',
  forceClaimMode = '',
  sourcePriceExtraCny = 0,
  skuWeightPaddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
  onProgress = null,
} = {}) {
  if (!site) {
    throw new Error('Missing --site. Example: node miaoshou_auto.js optimize-titles --site PH');
  }

  const titleOptimizeModel = getTitleOptimizeModel(model);
  const imageAuditModel = getImageAuditModel();
  const skuTranslationModel = getSkuTranslationModel();
  const normalizedGroupSites = uniqueIdList(groupSites).map((item) => String(item).toUpperCase());
  const category = categoryName ? await findCategoryByName({ site, categoryName }) : null;
  const items = await resolveTargetItems(searchParams);
  const batches = chunkArray(items, batchSize);
  const blueprintCacheBySite = new Map();
  const candidateDetailIds = await collectBlueprintCandidateDetailIds();
  const warehouseCoverageIndex = await buildWarehouseCoverageIndex({
    platform: 'tiktok',
    sites: normalizedGroupSites,
    candidateDetailIds,
  });
  const preferredWarehouseShopIdSet = warehouseCoverageIndex.mappedShopIdSet;
  const normalizedAutoClaimMode = String(autoClaimMode || 'allGroups').trim().toLowerCase() === 'singlegroup'
    ? 'singleGroup'
    : 'allGroups';
  const results = [];
  let completedCount = 0;

  for (const batch of batches) {
    for (const item of batch) {
      const detailId = item.detailId || item.collectBoxDetailId;
      const result = {
        detailId,
        itemNum: item.itemNum,
        site,
        applied: false,
        changed: false,
        skipped: false,
      };

      try {
        let detail = await getSiteCollectItemInfo({ detailId, site });
        let data = detail && detail.data ? detail.data : detail;
        let itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
        const normalizedForceClaimMode = String(forceClaimMode || '').trim().toLowerCase();
        let forcedClaimShopIds = [];
        let warehouseFallbackClaimShopIds = [];
        let warehouseFallbackReclaimLogs = [];

        if (apply && (normalizedForceClaimMode === 'allgroups' || normalizedForceClaimMode === 'singlegroup')) {
          const forcedMode = normalizedForceClaimMode === 'allgroups' ? 'allGroups' : 'singleGroup';
          const candidateForceClaimShopIds = await getAutoClaimShopIds({
            platform: 'tiktok',
            sourceSite: site,
            groupSites: normalizedGroupSites,
            mode: forcedMode,
            preferredSourceShopId,
          });

          if (candidateForceClaimShopIds.length > 0) {
            forcedClaimShopIds = await claimItemsToShopsResolvingGlobalConflicts({
              detailId,
              shopIds: candidateForceClaimShopIds,
            });
            await sleep(500);
            detail = await getSiteCollectItemInfo({ detailId, site });
            data = detail && detail.data ? detail.data : detail;
            itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
          }
        }

        const ensuredShops = apply
          ? await ensurePrePublishShopsForDetailV2({
            detailId,
            site,
            detailData: detail,
            platform: 'tiktok',
            groupSites: normalizedGroupSites,
            autoClaimMode: normalizedAutoClaimMode,
            preferredSourceShopId,
            preferredWarehouseShopIdSet,
          })
          : {
            detailData: detail,
            data,
            itemInfo,
            autoClaimed: false,
            autoClaimShopIds: [],
          };
        detail = ensuredShops.detailData;
        data = ensuredShops.data;
        itemInfo = ensuredShops.itemInfo;

        // When new shops are claimed, proactively backfill warehouse mappings from existing
        // same-site blueprints so save does not fail with "shop warehouse not selected".
        let selectedShopIds = uniqueIdList(
          (Array.isArray(itemInfo.collectBoxDetailShopList) ? itemInfo.collectBoxDetailShopList : [])
            .map((shop) => shop.shopId),
        );
        if (apply && selectedShopIds.length > 0) {
          let warehouseBlueprintResolved = false;
          let warehouseBlueprintError = null;

          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const sourceWarehouseBlueprint = await resolveSiteWarehouseBlueprint({
                site,
                selectedShopIds,
                selectedShops: Array.isArray(itemInfo.collectBoxDetailShopList)
                  ? itemInfo.collectBoxDetailShopList
                  : [],
                currentItemInfo: itemInfo,
                candidateDetailIds,
                blueprintCacheBySite,
              });
              const selectedWarehouseBlueprint = pickWarehouseBlueprintForShopIds(
                sourceWarehouseBlueprint,
                selectedShopIds,
              );
              const rebuiltSkuMap = buildSyncedSkuMapForTarget(itemInfo, selectedWarehouseBlueprint);
              const patchedItemInfo = sanitizeOptionalFields(withDeliveryOptionDefaults({
                ...itemInfo,
                collectBoxDetailShopList: Array.isArray(selectedWarehouseBlueprint.collectBoxDetailShopList)
                  && selectedWarehouseBlueprint.collectBoxDetailShopList.length > 0
                  ? cloneJson(selectedWarehouseBlueprint.collectBoxDetailShopList)
                  : itemInfo.collectBoxDetailShopList,
                skuMap: rebuiltSkuMap,
              }));
              itemInfo = patchedItemInfo;

              if (detail && detail.data) {
                detail.data.siteCollectItemInfo = patchedItemInfo;
              } else if (detail) {
                detail.siteCollectItemInfo = patchedItemInfo;
              }
              data = detail && detail.data ? detail.data : detail;
              warehouseBlueprintResolved = true;
              warehouseBlueprintError = null;
              break;
            } catch (error) {
              warehouseBlueprintError = error;
              if (attempt > 0) {
                break;
              }

              const missingSourceShopIds = parseMissingShopIdsFromWarehouseError(error);
              if (missingSourceShopIds.length === 0) {
                break;
              }

              const shopGroupIndex = await getShopGroupIndexFromCache({
                platform: 'tiktok',
                groupSites: normalizedGroupSites,
              });
              const currentClaimCoverageShopIds = collectClaimCoverageShopIds(data, itemInfo);
              const baselineClaimShopIds = buildAutoClaimShopIdsFromGroupIndex(shopGroupIndex, {
                preferredSite: site,
                groupSites: normalizedGroupSites,
                existingShopIds: currentClaimCoverageShopIds,
              });
              const reclaimPlan = buildClaimShopIdsAvoidingMissingSourceShops({
                currentClaimShopIds: baselineClaimShopIds,
                missingSourceShopIds,
                sourceSite: site,
                groupSites: normalizedGroupSites,
                shopGroupIndex,
                preferredShopIdSet: preferredWarehouseShopIdSet,
              });

              if (reclaimPlan.replacementLogs.length === 0 || reclaimPlan.claimShopIds.length === 0) {
                break;
              }

              const resolvedFallbackClaimShopIds = await claimItemsToShopsResolvingGlobalConflicts({
                detailId,
                shopIds: reclaimPlan.claimShopIds,
              });
              await sleep(500);
              warehouseFallbackClaimShopIds = uniqueIdList(resolvedFallbackClaimShopIds);
              warehouseFallbackReclaimLogs = reclaimPlan.replacementLogs;

              detail = await getSiteCollectItemInfo({ detailId, site });
              data = detail && detail.data ? detail.data : detail;
              itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
              selectedShopIds = uniqueIdList(
                (Array.isArray(itemInfo.collectBoxDetailShopList) ? itemInfo.collectBoxDetailShopList : [])
                  .map((shop) => shop.shopId),
              );
            }
          }

          if (!warehouseBlueprintResolved && warehouseBlueprintError) {
            throw warehouseBlueprintError;
          }
        }

        if (apply && !hasPrePublishShops(data, itemInfo)) {
          throw new Error('当前商品未选择预发布店铺，无法保存。请先在妙手里为该商品选择店铺。');
        }

        const sourceTitle = itemInfo.title || item.title;
        const optimized = await optimizeProductTitleWithKimi({
          title: sourceTitle,
          categoryName,
          site,
          item,
          itemInfo,
          model: titleOptimizeModel,
          maxTitleLength,
        });
        const selectedGrossWeightKg = chooseGrossWeightKg({
          currentWeightKg: itemInfo.weight,
          estimatedGrossWeightKg: optimized.estimatedGrossWeightKg,
          estimateSource: optimized.weightEstimateSource,
          estimateConfidence: optimized.weightEstimateConfidence,
        });
        const sourcePriceResolution = await resolveAccurateSourcePriceForItem({
          item,
          itemInfo,
          grossWeightKg: selectedGrossWeightKg,
        });
        const {
          saveBody,
          oldTitle,
          newTitle,
          oldNotesImageCount,
          newNotesImageCount,
          notesChanged,
          oldWeight,
          newWeight,
          weightChanged,
          oldSourcePriceCny,
          newSourcePriceCny,
          sourcePriceChanged,
          oldSpecDimension,
          newSpecDimension,
          removedSecondSpec,
          specChanged,
        } = await buildUpdatedTitleSiteCollectItemInfo(
          detail,
          optimized.optimizedTitle,
          maxTitleLength,
          category,
          selectedGrossWeightKg,
          sourcePriceResolution ? sourcePriceResolution.sourcePriceCny : null,
          sourcePriceResolution ? sourcePriceResolution.sourcePriceAdjustmentCny : null,
          sourcePriceResolution ? sourcePriceResolution.sourcePriceAdjustmentThresholdCny : null,
          {
            imageAuditModel,
            skuTranslationModel,
            sourcePriceExtraCny,
            skuWeightPaddingGrams,
          },
        );
        const claimSelectionChanged = Boolean(ensuredShops.claimSelectionChanged)
          || forcedClaimShopIds.length > 0
          || warehouseFallbackClaimShopIds.length > 0;
        const skipped = oldTitle === newTitle
          && (!category || String(saveBody.siteCollectItemInfo.cid || '') === String(itemInfo.cid || ''))
          && !notesChanged
          && !weightChanged
          && !sourcePriceChanged
          && !specChanged
          && !claimSelectionChanged;

        Object.assign(result, {
          oldTitle,
          newTitle,
          oldCid: itemInfo.cid,
          newCid: saveBody.siteCollectItemInfo.cid,
          oldNotesImageCount,
          newNotesImageCount,
          notesChanged,
          oldWeight,
          newWeight,
          weightChanged,
          oldSourcePriceCny,
          newSourcePriceCny,
          sourcePriceChanged,
          sourcePriceMethod: sourcePriceResolution ? sourcePriceResolution.source : null,
          sourcePriceUnitCny: sourcePriceResolution ? sourcePriceResolution.unitPriceCny : null,
          sourcePriceFreightCny: sourcePriceResolution ? sourcePriceResolution.freightPriceCny : null,
          sourcePriceAdjustmentCny: sourcePriceResolution
            ? sourcePriceResolution.sourcePriceAdjustmentCny
            : null,
          sourcePriceExtraCny: normalizeSourcePriceExtraCny(sourcePriceExtraCny),
          skuWeightPaddingGrams: normalizeSkuWeightPaddingGrams(skuWeightPaddingGrams),
          oldSpecDimension,
          newSpecDimension,
          removedSecondSpec,
          specChanged,
          sourcePriceLookupBlockedBy1688: sourcePriceResolution
            ? sourcePriceResolution.blockedBy1688
            : false,
          weightEstimateSource: optimized.weightEstimateSource,
          weightEstimateConfidence: optimized.weightEstimateConfidence,
          weightEstimateEvidence: optimized.weightEstimateEvidence,
          weightEstimateSourceUrl: optimized.weightEstimateSourceUrl,
          weightEstimateImageUrlCount: optimized.weightEstimateImageUrlCount,
          estimatedGrossWeightKg: optimized.estimatedGrossWeightKg,
          selectedGrossWeightKg,
          autoClaimed: Boolean(ensuredShops.autoClaimed)
            || forcedClaimShopIds.length > 0
            || warehouseFallbackClaimShopIds.length > 0,
          claimSelectionChanged,
          autoClaimShopIds: uniqueIdList([
            ...(forcedClaimShopIds || []),
            ...((ensuredShops.autoClaimShopIds) || []),
            ...(warehouseFallbackClaimShopIds || []),
          ]),
          warehouseFallbackReclaimLogs,
          changed: !skipped,
          skipped,
        });

        if (apply && !skipped) {
          await saveSiteCollectItemInfo(saveBody);
          result.applied = true;
        }
      } catch (error) {
        Object.assign(result, {
          oldTitle: item.title,
          error: error.message || String(error),
          skipped: true,
        });
      }

      results.push(result);
      completedCount += 1;
      emitProgress(onProgress, {
        phase: 'optimize',
        completed: completedCount,
        total: items.length,
        detailId: String(detailId),
        status: result.error ? 'error' : (result.applied ? 'applied' : 'ready'),
      });
      await sleep(requestIntervalMs);
    }
  }

  return {
    apply,
    site,
    category: category
      ? {
        cid: category.cid,
        name: category.name,
        breadcrumb: category.breadcrumb,
        isLastLevel: category.isLastLevel,
      }
      : null,
    model: titleOptimizeModel,
    imageAuditModel,
    skuTranslationModel,
    maxTitleLength,
    totalCount: items.length,
    changedCount: results.filter((item) => item.changed).length,
    appliedCount: results.filter((item) => item.applied).length,
    skippedCount: results.filter((item) => item.skipped).length,
    errorCount: results.filter((item) => item.error).length,
    results,
  };
}

async function syncShopConfigFromReference({
  site,
  searchParams = {},
  referenceDetailId,
  apply = false,
  requestIntervalMs = 1200,
} = {}) {
  if (!site) {
    throw new Error('Missing --site. Example: node miaoshou_auto.js sync-shop-config --site PH');
  }
  if (!referenceDetailId) {
    throw new Error('Missing --reference-detail-id. Example: --reference-detail-id 2931851918');
  }

  const items = await resolveTargetItems(searchParams);
  const targetDetailIds = uniqueIdList(items.map((item) => item.detailId || item.collectBoxDetailId))
    .filter((detailId) => String(detailId) !== String(referenceDetailId));

  if (targetDetailIds.length === 0) {
    throw new Error('No target detailIds to sync after excluding the reference detailId.');
  }

  const referenceDetail = await getSiteCollectItemInfo({ detailId: referenceDetailId, site });
  const referenceShopConfig = extractReferenceShopConfig(referenceDetail);

  if (apply && referenceShopConfig.claimToShopIds.length > 0) {
    await claimItemsToShops({
      detailIds: targetDetailIds,
      shopIds: referenceShopConfig.claimToShopIds,
    });
  }

  const results = [];
  for (const detailId of targetDetailIds) {
    const result = {
      detailId,
      referenceDetailId,
      applied: false,
      skipped: false,
    };

    try {
      const detail = await getSiteCollectItemInfo({ detailId, site });
      const data = detail && detail.data ? detail.data : detail;
      const itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
      const updated = await buildUpdatedShopConfigSiteCollectItemInfo(detail, referenceShopConfig);

      Object.assign(result, {
        title: itemInfo.title,
        oldClaimToShopCount: updated.oldClaimToShopCount,
        newClaimToShopCount: updated.newClaimToShopCount,
        oldSelectedShopCount: updated.oldSelectedShopCount,
        newSelectedShopCount: updated.newSelectedShopCount,
      });

      if (apply) {
        await saveSiteCollectItemInfo(updated.saveBody);
        result.applied = true;
      }
    } catch (error) {
      result.skipped = true;
      result.error = error.message || String(error);
    }

    results.push(result);
    await sleep(requestIntervalMs);
  }

  return {
    apply,
    site,
    referenceDetailId,
    targetDetailIds,
    referenceClaimToShopCount: referenceShopConfig.claimToShopIds.length,
    referenceSelectedShopCount: referenceShopConfig.collectBoxDetailShopList.length,
    results,
  };
}

// 主业务：查询商品列表 -> 查目标类目 cid -> 拉详情 -> 替换 cid -> 可选保存。
// 默认 apply=false 只做预览；加 --apply 才会真正调用保存接口。
async function updateQueriedItemsToCategory({
  site,
  categoryName = DEFAULT_CATEGORY_NAME,
  searchParams = {},
  batchSize = 10,
  requestIntervalMs = 1200,
  apply = false,
  allowNonLeaf = false,
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
} = {}) {
  if (!site) {
    throw new Error('Missing --site. Example: node miaoshou_auto.js set-category --site PH');
  }

  const category = await findCategoryByName({ site, categoryName });
  const normalizedGroupSites = uniqueIdList(groupSites).map((item) => String(item).toUpperCase());

  // TikTok 多数情况下要求选择末级类目；非末级默认拦截，避免保存后发布失败。
  if (!category.isLastLevel && !allowNonLeaf) {
    throw new Error(
      `Category "${category.name}" cid=${category.cid} is not a leaf category. `
      + 'Use a leaf category or add --allow-non-leaf if you are sure this API accepts it.',
    );
  }

  const items = await resolveTargetItems(searchParams);
  const batches = chunkArray(items, batchSize);
  const results = [];

  for (const batch of batches) {
    for (const item of batch) {
      const detailId = item.detailId || item.collectBoxDetailId;
      let detail = await getSiteCollectItemInfo({ detailId, site });
      let data = detail && detail.data ? detail.data : detail;
      let itemInfo = data.siteCollectItemInfo || data.collectItemInfo || data.itemInfo || data;
      const ensuredShops = await ensurePrePublishShopsForDetailV2({
        detailId,
        site,
        detailData: detail,
        platform: 'tiktok',
        groupSites: normalizedGroupSites,
        autoClaimMode: 'allGroups',
      });
      detail = ensuredShops.detailData;
      data = ensuredShops.data;
      itemInfo = ensuredShops.itemInfo;

      if (!hasPrePublishShops(data, itemInfo)) {
        results.push({
          detailId,
          title: item.title || itemInfo.title,
          itemNum: item.itemNum,
          site,
          skipped: true,
          applied: false,
          error: '当前商品未选择预发布店铺，无法保存。请先在妙手里为该商品选择店铺。',
        });
        await sleep(requestIntervalMs);
        continue;
      }

      const { saveBody, oldCid, newCid } = await buildUpdatedSiteCollectItemInfo(detail, category);
      const skipped = String(oldCid || '') === String(newCid);

      const result = {
        detailId,
        title: item.title || itemInfo.title,
        itemNum: item.itemNum,
        site,
        oldCid,
        newCid,
        autoClaimed: Boolean(ensuredShops.autoClaimed),
        autoClaimShopIds: ensuredShops.autoClaimShopIds || [],
        skipped,
        applied: false,
      };

      // dry-run 模式只记录即将修改的商品；只有 --apply 且 cid 不同时才保存。
      if (apply && !skipped) {
        await saveSiteCollectItemInfo(saveBody);
        result.applied = true;
      }

      results.push(result);
      await sleep(requestIntervalMs);
    }
  }

  return {
    apply,
    site,
    category: {
      cid: category.cid,
      name: category.name,
      breadcrumb: category.breadcrumb,
      isLastLevel: category.isLastLevel,
    },
    totalCount: items.length,
    changedCount: results.filter((item) => item.applied).length,
    skippedCount: results.filter((item) => item.skipped).length,
    results,
  };
}

// 控制台输出列表摘要，避免直接打印完整商品详情和店铺信息。
async function publishCollectBoxItems({
  site = 'PH',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  searchParams = {},
  requestIntervalMs = 1200,
  apply = false,
  shopIds = [],
  publishScope = 'mapped',
  platform = 'tiktok',
  preferredSourceShopId = '',
  onProgress = null,
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const normalizedGroupSites = uniqueIdList(groupSites).map((item) => String(item).toUpperCase());
  const manualShopIds = normalizeNumericIdList(shopIds);
  const items = await resolveTargetItems(searchParams);
  const resolvedPublishScope = String(publishScope || '').toLowerCase();
  const shopGroupIndex = (manualShopIds.length === 0 && resolvedPublishScope === 'groupallshops')
    ? await buildShopGroupIndex({ platform, sites: uniqueIdList([normalizedSite, ...normalizedGroupSites]) })
    : null;
  const results = [];
  let completedCount = 0;

  for (const item of items) {
    const detailId = item.detailId || item.collectBoxDetailId;
    const result = {
      detailId,
      itemNum: item.itemNum,
      title: item.title,
      site: normalizedSite,
      applied: false,
      skipped: false,
      shopIds: [],
      shopCount: 0,
      siteSummaries: [],
    };

    try {
      const resolved = manualShopIds.length > 0
        ? {
          detailId,
          shopIds: manualShopIds,
          siteSummaries: [],
        }
        : await resolvePublishShopIdsForDetail({
          detailId,
          sourceSite: normalizedSite,
          groupSites: normalizedGroupSites,
          shopGroupIndex,
          publishScope: resolvedPublishScope,
          preferredSourceShopId,
        });
      const publishShopIds = normalizeNumericIdList(resolved.shopIds);

      if (publishShopIds.length === 0) {
        throw new Error('No selected shopIds were found for this detailId.');
      }

      Object.assign(result, {
        shopIds: publishShopIds,
        shopCount: publishShopIds.length,
        siteSummaries: resolved.siteSummaries,
      });

      if (apply) {
        const publishResult = await saveMoveCollectTaskInShopBatches({
          detailIds: [detailId],
          shopIds: publishShopIds,
        });
        result.applied = true;
        result.publishResult = publishResult;
      }
    } catch (error) {
      if (error && Array.isArray(error.publishBatchResults)) {
        result.partialApplied = error.publishBatchResults.some((entry) => entry && entry.applied);
        result.publishResult = {
          batchCount: error.failedBatch && error.failedBatch.batchCount
            ? error.failedBatch.batchCount
            : error.publishBatchResults.length,
          batches: error.publishBatchResults,
        };
      }
      result.skipped = true;
      result.error = error.message || String(error);
    }

    results.push(result);
    completedCount += 1;
    emitProgress(onProgress, {
      phase: 'publish',
      completed: completedCount,
      total: items.length,
      detailId: String(detailId),
      status: result.error ? 'error' : (result.applied ? 'applied' : 'ready'),
    });
    await sleep(requestIntervalMs);
  }

  return {
    apply,
    site: normalizedSite,
    groupSites: normalizedGroupSites,
    totalCount: items.length,
    appliedCount: results.filter((entry) => entry.applied).length,
    skippedCount: results.filter((entry) => entry.skipped).length,
    errorCount: results.filter((entry) => entry.error).length,
    results,
  };
}

// 一体化流程：先编辑优化（标题/类目/图片清理/规格翻译/重量/来源价）-> 再同步到同大店铺其它站点 -> 最后按需发布。
// 即使只编辑不发布，也要同步其它站点，避免马来/泰国保留未处理数据。
async function editAndPublishCollectBoxItems({
  site = 'PH',
  groupSites = DEFAULT_TIKTOK_SHOP_SITES,
  targetSites = [],
  categoryName = DEFAULT_CATEGORY_NAME,
  searchParams = {},
  batchSize = 5,
  requestIntervalMs = 1200,
  apply = false,
  model = '',
  maxTitleLength = DEFAULT_TITLE_MAX_LENGTH,
  shopIds = [],
  publishAllShops = false,
  platform = 'tiktok',
  publishScope = 'group',
  syncScope = 'group',
  preferredSourceShopId = '',
  enablePublish = true,
  autoClaimMode = '',
  forceClaimMode = '',
  sourcePriceExtraCny = 0,
  skuWeightPaddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
  onProgress = null,
} = {}) {
  const normalizedSite = String(site || '').toUpperCase();
  const normalizedGroupSites = uniqueIdList(groupSites).map((item) => String(item).toUpperCase());
  const normalizedTargetSites = uniqueIdList(targetSites)
    .map((item) => String(item).toUpperCase())
    .filter((item) => item !== normalizedSite);

  const items = await resolveTargetItems(searchParams);
  const detailIds = uniqueIdList(items.map((item) => item.detailId || item.collectBoxDetailId));

  if (detailIds.length === 0) {
    return {
      apply,
      site: normalizedSite,
      groupSites: normalizedGroupSites,
      targetSites: normalizedTargetSites,
      totalCount: 0,
      detailIds: [],
      optimize: null,
      sync: null,
      publish: null,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      results: [],
    };
  }

  const scopedSearchParams = { detailIds };
  const resolvedAutoClaimMode = String(autoClaimMode || '').trim().toLowerCase() || 'allGroups';
  const emitWorkflowProgress = (event = {}) => {
    const phase = event.phase || 'prepare';
    const ranges = enablePublish
      ? {
        optimize: [0, 65],
        sync: [65, 90],
        publish: [90, 100],
      }
      : {
        optimize: [0, 75],
        sync: [75, 100],
        publish: [100, 100],
      };
    const range = ranges[phase] || [0, 0];
    const completed = Number(event.completed || 0);
    const total = Math.max(1, Number(event.total || detailIds.length || 1));
    const fraction = Math.max(0, Math.min(1, completed / total));
    const overallPercent = Math.max(0, Math.min(
      100,
      Math.round(range[0] + ((range[1] - range[0]) * fraction)),
    ));

    emitProgress(onProgress, {
      ...event,
      workflow: 'edit-publish',
      totalCount: detailIds.length,
      overallPercent,
    });
  };

  emitWorkflowProgress({
    phase: 'optimize',
    completed: 0,
    total: detailIds.length,
  });

  const optimize = await optimizeQueriedItemTitles({
    site: normalizedSite,
    categoryName,
    searchParams: scopedSearchParams,
    batchSize,
    requestIntervalMs,
    apply,
    model,
    maxTitleLength,
    groupSites: normalizedGroupSites,
    autoClaimMode: resolvedAutoClaimMode,
    preferredSourceShopId,
    forceClaimMode,
    sourcePriceExtraCny,
    skuWeightPaddingGrams,
    onProgress: emitWorkflowProgress,
  });

  const optimizedPassedDetailIds = uniqueIdList(
    (Array.isArray(optimize.results) ? optimize.results : [])
      .filter((entry) => !entry.error)
      .map((entry) => entry.detailId),
  );

  const shouldSyncSites = optimizedPassedDetailIds.length > 0;
  const sync = shouldSyncSites
    ? await syncSiteFieldsAcrossSites({
      sourceSite: normalizedSite,
      targetSites: normalizedTargetSites,
      searchParams: { detailIds: optimizedPassedDetailIds },
      platform: 'tiktok',
      groupSites: normalizedGroupSites,
      apply,
      requestIntervalMs,
      syncScope,
      preferredSourceShopId,
      onProgress: emitWorkflowProgress,
    })
    : {
      apply,
      sourceSite: normalizedSite,
      targetSites: normalizedTargetSites,
      inferredByShopGroups: normalizedTargetSites.length === 0,
      totalCount: 0,
      appliedCount: 0,
      changedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      results: [],
    };

  // 同步失败不阻断发布：优先确保源站点能正常发布，再回看跨站点同步异常。
  const syncResults = Array.isArray(sync.results) ? sync.results : [];
  const publishDetailIds = optimizedPassedDetailIds.filter((detailId) => {
    const entries = syncResults.filter((entry) => String(entry.detailId) === String(detailId));
    if (entries.length === 0) {
      return false;
    }

    const hasSyncError = entries.some((entry) => entry && entry.error);
    if (hasSyncError) {
      return false;
    }

    const hasBlockingSkip = entries.some((entry) => (
      entry
      && entry.skipped
      && entry.syncRequired !== false
    ));

    return !hasBlockingSkip;
  });

  let publishShopIds = normalizeNumericIdList(shopIds);
  let publishAllShopSnapshot = null;
  const resolvedPublishScope = String(publishScope || '').toLowerCase();

  if (publishAllShops && publishShopIds.length === 0 && resolvedPublishScope === 'global') {
    publishAllShopSnapshot = await collectAllShopIdsBySites({
      platform,
      sites: normalizedGroupSites,
      pageSize: 100,
      maxPages: 20,
    });
    publishShopIds = normalizeNumericIdList(
      publishAllShopSnapshot && Array.isArray(publishAllShopSnapshot.shopIds)
        ? publishAllShopSnapshot.shopIds
        : [],
    );
  }

  const publish = enablePublish && publishDetailIds.length > 0
    ? await publishCollectBoxItems({
      site: normalizedSite,
      groupSites: normalizedGroupSites,
      searchParams: { detailIds: publishDetailIds },
      requestIntervalMs,
      apply,
      shopIds: publishShopIds,
      publishScope: publishAllShops
        ? (resolvedPublishScope === 'global' ? 'mapped' : 'groupAllShops')
        : 'mapped',
      platform,
      preferredSourceShopId,
      onProgress: emitWorkflowProgress,
    })
    : {
      apply,
      site: normalizedSite,
      groupSites: normalizedGroupSites,
      totalCount: 0,
      appliedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      results: [],
    };
  const resolvedPublishShopIdCount = publishShopIds.length > 0
    ? publishShopIds.length
    : Math.max(
      0,
      ...(Array.isArray(publish.results) ? publish.results.map((entry) => Number(entry.shopCount || 0)) : [0]),
    );

  const perDetailSummary = detailIds.map((detailId) => {
    const optimizeEntry = Array.isArray(optimize.results)
      ? optimize.results.find((entry) => String(entry.detailId) === String(detailId))
      : null;
    const publishEntry = Array.isArray(publish.results)
      ? publish.results.find((entry) => String(entry.detailId) === String(detailId))
      : null;
    const syncEntries = Array.isArray(sync.results)
      ? sync.results.filter((entry) => String(entry.detailId) === String(detailId))
      : [];
    const syncError = syncEntries.find((entry) => entry && entry.error);

    return {
      detailId: String(detailId),
      optimizeStatus: optimizeEntry
        ? (optimizeEntry.error ? 'error' : (optimizeEntry.applied ? 'applied' : 'ready'))
        : 'missing',
      optimizeError: optimizeEntry && optimizeEntry.error ? optimizeEntry.error : '',
      syncStatus: syncEntries.length === 0
        ? 'none'
        : (syncError
          ? 'error'
          : (syncEntries.some((entry) => entry.applied)
            ? 'applied'
            : (syncEntries.every((entry) => entry && entry.skipped) ? 'skipped' : 'ready'))),
      syncError: syncError ? syncError.error : '',
      publishStatus: !enablePublish
        ? 'disabled'
        : (publishEntry
        ? (publishEntry.error ? 'error' : (publishEntry.applied ? 'applied' : 'ready'))
        : 'none'),
      publishError: publishEntry && publishEntry.error ? publishEntry.error : '',
      oldTitle: optimizeEntry && optimizeEntry.oldTitle ? optimizeEntry.oldTitle : '',
      newTitle: optimizeEntry && optimizeEntry.newTitle ? optimizeEntry.newTitle : '',
      oldCid: optimizeEntry && optimizeEntry.oldCid ? optimizeEntry.oldCid : '',
      newCid: optimizeEntry && optimizeEntry.newCid ? optimizeEntry.newCid : '',
      notesChanged: Boolean(optimizeEntry && optimizeEntry.notesChanged),
    };
  });
  emitProgress(onProgress, {
    workflow: 'edit-publish',
    phase: 'complete',
    completed: detailIds.length,
    total: detailIds.length,
    totalCount: detailIds.length,
    overallPercent: 100,
  });

  return {
    apply,
    site: normalizedSite,
    groupSites: normalizedGroupSites,
    targetSites: normalizedTargetSites,
    totalCount: detailIds.length,
    detailIds,
    optimize,
    sync,
    publish,
    publishAllShops,
    publishScope: resolvedPublishScope,
    syncScope: String(syncScope || '').toLowerCase(),
    publishShopIdCount: resolvedPublishShopIdCount,
    publishAllShopSnapshot,
    successCount: enablePublish
      ? perDetailSummary.filter((entry) => entry.publishStatus === 'applied').length
      : perDetailSummary.filter((entry) => entry.optimizeStatus !== 'error' && entry.syncStatus !== 'error').length,
    errorCount: perDetailSummary.filter((entry) => (
      entry.optimizeStatus === 'error' || entry.syncStatus === 'error' || entry.publishStatus === 'error'
    )).length,
    skippedCount: perDetailSummary.filter((entry) => entry.publishStatus === 'none').length,
    results: perDetailSummary,
  };
}

function summarizeCollectBoxItems(data) {
  const detailList = data && data.data && Array.isArray(data.data.detailList)
    ? data.data.detailList
    : [];

  return {
    result: data && data.result,
    code: data && data.code,
    count: detailList.length,
    items: detailList.map((item) => ({
      collectBoxDetailId: item.collectBoxDetailId,
      itemNum: item.itemNum,
      title: item.title,
      stock: item.stock,
      price: item.price,
      editModel: item.editModel,
      shopCount: Array.isArray(item.collectBoxDetailShopList)
        ? item.collectBoxDetailShopList.length
        : 0,
    })),
  };
}

// 简单命令行参数解析，支持 search / find-category / set-category 三种命令。
async function runDefaultEditWorkflow({
  count = 1,
  itemSelectionMode = 'range',
  itemStartIndex,
  itemEndIndex,
  publish = true,
  sourceSite = DEFAULT_WORKFLOW_SOURCE_SITE,
  groupSites = DEFAULT_WORKFLOW_GROUP_SITES,
  sourcePriceExtraCny = 0,
  skuWeightPaddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS,
  onProgress = null,
} = {}) {
  const selectionMode = normalizeItemSelectionMode(itemSelectionMode);
  const searchParams = buildDefaultEditSearchParams({
    itemSelectionMode: selectionMode,
    itemStartIndex,
    itemEndIndex,
    count,
  });
  const itemRange = selectionMode === 'range'
    ? normalizeItemRangeSelection({ startIndex: itemStartIndex, endIndex: itemEndIndex, count })
    : null;
  const resolvedCount = itemRange ? itemRange.count : 0;
  const parsedPublish = parseBooleanOrNull(publish);
  const publishEnabled = parsedPublish === null ? true : parsedPublish;
  const normalizedSourceSite = String(sourceSite || DEFAULT_WORKFLOW_SOURCE_SITE).toUpperCase();
  const normalizedGroupSites = uniqueIdList(groupSites).map((site) => String(site).toUpperCase());

  const result = await editAndPublishCollectBoxItems({
    site: normalizedSourceSite,
    groupSites: normalizedGroupSites,
    targetSites: [],
    apply: true,
    batchSize: Math.min(resolvedCount || 5, 5),
    requestIntervalMs: 1200,
    // 默认只发布到商品当前已选/已认领的店铺，避免把未认领店铺传给妙手发布接口。
    publishAllShops: false,
    publishScope: 'mapped',
    syncScope: 'group',
    enablePublish: publishEnabled,
    autoClaimMode: 'allGroups',
    forceClaimMode: '',
    sourcePriceExtraCny,
    skuWeightPaddingGrams,
    onProgress,
    searchParams,
  });

  return {
    mode: 'default-edit-workflow',
    params: {
      count: selectionMode === 'all' ? result.totalCount : resolvedCount,
      itemSelectionMode: selectionMode,
      itemStartIndex: itemRange ? itemRange.startIndex : null,
      itemEndIndex: itemRange ? itemRange.endIndex : null,
      publish: publishEnabled,
      sourceSite: normalizedSourceSite,
      groupSites: normalizedGroupSites,
      sourcePriceExtraCny: normalizeSourcePriceExtraCny(sourcePriceExtraCny),
      skuWeightPaddingGrams: normalizeSkuWeightPaddingGrams(skuWeightPaddingGrams),
    },
    ...result,
  };
}

// 命令入口：
//   node miaoshou_auto.js
//   node miaoshou_auto.js find-category --site PH
//   node miaoshou_auto.js set-category --site PH --apply
//   node miaoshou_auto.js optimize-titles --site PH
//   node miaoshou_auto.js edit-publish --site PH --page-size 1 --apply
//   node miaoshou_auto.js publish-items --site PH --detail-ids 123 --apply
function createCliProgressReporter() {
  if (String(process.env.MIAOSHOU_PROGRESS || '') !== '1') {
    return null;
  }

  return (event = {}) => {
    console.error(`MIAOSHOU_PROGRESS ${JSON.stringify(event)}`);
  };
}

function markCliFailureForResult(result = {}) {
  if (Number(result && result.errorCount) > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const onProgress = createCliProgressReporter();

  if (args.command === 'run-default' || args.command === 'run' || args.command === 'auto') {
    const result = await runDefaultEditWorkflow({
      count: args.count,
      itemSelectionMode: args.itemSelectionMode,
      itemStartIndex: args.itemStartIndex,
      itemEndIndex: args.itemEndIndex,
      publish: args.publish,
      sourceSite: args.site || DEFAULT_WORKFLOW_SOURCE_SITE,
      groupSites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_WORKFLOW_GROUP_SITES,
      sourcePriceExtraCny: args.sourcePriceExtraCny,
      skuWeightPaddingGrams: args.skuWeightPaddingGrams,
      onProgress,
    });
    console.log(JSON.stringify(result, null, 2));
    markCliFailureForResult(result);
    return;
  }

  if (args.command === 'claim-to-shop') {
    const result = await claimItemsToShops({
      detailIds: args.detailIds,
      shopIds: args.shopIds,
    });
    console.log(JSON.stringify({
      detailIds: args.detailIds,
      shopIds: args.shopIds,
      result,
    }, null, 2));
    return;
  }

  if (args.command === 'test-mimo-image') {
    const result = await testMimoImageUnderstanding({
      imageUrl: args.imageUrl,
      imagePath: args.imagePath,
      model: args.model,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'optimize-titles' || args.command === 'optimize-title') {
    const result = await optimizeQueriedItemTitles({
      site: args.site,
      categoryName: args.categoryName,
      apply: args.apply,
      batchSize: args.batchSize,
      requestIntervalMs: args.requestIntervalMs,
      model: args.model,
      maxTitleLength: args.maxTitleLength,
      groupSites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_TIKTOK_SHOP_SITES,
      sourcePriceExtraCny: args.sourcePriceExtraCny,
      skuWeightPaddingGrams: args.skuWeightPaddingGrams,
      searchParams: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        detailIds: args.detailIds,
        itemSelectionMode: args.itemSelectionMode,
        itemStartIndex: args.itemStartIndex,
        itemEndIndex: args.itemEndIndex,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    markCliFailureForResult(result);
    return;
  }

  if (args.command === 'set-category') {
    const result = await updateQueriedItemsToCategory({
      site: args.site,
      categoryName: args.categoryName,
      apply: args.apply,
      allowNonLeaf: args.allowNonLeaf,
      batchSize: args.batchSize,
      requestIntervalMs: args.requestIntervalMs,
      groupSites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_TIKTOK_SHOP_SITES,
      searchParams: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        detailIds: args.detailIds,
        itemSelectionMode: args.itemSelectionMode,
        itemStartIndex: args.itemStartIndex,
        itemEndIndex: args.itemEndIndex,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    markCliFailureForResult(result);
    return;
  }

  if (args.command === 'sync-shop-config') {
    const result = await syncShopConfigFromReference({
      site: args.site,
      referenceDetailId: args.referenceDetailId,
      apply: args.apply,
      requestIntervalMs: args.requestIntervalMs,
      searchParams: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        detailIds: args.detailIds,
        itemSelectionMode: args.itemSelectionMode,
        itemStartIndex: args.itemStartIndex,
        itemEndIndex: args.itemEndIndex,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'shop-groups' || args.command === 'list-shop-groups') {
    const shopGroupIndex = await buildShopGroupIndex({
      platform: args.platform,
      sites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_TIKTOK_SHOP_SITES,
    });
    console.log(JSON.stringify({
      platform: args.platform,
      sites: shopGroupIndex.sites,
      groupCount: shopGroupIndex.groups.length,
      crossSiteGroups: summarizeShopGroups(shopGroupIndex),
    }, null, 2));
    return;
  }

  if (args.command === 'sync-site-fields') {
    const result = await syncSiteFieldsAcrossSites({
      sourceSite: args.site,
      targetSites: args.targetSites,
      platform: args.platform,
      groupSites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_TIKTOK_SHOP_SITES,
      apply: args.apply,
      requestIntervalMs: args.requestIntervalMs,
      syncScope: args.syncScope,
      preferredSourceShopId: args.sourceShopId,
      searchParams: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        detailIds: args.detailIds,
        itemSelectionMode: args.itemSelectionMode,
        itemStartIndex: args.itemStartIndex,
        itemEndIndex: args.itemEndIndex,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'publish-items' || args.command === 'publish-collect') {
    const result = await publishCollectBoxItems({
      site: args.site || 'PH',
      groupSites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_TIKTOK_SHOP_SITES,
      apply: args.apply,
      shopIds: args.shopIds,
      requestIntervalMs: args.requestIntervalMs,
      publishScope: args.publishScopeSpecified
        ? (args.publishScope === 'group' ? 'groupAllShops' : 'mapped')
        : 'mapped',
      platform: args.platform,
      preferredSourceShopId: args.sourceShopId,
      searchParams: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        detailIds: args.detailIds,
        itemSelectionMode: args.itemSelectionMode,
        itemStartIndex: args.itemStartIndex,
        itemEndIndex: args.itemEndIndex,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'edit-publish' || args.command === 'edit-and-publish') {
    const result = await editAndPublishCollectBoxItems({
      site: args.site || 'PH',
      groupSites: args.groupSites.length > 0 ? args.groupSites : DEFAULT_TIKTOK_SHOP_SITES,
      targetSites: args.targetSites,
      categoryName: args.categoryName,
      apply: args.apply,
      batchSize: args.batchSize,
      requestIntervalMs: args.requestIntervalMs,
      model: args.model,
      maxTitleLength: args.maxTitleLength,
      shopIds: args.shopIds,
      publishAllShops: args.publishAllShops,
      platform: args.platform,
      publishScope: args.publishScopeSpecified ? args.publishScope : 'group',
      syncScope: args.syncScope,
      preferredSourceShopId: args.sourceShopId,
      enablePublish: args.publish,
      forceClaimMode: '',
      sourcePriceExtraCny: args.sourcePriceExtraCny,
      skuWeightPaddingGrams: args.skuWeightPaddingGrams,
      onProgress,
      searchParams: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        detailIds: args.detailIds,
        itemSelectionMode: args.itemSelectionMode,
        itemStartIndex: args.itemStartIndex,
        itemEndIndex: args.itemEndIndex,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    markCliFailureForResult(result);
    return;
  }

  if (args.command === 'find-category') {
    const category = await findCategoryByName({
      site: args.site,
      categoryName: args.categoryName,
    });
    console.log(JSON.stringify({
      cid: category.cid,
      name: category.name,
      breadcrumb: category.breadcrumb,
      isLastLevel: category.isLastLevel,
    }, null, 2));
    return;
  }

  const data = await searchCollectBoxItems({
    pageNo: args.pageNo,
    pageSize: args.pageSize,
  });
  console.log(JSON.stringify(summarizeCollectBoxItems(data), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  SEARCH_COLLECT_BOX_DETAIL_PATH,
  SAVE_MOVE_COLLECT_TASK_PATH,
  buildSignedHeaders,
  generateSign,
  requestMiaoshou,
  searchCollectBoxItems,
  getShopList,
  getShopWarehouseList,
  buildShopGroupKey,
  buildShopGroupIndex,
  summarizeShopGroups,
  extractFirstValidPriceFromText,
  getCategoryTreeBySite,
  findCategoryByName,
  collectCollectBoxItems,
  normalizeItemSelectionMode,
  normalizeItemRangeSelection,
  selectItemsByItemRange,
  buildDefaultEditSearchParams,
  claimItemsToShops,
  saveMoveCollectTask,
  resolvePublishShopIdsForDetail,
  getSiteCollectItemInfo,
  saveSiteCollectItemInfo,
  optimizeProductTitleWithKimi,
  translateSkuPropertyListToEnglish,
  analyzeBmpForDisclaimer,
  collectSkuImageUrlsFromPropertyList,
  buildSkuImageReplacementPool,
  applySkuImagePolicyToPropertyList,
  extractFreightPriceFromText,
  resolveGrossWeightFromText,
  applySourcePriceExtraCny,
  cleanSkuMap,
  addSkuWeightPaddingKg,
  shouldOverwriteSuspiciousOriginPrice,
  isSourcePriceTooHighForDirectUse,
  hasSuspiciousHighSourcePrice,
  buildResolvedSourcePriceFromLookup,
  isGrossWeightTooHighForDirectUse,
  chooseGrossWeightKg,
  resolveAccurateSourcePriceForItem,
  optimizeQueriedItemTitles,
  syncSiteFieldsAcrossSites,
  syncShopConfigFromReference,
  updateQueriedItemsToCategory,
  publishCollectBoxItems,
  editAndPublishCollectBoxItems,
  summarizeCollectBoxItems,
};
