const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFile } = require('child_process');
const { randomUUID } = require('crypto');

const {
  loadDotEnv,
  readEnvFile,
  updateEnvFile,
  readMiaoshouAccounts,
  serializeMiaoshouAccount,
  getDefaultMiaoshouAccount,
  getProjectConfig,
  normalizeProjectConfig,
  buildChildProcessEnv,
  maskIdentifier,
  maskPhoneText,
} = require('./lib/project_config');
const {
  loadRunHistory,
  saveRunHistory,
  clearRunHistoryStore,
} = require('./lib/run_history_store');
const {
  saveRunDiagnostic,
  loadRunDiagnostic,
} = require('./lib/run_diagnostics');
const {
  buildResumeRunInput,
} = require('./lib/run_resume');
const {
  buildFailedItemRetryInput,
} = require('./lib/run_failed_retry');
const {
  buildRunPrecheck,
} = require('./lib/run_precheck');
const {
  failureTypeLabel,
} = require('./lib/run_failure_classification');
const {
  createQueuedRun,
  serializeQueue,
  dequeueNext,
  removeQueuedRun,
  moveQueuedRun,
  loadRunQueueState,
  saveRunQueue,
  clearRunQueueStore,
} = require('./lib/run_queue');
const {
  buildRunStats,
} = require('./lib/run_stats');
const {
  artifactFilePath,
} = require('./lib/automation_artifacts');

loadDotEnv();

const HOST = process.env.WEB_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.WEB_PORT || '3000', 10);
const SCRIPT_PATH = path.join(__dirname, 'miaoshou_auto.js');
const FLASH_SCRIPT_PATH = path.join(__dirname, 'miaoshou_flash_sale.js');
const COLLECT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_1688_collect.js');
const PRODUCT_MANAGEMENT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_product_management.js');
const CAPTCHA_DIR = path.join(__dirname, '.captcha');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_LOG_LINES = 2000;
const MAX_HISTORY_ITEMS = 20;
const STOP_FORCE_KILL_DELAY_MS = 5000;
const PROCESSING_MODE_FAST = 'fast';
const PROCESSING_MODE_PRECISE = 'precise';
const ITEM_SELECTION_MODE_RANGE = 'range';
const ITEM_SELECTION_MODE_ALL = 'all';
const FLASH_SELECTION_MODE_COUNT = 'count';
const FLASH_SELECTION_MODE_ALL = 'all';
const FLASH_SELECTION_MODE_IDS = 'ids';
const COLLECT_TASK_DEFAULT_KEYWORDS = '';
const COLLECT_TASK_DEFAULT_PREFERRED_TERMS = '';
const COLLECT_TASK_DEFAULT_EXCLUDED_TERMS = '';
const COLLECT_SOURCE_1688 = '1688';
const COLLECT_SOURCE_SHOPEE = 'shopee';
const COLLECT_SOURCE_AMAZON = 'amazon';
const COLLECT_SOURCE_LINKS = 'links';
const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';
const SHOPEE_SITE_CODES = new Set(['my', 'ph', 'th']);
const MAX_EDIT_ITEM_INDEX = 500;
const MAX_SOURCE_PRICE_EXTRA_CNY = 1000;
const MAX_COLLECT_COUNT = 100;
const MAX_COLLECT_PRICE_CNY = 10000;
const MAX_PRODUCT_MANAGEMENT_SCAN_PAGES = 50;
const DEFAULT_PRODUCT_MANAGEMENT_RETAIN_COUNT = 900;
const MAX_PRODUCT_MANAGEMENT_RETAIN_COUNT = 100000;
const DEFAULT_WEIGHT_PADDING_GRAMS = (() => {
  const parsed = Number.parseFloat(process.env.SKU_WEIGHT_PADDING_GRAMS || '30');
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(1)) : 30;
})();
const MAX_WEIGHT_PADDING_GRAMS = 5000;
const DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT = 90;
const STATIC_ASSET_MAP = new Map([
  ['/assets/app.js', path.join(PUBLIC_DIR, 'app.js')],
  ['/assets/styles.css', path.join(PUBLIC_DIR, 'styles.css')],
  ['/assets/tiktok-shop-logo.png', path.join(PUBLIC_DIR, 'assets', 'tiktok-shop-logo.png')],
  ['/assets/tiktok-seller-favicon.ico', path.join(PUBLIC_DIR, 'assets', 'tiktok-seller-favicon.ico')],
  ['/vendor/vue.global.prod.js', path.join(__dirname, 'node_modules/vue/dist/vue.global.prod.js')],
  ['/vendor/dayjs/dayjs.min.js', path.join(__dirname, 'node_modules/dayjs/dayjs.min.js')],
  ['/vendor/dayjs/plugin/advancedFormat.js', path.join(__dirname, 'node_modules/dayjs/plugin/advancedFormat.js')],
  ['/vendor/dayjs/plugin/customParseFormat.js', path.join(__dirname, 'node_modules/dayjs/plugin/customParseFormat.js')],
  ['/vendor/dayjs/plugin/localeData.js', path.join(__dirname, 'node_modules/dayjs/plugin/localeData.js')],
  ['/vendor/dayjs/plugin/quarterOfYear.js', path.join(__dirname, 'node_modules/dayjs/plugin/quarterOfYear.js')],
  ['/vendor/dayjs/plugin/weekOfYear.js', path.join(__dirname, 'node_modules/dayjs/plugin/weekOfYear.js')],
  ['/vendor/dayjs/plugin/weekYear.js', path.join(__dirname, 'node_modules/dayjs/plugin/weekYear.js')],
  ['/vendor/dayjs/plugin/weekday.js', path.join(__dirname, 'node_modules/dayjs/plugin/weekday.js')],
  ['/vendor/ant-design-vue/antd.min.js', path.join(__dirname, 'node_modules/ant-design-vue/dist/antd.min.js')],
  ['/vendor/ant-design-vue/reset.css', path.join(__dirname, 'node_modules/ant-design-vue/dist/reset.css')],
]);

function recognizeCaptchaImage(imagePath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'tools', 'local_ocr_demo.py');

    execFile(
      'python3',
      [scriptPath, imagePath, '--json', '--allow-short'],
      { cwd: __dirname },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          const code = String(result.code || '').trim();
          const expectedLength = Number.isFinite(Number(result.expected_length))
            ? Number(result.expected_length)
            : 4;
          resolve({
            code,
            raw: String(result.raw || '').trim(),
            expectedLength,
            lengthOk: Boolean(result.length_ok),
            hint: code && !result.length_ok
              ? `识别结果是 ${code.length} 位，验证码通常是 ${expectedLength} 位，请人工确认。`
              : '',
          });
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

function getBrowserOpenUrl(host, port) {
  if (host === '0.0.0.0' || host === '::') {
    return `http://127.0.0.1:${port}`;
  }

  return `http://${host}:${port}`;
}

function runOpenCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function openBrowserForServer(url) {
  if (process.env.WEB_OPEN_BROWSER === '0') {
    return;
  }

  if (process.platform === 'darwin') {
    if (runOpenCommand('open', ['-a', 'Google Chrome', url])) {
      return;
    }
    runOpenCommand('open', [url]);
    return;
  }

  if (process.platform === 'win32') {
    runOpenCommand('cmd', ['/c', 'start', '', url]);
    return;
  }

  runOpenCommand('xdg-open', [url]);
}

let currentRun = null;
const history = loadRunHistory({ limit: MAX_HISTORY_ITEMS });
const queueState = loadRunQueueState();
const taskQueue = queueState.queue;
let taskQueuePaused = true;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function buildServerCapabilities() {
  return {
    collectSources: [COLLECT_SOURCE_1688, COLLECT_SOURCE_AMAZON],
    amazonCollection: true,
  };
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function sendBinary(response, statusCode, buffer, contentType) {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(buffer);
}

function contentTypeForAsset(filePath = '') {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.js') {
    return 'text/javascript; charset=utf-8';
  }
  if (extension === '.css') {
    return 'text/css; charset=utf-8';
  }
  if (extension === '.html') {
    return 'text/html; charset=utf-8';
  }
  if (extension === '.json') {
    return 'application/json; charset=utf-8';
  }
  if (extension === '.svg') {
    return 'image/svg+xml; charset=utf-8';
  }
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.ico') {
    return 'image/x-icon';
  }
  return 'application/octet-stream';
}

function sendStaticAsset(response, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    sendJson(response, 404, { error: '静态资源不存在。' });
    return;
  }
  sendBinary(response, 200, fs.readFileSync(filePath), contentTypeForAsset(filePath));
}

function ensureCaptchaDir() {
  fs.mkdirSync(CAPTCHA_DIR, { recursive: true });
}

function safeCaptchaName(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 160);
}

function captchaResponsePath(captchaId = '') {
  return path.join(CAPTCHA_DIR, `captcha-response-${safeCaptchaName(captchaId)}.json`);
}

function captchaImagePath(imageFile = '') {
  const safeName = safeCaptchaName(imageFile);
  return safeName && safeName.endsWith('.png') ? path.join(CAPTCHA_DIR, safeName) : '';
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('Request body is too large.'));
      }
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    request.on('error', reject);
  });
}

function normalizeIdList(value = []) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,，、]+/);
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeFlashActivityRecords(value = []) {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set();
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const activityId = String(item.activityId || item.detailId || item.id || '').trim();
      const activityTitle = String(item.activityTitle || item.title || item.name || '').trim();
      if (!activityId && !activityTitle) {
        return null;
      }
      return { activityId, activityTitle };
    })
    .filter((item) => {
      if (!item) {
        return false;
      }
      const key = item.activityId || item.activityTitle;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function resolveRunAccount(accountId = '') {
  const accounts = readMiaoshouAccounts();
  const normalizedAccountId = String(accountId || '').trim();
  if (normalizedAccountId) {
    const matched = accounts.find((account) => account && account.id === normalizedAccountId);
    if (!matched) {
      throw new Error('队列任务绑定的账号不存在或已被删除。');
    }
    return matched;
  }
  return getDefaultMiaoshouAccount(accounts);
}

function normalizeRunOptions(input = {}) {
  const rawTasks = input.tasks && typeof input.tasks === 'object' ? input.tasks : {};
  const collectRequested = Boolean(rawTasks.collect);
  const productManagementRequested = Boolean(rawTasks.productManagement);
  const tasks = {
    collect: Boolean(rawTasks.collect),
    edit: collectRequested || productManagementRequested ? Boolean(rawTasks.edit) : rawTasks.edit !== false,
    flash: Boolean(rawTasks.flash),
    productManagement: Boolean(rawTasks.productManagement),
  };

  if (!tasks.collect && !tasks.edit && !tasks.flash && !tasks.productManagement) {
    throw new Error('请至少选择一个要执行的任务。');
  }
  if (tasks.productManagement && (tasks.collect || tasks.edit || tasks.flash)) {
    throw new Error('商品管理下架任务需要单独执行。');
  }
  if (tasks.collect && (tasks.edit || tasks.flash)) {
    throw new Error('商品采集任务需要单独执行。');
  }

  const account = resolveRunAccount(input.accountId);
  if (!account) {
    throw new Error('没有找到可用的妙手账号配置。');
  }
  if (!account.appId || !account.appSecret) {
    throw new Error(`账号 ${maskPhoneText(account.label)} 缺少 App ID 或 App Secret。`);
  }

  if (tasks.productManagement) {
    return {
      ...normalizeProductManagementOptions(input),
      tasks,
      account,
    };
  }

  if (tasks.collect) {
    return {
      ...normalizeCollectOptions(input),
      tasks,
      account,
    };
  }

  const detailIds = tasks.edit ? normalizeIdList(input.detailIds) : [];
  const itemRange = tasks.edit
    ? (detailIds.length > 0
      ? {
        itemSelectionMode: ITEM_SELECTION_MODE_RANGE,
        itemStartIndex: 1,
        itemEndIndex: detailIds.length,
        count: detailIds.length,
      }
      : normalizeEditItemSelection(input))
    : {
      itemSelectionMode: ITEM_SELECTION_MODE_RANGE,
      itemStartIndex: 0,
      itemEndIndex: 0,
      count: 0,
    };

  const publish = tasks.edit ? Boolean(input.publish) : false;
  if (publish && input.confirmPublish !== true) {
    throw new Error('发布模式需要确认。');
  }
  const processingMode = tasks.edit ? normalizeProcessingMode(input.processingMode) : PROCESSING_MODE_FAST;
  const sourcePriceExtraCny = tasks.edit ? normalizeSourcePriceExtraCny(input.sourcePriceExtraCny) : 0;
  const weightPaddingGrams = tasks.edit ? normalizeWeightPaddingGrams(input.weightPaddingGrams) : DEFAULT_WEIGHT_PADDING_GRAMS;
  const buyOneTakeOne = tasks.edit ? normalizeBooleanOption(input.buyOneTakeOne, false) : false;
  const buyOneTakeOnePriceMarkupPercent = tasks.edit
    ? normalizeBuyOneTakeOnePriceMarkupPercent(input.buyOneTakeOnePriceMarkupPercent)
    : DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT;

  const flashActivityIds = tasks.flash ? normalizeIdList(input.flashActivityIds || input.activityIds) : [];
  const skipFlashActivityIds = tasks.flash ? normalizeIdList(input.skipFlashActivityIds || input.skipActivityIds || input.processedFlashActivityIds) : [];
  const processedFlashActivities = tasks.flash ? normalizeFlashActivityRecords(input.processedFlashActivities) : [];
  const flashSelectionMode = tasks.flash && flashActivityIds.length > 0
    ? FLASH_SELECTION_MODE_IDS
    : (tasks.flash ? normalizeFlashSelectionMode(input.flashSelectionMode) : FLASH_SELECTION_MODE_COUNT);
  const flashCount = tasks.flash && flashSelectionMode === FLASH_SELECTION_MODE_COUNT
    ? Number.parseInt(input.flashCount, 10)
    : (flashSelectionMode === FLASH_SELECTION_MODE_IDS ? flashActivityIds.length : 0);
  if (tasks.flash && flashSelectionMode === FLASH_SELECTION_MODE_COUNT && (!Number.isFinite(flashCount) || flashCount < 1 || flashCount > 100)) {
    throw new Error('秒杀活动数量必须是 1 到 100 之间的整数。');
  }
  if (tasks.flash && flashSelectionMode === FLASH_SELECTION_MODE_IDS && flashActivityIds.length === 0) {
    throw new Error('指定秒杀活动 ID 不能为空。');
  }

  return {
    count: itemRange.count,
    detailIds,
    itemSelectionMode: itemRange.itemSelectionMode,
    itemStartIndex: itemRange.itemStartIndex,
    itemEndIndex: itemRange.itemEndIndex,
    publish,
    processingMode,
    sourcePriceExtraCny,
    weightPaddingGrams,
    buyOneTakeOne,
    buyOneTakeOnePriceMarkupPercent,
    flashSelectionMode,
    flashCount,
    flashActivityIds,
    skipFlashActivityIds,
    processedFlashActivities,
    retrySourceRunId: input.retrySourceRunId || '',
    tasks,
    account,
  };
}

function normalizeCollectText(value, fallback, fieldLabel, maxLength = 1000) {
  const text = String(value || '').trim() || fallback;
  if (!text) {
    throw new Error(`${fieldLabel}不能为空。`);
  }
  if (text.length > maxLength) {
    throw new Error(`${fieldLabel}不能超过 ${maxLength} 个字符。`);
  }
  return text;
}

function normalizeOptionalCollectText(value, fieldLabel, maxLength = 5000) {
  const text = String(value || '').trim();
  if (text.length > maxLength) {
    throw new Error(`${fieldLabel}不能超过 ${maxLength} 个字符。`);
  }
  return text;
}

function normalizeCollectInteger(value, fallback, min, max, fieldLabel) {
  const raw = value === '' || value === null || value === undefined ? fallback : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldLabel}必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return parsed;
}

function normalizeCollectNumber(value, fallback, min, max, fieldLabel) {
  const raw = value === '' || value === null || value === undefined ? fallback : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldLabel}必须是 ${min} 到 ${max} 之间的数字。`);
  }
  return Number(parsed.toFixed(2));
}

function normalizeCollectBoolean(value, fallback = true) {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function normalizeCollectSource(value = COLLECT_SOURCE_1688) {
  const normalized = String(value || COLLECT_SOURCE_1688).trim().toLowerCase();
  if (normalized === COLLECT_SOURCE_LINKS || normalized === 'link') {
    return COLLECT_SOURCE_LINKS;
  }
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

function normalizeShopeeSite(value = 'my') {
  const normalized = String(value || 'my').trim().toLowerCase();
  return SHOPEE_SITE_CODES.has(normalized) ? normalized : 'my';
}

function normalizeCollectOptions(input = {}) {
  const collectCount = normalizeCollectInteger(input.collectCount || input.count, 1, 1, MAX_COLLECT_COUNT, '采集数量');
  const normalizedCollectSource = normalizeCollectSource(input.collectSource || input.source);
  const collectLinks = normalizeOptionalCollectText(input.collectLinks || input.links, '商品链接');
  const collectSource = collectLinks ? COLLECT_SOURCE_LINKS : normalizedCollectSource;
  return {
    count: collectCount,
    collectCount,
    collectDedupeWindowDays: normalizeCollectInteger(input.collectDedupeWindowDays || input.dedupeWindowDays || input.dedupeDays, 7, 1, 365, '最近采集去重天数'),
    collectSource,
    collectAmazonMode: normalizeAmazonMode(input.collectAmazonMode || input.amazonMode, Boolean(collectLinks)),
    collectAmazonMarketplace: 'us',
    collectAmazonMaxPriceUsd: normalizeCollectNumber(input.collectAmazonMaxPriceUsd || input.amazonMaxPriceUsd, 10000, 0, 100000, 'Amazon 最高展示价'),
    collectAmazonMinRating: normalizeCollectNumber(input.collectAmazonMinRating || input.amazonMinRating, 0, 0, 5, 'Amazon 最低评分'),
    collectAmazonMinReviewCount: normalizeCollectInteger(input.collectAmazonMinReviewCount || input.amazonMinReviewCount, 0, 0, 10000000, 'Amazon 最低评论数'),
    collectShopeeSite: normalizeShopeeSite(input.collectShopeeSite || input.shopeeSite),
    collectShopeeMaxPrice: normalizeCollectNumber(input.collectShopeeMaxPrice || input.shopeeMaxPrice, 10000, 0.01, 100000, 'Shopee 最高展示价'),
    collectShopeeMaxMoq: normalizeCollectInteger(input.collectShopeeMaxMoq || input.shopeeMaxMoq, 3, 1, 1000, '1688 最大起批量'),
    collectKeywords: normalizeOptionalCollectText(input.collectKeywords || input.keywords || COLLECT_TASK_DEFAULT_KEYWORDS, '关键词'),
    collectMaxPriceCny: normalizeCollectNumber(input.collectMaxPriceCny || input.maxPriceCny, 10, 0.01, MAX_COLLECT_PRICE_CNY, '最高采购价'),
    collectPreferredTerms: normalizeOptionalCollectText(input.collectPreferredTerms || input.preferredTerms || COLLECT_TASK_DEFAULT_PREFERRED_TERMS, '优先采集词'),
    collectExcludedTerms: normalizeOptionalCollectText(input.collectExcludedTerms || input.excludedTerms || COLLECT_TASK_DEFAULT_EXCLUDED_TERMS, '排除词'),
    collectMinScore: normalizeCollectInteger(input.collectMinScore || input.minScore, 50, 0, 100, '最低评分'),
    collectSafeMode: normalizeCollectBoolean(input.collectSafeMode ?? input.safeMode, false),
    collectSkipFilters: normalizeCollectBoolean(input.collectSkipFilters ?? input.skipFilters, false),
    collectLinks,
  };
}

function normalizeProductManagementAction(value = PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES) {
  const normalized = String(value || PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES).trim();
  if (normalized !== PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES) {
    throw new Error('不支持的商品管理任务。');
  }
  return normalized;
}

function normalizeProductManagementOptions(input = {}) {
  return {
    productManagementAction: normalizeProductManagementAction(input.productManagementAction || input.action),
    productManagementMaxPages: normalizeCollectInteger(input.productManagementMaxPages ?? input.maxPages, 5, 1, MAX_PRODUCT_MANAGEMENT_SCAN_PAGES, '发布记录扫描页数'),
    productManagementRetainCount: normalizeCollectInteger(input.productManagementRetainCount ?? input.retainCount, DEFAULT_PRODUCT_MANAGEMENT_RETAIN_COUNT, 0, MAX_PRODUCT_MANAGEMENT_RETAIN_COUNT, '商品保留数量'),
    productManagementDryRun: normalizeCollectBoolean(input.productManagementDryRun ?? input.dryRun, false),
    productManagementStores: normalizeIdList(input.productManagementStores || input.stores),
  };
}

function normalizeEditItemSelection(input = {}) {
  const itemSelectionMode = normalizeItemSelectionMode(input.itemSelectionMode);
  if (itemSelectionMode === ITEM_SELECTION_MODE_ALL) {
    return {
      itemSelectionMode,
      itemStartIndex: 0,
      itemEndIndex: 0,
      count: 0,
    };
  }

  return normalizeEditItemRange(input);
}

function normalizeItemSelectionMode(value = ITEM_SELECTION_MODE_RANGE) {
  return String(value || '').trim().toLowerCase() === ITEM_SELECTION_MODE_ALL
    ? ITEM_SELECTION_MODE_ALL
    : ITEM_SELECTION_MODE_RANGE;
}

function normalizeEditItemRange(input = {}) {
  const hasRangeInput = [input.itemStartIndex, input.itemEndIndex]
    .some((value) => value !== '' && value !== null && value !== undefined);

  if (!hasRangeInput) {
    const count = Number.parseInt(input.count, 10);
    if (!Number.isFinite(count) || count < 1 || count > MAX_EDIT_ITEM_INDEX) {
      throw new Error(`数量必须是 1 到 ${MAX_EDIT_ITEM_INDEX} 之间的整数。`);
    }
    return {
      itemSelectionMode: ITEM_SELECTION_MODE_RANGE,
      itemStartIndex: 1,
      itemEndIndex: count,
      count,
    };
  }

  const itemStartIndex = normalizeEditItemIndex(input.itemStartIndex, 1, '开始序号');
  const itemEndIndex = normalizeEditItemIndex(input.itemEndIndex, itemStartIndex, '结束序号');

  if (itemEndIndex < itemStartIndex) {
    throw new Error('结束序号不能小于开始序号。');
  }

  return {
    itemSelectionMode: ITEM_SELECTION_MODE_RANGE,
    itemStartIndex,
    itemEndIndex,
    count: itemEndIndex - itemStartIndex + 1,
  };
}

function normalizeEditItemIndex(value, fallback, fieldLabel) {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_EDIT_ITEM_INDEX) {
    throw new Error(`${fieldLabel}必须是 1 到 ${MAX_EDIT_ITEM_INDEX} 之间的整数。`);
  }

  return parsed;
}

function normalizeSourcePriceExtraCny(value = 0) {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_SOURCE_PRICE_EXTRA_CNY) {
    throw new Error(`来源价格加价必须是 0 到 ${MAX_SOURCE_PRICE_EXTRA_CNY} 之间的数字。`);
  }

  return Number(parsed.toFixed(2));
}

function normalizeWeightPaddingGrams(value = DEFAULT_WEIGHT_PADDING_GRAMS) {
  if (value === '' || value === null || value === undefined) {
    return DEFAULT_WEIGHT_PADDING_GRAMS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_WEIGHT_PADDING_GRAMS) {
    throw new Error(`重量额外加重必须是 0 到 ${MAX_WEIGHT_PADDING_GRAMS} 克之间的数字。`);
  }

  return Number(parsed.toFixed(1));
}

function normalizeBuyOneTakeOnePriceMarkupPercent(value = DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT) {
  if (value === '' || value === null || value === undefined) {
    return DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('买一送一加价比例必须是 0 到 100 之间的数字。');
  }

  return Number(parsed.toFixed(1));
}

function normalizeBooleanOption(value, fallback = false) {
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
    return fallback;
  }
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeProcessingMode(value = PROCESSING_MODE_FAST) {
  return String(value || '').trim() === PROCESSING_MODE_PRECISE
    ? PROCESSING_MODE_PRECISE
    : PROCESSING_MODE_FAST;
}

function normalizeFlashSelectionMode(value = FLASH_SELECTION_MODE_COUNT) {
  const normalized = String(value || '').trim();
  if (normalized === FLASH_SELECTION_MODE_IDS) {
    return FLASH_SELECTION_MODE_IDS;
  }
  return normalized === FLASH_SELECTION_MODE_ALL
    ? FLASH_SELECTION_MODE_ALL
    : FLASH_SELECTION_MODE_COUNT;
}

function processingModeLabel(mode = PROCESSING_MODE_FAST) {
  return normalizeProcessingMode(mode) === PROCESSING_MODE_PRECISE ? '精细模式' : '快速模式';
}

function processingModeEnv(mode = PROCESSING_MODE_FAST) {
  return {
    ENABLE_MIMO_IMAGE_RELEVANCE_CHECK:
      normalizeProcessingMode(mode) === PROCESSING_MODE_PRECISE ? '1' : '0',
  };
}

function formatItemRangeText(startIndex, endIndex) {
  const start = Number(startIndex || 1);
  const end = Number(endIndex || start);
  return start === end ? `第 ${start} 个` : `第 ${start}-${end} 个`;
}

function formatItemSelectionText(selection = {}) {
  if (Array.isArray(selection.detailIds) && selection.detailIds.length > 0) {
    return `指定商品 ID ${selection.detailIds.length} 个`;
  }
  if (normalizeItemSelectionMode(selection.itemSelectionMode) === ITEM_SELECTION_MODE_ALL) {
    return `全部商品（最多扫描 ${MAX_EDIT_ITEM_INDEX} 个）`;
  }

  const countText = Number(selection.count || 0) > 0 ? `，共 ${selection.count} 个` : '';
  return `${formatItemRangeText(selection.itemStartIndex, selection.itemEndIndex)}${countText}`;
}

function formatFlashSelectionText(selection = {}) {
  if (Array.isArray(selection.flashActivityIds) && selection.flashActivityIds.length > 0) {
    return `指定活动 ID ${selection.flashActivityIds.length} 个`;
  }
  if (normalizeFlashSelectionMode(selection.flashSelectionMode) === FLASH_SELECTION_MODE_ALL) {
    return '全部进行中活动';
  }
  return `${selection.flashCount || 0} 个`;
}

function taskLabelForOptions(options = {}) {
  const tasks = options.tasks || {};
  if (tasks.productManagement) {
    return '商品管理：上限店铺商品下架';
  }
  if (tasks.collect) {
    return `商品采集：${options.collectSource === COLLECT_SOURCE_LINKS ? '链接采集' : (options.collectSource || '1688')}，${options.collectCount || options.count || 0} 个`;
  }
  if (tasks.edit && tasks.flash) {
    return `编辑商品并继续秒杀：${formatItemSelectionText(options)}，秒杀 ${formatFlashSelectionText(options)}`;
  }
  if (tasks.edit) {
    return `编辑商品：${formatItemSelectionText(options)}`;
  }
  if (tasks.flash) {
    return `秒杀管理：${formatFlashSelectionText(options)}`;
  }
  return '待执行任务';
}

function persistTaskQueue() {
  saveRunQueue(taskQueue, { paused: taskQueuePaused });
}

function buildQueuedRunInput(options = {}) {
  const { account, ...rest } = options;
  const accountId = String((account && account.id) || rest.accountId || '').trim();
  return accountId ? { ...rest, accountId } : rest;
}

function enqueueRunInput(input = {}, label = '') {
  const options = normalizeRunOptions(input);
  const item = createQueuedRun({
    input: buildQueuedRunInput(options),
    accountSnapshot: serializeMiaoshouAccount(options.account),
    label: label || taskLabelForOptions(options),
  });
  taskQueue.push(item);
  persistTaskQueue();
  return item;
}

function startQueuedRun(item) {
  if (!item || !item.input) {
    return null;
  }
  const options = normalizeRunOptions(item.input);
  const run = startRun(options);
  run.queueLabel = item.label || '待执行任务';
  run.queueAccount = item.accountSnapshot || null;
  appendLog(run, 'system', `从任务队列开始：${item.label || '待执行任务'}。`);
  return run;
}

function rememberQueuedRunStartFailure(item, error) {
  const now = new Date().toISOString();
  const input = item && item.input && typeof item.input === 'object' ? item.input : {};
  const message = error && error.message ? error.message : String(error || '队列任务启动失败。');
  const run = {
    id: randomUUID(),
    count: input.count || input.collectCount || input.flashCount || 0,
    detailIds: input.detailIds || [],
    itemSelectionMode: input.itemSelectionMode || ITEM_SELECTION_MODE_RANGE,
    itemStartIndex: input.itemStartIndex || 0,
    itemEndIndex: input.itemEndIndex || 0,
    publish: Boolean(input.publish),
    sourcePriceExtraCny: input.sourcePriceExtraCny || 0,
    weightPaddingGrams: input.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    buyOneTakeOne: Boolean(input.buyOneTakeOne),
    buyOneTakeOnePriceMarkupPercent: input.buyOneTakeOnePriceMarkupPercent ?? DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT,
    processingMode: input.processingMode || PROCESSING_MODE_FAST,
    flashCount: input.flashCount || 0,
    flashSelectionMode: input.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    flashActivityIds: input.flashActivityIds || [],
    skipFlashActivityIds: input.skipFlashActivityIds || [],
    processedFlashActivities: input.processedFlashActivities || [],
    collectCount: input.collectCount || 0,
    collectDedupeWindowDays: input.collectDedupeWindowDays || 7,
    collectSource: input.collectSource || '',
    collectKeywords: input.collectKeywords || '',
    collectLinks: input.collectLinks || '',
    productManagementAction: input.productManagementAction || '',
    productManagementMaxPages: input.productManagementMaxPages || 0,
    productManagementRetainCount: input.productManagementRetainCount ?? DEFAULT_PRODUCT_MANAGEMENT_RETAIN_COUNT,
    productManagementDryRun: Boolean(input.productManagementDryRun),
    productManagementStores: input.productManagementStores || [],
    tasks: input.tasks || {},
    account: item ? item.accountSnapshot : null,
    command: `任务队列：${item && item.label ? item.label : '待执行任务'}`,
    status: 'error',
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    exitCode: null,
    signal: null,
    error: message,
    summary: null,
    progress: {
      phase: 'queue',
      phaseLabel: '队列启动失败',
      completed: 0,
      total: input.count || input.collectCount || input.flashCount || 0,
      totalCount: input.count || input.collectCount || input.flashCount || 0,
      detailId: '',
      detailName: '',
      overallPercent: 0,
      updatedAt: now,
    },
    stdout: '',
    stderr: message,
    stderrLineBuffer: '',
    logs: [],
    captcha: null,
    child: null,
  };
  appendLog(run, 'stderr', `队列任务启动失败：${message}`);
  rememberRun(run);
  return run;
}

function runNextQueuedRunNow() {
  if (taskQueuePaused || isRunActive(currentRun) || taskQueue.length === 0) {
    return null;
  }
  const next = dequeueNext(taskQueue);
  taskQueue.splice(0, taskQueue.length, ...next.queue);
  persistTaskQueue();
  try {
    return startQueuedRun(next.item);
  } catch (error) {
    return rememberQueuedRunStartFailure(next.item, error);
  }
}

function scheduleNextQueuedRun() {
  if (taskQueue.length === 0) {
    if (!taskQueuePaused && !isRunActive(currentRun)) {
      taskQueuePaused = true;
      persistTaskQueue();
    }
    return;
  }
  if (taskQueuePaused || isRunActive(currentRun)) {
    return;
  }
  setTimeout(() => {
    runNextQueuedRunNow();
  }, 0);
}

function appendLog(run, stream, text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line) {
      continue;
    }
    appendLogEntry(run, stream, line);
  }
}

function appendLogEntry(run, stream, text) {
  run.logs.push({
    time: new Date().toISOString(),
    stream,
    text: maskPhoneText(text),
  });

  if (run.logs.length > MAX_LOG_LINES) {
    run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
  }
}

function formatRunStatusLog(run) {
  const progress = run && run.progress ? run.progress : {};
  const phaseLabel = progress.phaseLabel || getPhaseLabel(progress.phase || 'prepare');
  const percent = Number.isFinite(Number(progress.overallPercent))
    ? Math.max(0, Math.min(100, Math.round(Number(progress.overallPercent))))
    : 0;
  const total = Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0;
  const completed = Number.isFinite(Number(progress.completed)) ? Number(progress.completed) : 0;
  const countText = total > 0 ? `，已完成 ${completed}/${total}` : '';
  const detailValue = progress.detailName || progress.detailId;
  const detailText = detailValue ? `，当前对象 ${detailValue}` : '';

  return `当前正在：${phaseLabel}，进度 ${percent}%${countText}${detailText}。`;
}

function progressLogKey(progress = {}) {
  const percent = Number.isFinite(Number(progress.overallPercent))
    ? Math.max(0, Math.min(100, Math.round(Number(progress.overallPercent))))
    : 0;
  return [
    progress.phase || 'prepare',
    percent,
    Number.isFinite(Number(progress.completed)) ? Number(progress.completed) : 0,
    Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0,
    progress.detailId || '',
    progress.detailName || '',
  ].join('|');
}

function appendProcessedFlashActivity(run, event = {}) {
  if (!run || !event.processedActivity) {
    return;
  }
  const activityId = String(event.activityId || event.detailId || '').trim();
  const activityTitle = String(event.activityTitle || event.detailName || '').trim();
  if (!activityId && !activityTitle) {
    return;
  }
  const list = Array.isArray(run.processedFlashActivities) ? run.processedFlashActivities : [];
  const key = activityId || activityTitle;
  if (!list.some((item) => item && (item.activityId || item.activityTitle) === key)) {
    list.push({ activityId, activityTitle });
  }
  run.processedFlashActivities = list;
}

function appendProgressLogIfChanged(run) {
  if (!run || !run.progress) {
    return;
  }
  const key = progressLogKey(run.progress);
  if (run.lastProgressLogKey === key) {
    return;
  }
  run.lastProgressLogKey = key;
  appendLogEntry(run, 'system', formatRunStatusLog(run));
}

function getPhaseLabel(phase = '') {
  const labels = {
    login: '等待登录',
    captcha: '等待验证码',
    collect: '商品采集',
    productManagement: '商品管理',
    flash: '秒杀活动',
    optimize: '编辑优化',
    sync: '同步站点',
    publish: '发布商品',
    complete: '完成',
    stopped: '已停止',
    error: '执行失败',
  };
  return labels[phase] || '准备中';
}

async function updateRunProgress(run, event = {}) {
  const overallPercent = Number.isFinite(Number(event.overallPercent))
    ? Math.max(0, Math.min(100, Number(event.overallPercent)))
    : run.progress.overallPercent;
  const phase = event.phase || run.progress.phase || 'prepare';
  const completed = Number.isFinite(Number(event.completed)) ? Number(event.completed) : run.progress.completed;
  const total = Number.isFinite(Number(event.total)) ? Number(event.total) : run.progress.total;

  run.progress = {
    ...run.progress,
    phase,
    phaseLabel: event.phaseLabel || getPhaseLabel(phase),
    completed,
    total,
    totalCount: Number.isFinite(Number(event.totalCount)) ? Number(event.totalCount) : run.progress.totalCount,
    detailId: event.detailId ? String(event.detailId) : run.progress.detailId,
    detailName: event.detailName ? String(event.detailName) : run.progress.detailName,
    matchedStores: Array.isArray(event.matchedStores) ? event.matchedStores : run.progress.matchedStores,
    overallPercent,
    updatedAt: new Date().toISOString(),
  };

  appendProcessedFlashActivity(run, event);

  if (event.captcha && event.captcha.id) {
    const imageFile = safeCaptchaName(event.captcha.imageFile || '');
    const localImagePath = captchaImagePath(imageFile);
    let recognizedCode = '';
    let recognizedRaw = '';
    let recognizedHint = '';
    let recognizedError = '';
    console.log('验证码本地图片路径:', localImagePath);

    try {
      const recognized = await recognizeCaptchaImage(localImagePath);
      recognizedCode = recognized.code || '';
      recognizedRaw = recognized.raw || '';
      recognizedHint = recognized.hint || '';
      console.log('识别结果:', recognizedCode);
      if (recognizedHint) {
        console.warn('识别建议需人工确认:', recognizedHint);
      }
    } catch (error) {
      recognizedError = '自动识别失败，请手动输入验证码。';
      console.error('识别失败:', error.message || error);
    }

    run.captcha = {
      id: String(event.captcha.id),
      status: 'waiting',
      accountLabel: event.captcha.accountLabel ? maskPhoneText(event.captcha.accountLabel) : '',
      message: event.captcha.message ? maskPhoneText(event.captcha.message) : '请输入验证码后继续。',
      imageUrl: imageFile ? `/api/captcha/image/${encodeURIComponent(imageFile)}?v=${Date.now()}` : '',
      recognizedCode,
      recognizedRaw,
      recognizedHint,
      recognizedError,
      createdAt: event.captcha.createdAt || new Date().toISOString(),
      submittedAt: null,
    };
  }

  if (event.captchaClear) {
    run.captcha = null;
  }
}

function processStderrChunk(run, text) {
  if (run && run.stopRequested) {
    run.stderrLineBuffer = '';
    return;
  }

  run.stderrLineBuffer = `${run.stderrLineBuffer || ''}${text}`;
  const lines = run.stderrLineBuffer.split(/\r?\n/);
  run.stderrLineBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (line.startsWith('MIAOSHOU_PROGRESS ')) {
      try {
        const event = JSON.parse(line.slice('MIAOSHOU_PROGRESS '.length));
        updateRunProgress(run, event);
        appendProgressLogIfChanged(run);
      } catch (error) {
        appendLogEntry(run, 'stderr', line);
      }
      continue;
    }

    appendLogEntry(run, 'stderr', line);
  }
}

function normalizeResultSummary(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const failedItems = Array.isArray(parsed.failedItems)
    ? parsed.failedItems
    : collectFailedResultItems(parsed.results);

  return {
    totalCount: Number.isFinite(Number(parsed.totalCount)) ? Number(parsed.totalCount) : 0,
    successCount: Number.isFinite(Number(parsed.successCount)) ? Number(parsed.successCount) : 0,
    errorCount: Number.isFinite(Number(parsed.errorCount)) ? Number(parsed.errorCount) : 0,
    skippedCount: Number.isFinite(Number(parsed.skippedCount)) ? Number(parsed.skippedCount) : 0,
    publishAppliedCount: parsed.publish && Number.isFinite(Number(parsed.publish.appliedCount))
      ? Number(parsed.publish.appliedCount)
      : (Number.isFinite(Number(parsed.publishAppliedCount)) ? Number(parsed.publishAppliedCount) : 0),
    duplicateCount: Number.isFinite(Number(parsed.duplicateCount)) ? Number(parsed.duplicateCount) : 0,
    mode: parsed.mode,
    requestedCount: parsed.requestedCount,
    scannedFailureRecords: Number.isFinite(Number(parsed.scannedFailureRecords)) ? Number(parsed.scannedFailureRecords) : 0,
    matchedStores: parsed.matchedStores,
    matchedStoreCount: Number.isFinite(Number(parsed.matchedStoreCount)) ? Number(parsed.matchedStoreCount) : 0,
    processedStoreCount: Number.isFinite(Number(parsed.processedStoreCount)) ? Number(parsed.processedStoreCount) : 0,
    unpublishedCount: Number.isFinite(Number(parsed.unpublishedCount)) ? Number(parsed.unpublishedCount) : 0,
    skippedStores: parsed.skippedStores,
    params: parsed.params,
    results: parsed.results,
    failedItems,
  };
}

function resolveResultItemFailure(item = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  if (item.optimizeError || item.optimizeStatus === 'error') {
    return {
      stage: 'optimize',
      error: item.optimizeError || item.error || '编辑优化失败',
    };
  }
  if (item.syncError || item.syncStatus === 'error') {
    return {
      stage: 'sync',
      error: item.syncError || item.error || '同步站点失败',
    };
  }
  if (item.publishError || item.publishStatus === 'error') {
    return {
      stage: 'publish',
      error: item.publishError || item.error || '发布商品失败',
    };
  }
  if (item.error) {
    return {
      stage: 'task',
      error: item.error,
    };
  }
  return null;
}

function collectFailedResultItems(results = []) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map((item) => {
      const failure = resolveResultItemFailure(item);
      if (!failure) {
        return null;
      }
      return {
        detailId: String(item.detailId || item.activityId || item.id || ''),
        stage: failure.stage,
        error: maskPhoneText(failure.error),
      };
    })
    .filter(Boolean);
}

function tryParseResultText(text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return null;
  }

  try {
    return normalizeResultSummary(JSON.parse(normalizedText));
  } catch (error) {
    return null;
  }
}

function tryParseResult(run) {
  return tryParseResultText(run && run.stdout);
}

function combineWorkflowSummary(editSummary, flashSummary) {
  const edit = editSummary || normalizeResultSummary({});
  const flash = flashSummary || normalizeResultSummary({});
  const failedItems = [
    ...(Array.isArray(edit.failedItems) ? edit.failedItems : []),
    ...(Array.isArray(flash.failedItems) ? flash.failedItems : []),
  ];
  return {
    mode: 'edit-publish-flash-workflow',
    totalCount: Number(edit.totalCount || 0) + Number(flash.totalCount || 0),
    successCount: Number(edit.successCount || 0) + Number(flash.successCount || 0),
    errorCount: Number(edit.errorCount || 0) + Number(flash.errorCount || 0),
    skippedCount: Number(edit.skippedCount || 0) + Number(flash.skippedCount || 0),
    publishAppliedCount: Number(edit.publishAppliedCount || 0),
    edit,
    flash,
    failedItems,
    results: [
      ...(Array.isArray(edit.results) ? edit.results : []),
      ...(Array.isArray(flash.results) ? flash.results : []),
    ],
  };
}

function isCollectionSummary(summary) {
  return Boolean(summary && ['1688-collection', 'shopee-collection', 'amazon-collection', 'link-collection'].includes(summary.mode));
}

function collectionSummaryReachedTarget(summary) {
  if (!isCollectionSummary(summary)) {
    return false;
  }
  const requestedCount = Number(summary.requestedCount);
  const successCount = Number(summary.successCount);
  return Number.isFinite(requestedCount)
    && requestedCount > 0
    && Number.isFinite(successCount)
    && successCount >= requestedCount;
}

function collectionSummaryHasTargetShortfall(summary) {
  if (!isCollectionSummary(summary)) {
    return false;
  }
  const requestedCount = Number(summary.requestedCount);
  const successCount = Number(summary.successCount);
  return Number.isFinite(requestedCount)
    && requestedCount > 0
    && (!Number.isFinite(successCount) || successCount < requestedCount);
}

function summaryHasErrors(summary) {
  if (summary && summary.mode === 'product-limit-store-unpublish') {
    const failedItems = Array.isArray(summary.failedItems) ? summary.failedItems : [];
    return failedItems.length > 0;
  }
  if (collectionSummaryReachedTarget(summary)) {
    return false;
  }
  return Number(summary && summary.errorCount) > 0 || collectionSummaryHasTargetShortfall(summary);
}

function isAiOptimizeFailure(item = {}) {
  return item
    && item.stage === 'optimize'
    && /DeepSeek|Kimi|MiMo|AI|request timed out|503|Service is too busy/i.test(String(item.error || ''));
}

function isRecoverableEditSummaryForFlash(summary) {
  const failedItems = Array.isArray(summary && summary.failedItems) ? summary.failedItems : [];
  return Boolean(
    summary
    && Number(summary.totalCount) > 0
    && Number(summary.successCount) > 0
    && failedItems.length > 0
    && failedItems.every(isAiOptimizeFailure),
  );
}

function formatFailedItemsForLog(failedItems = [], maxItems = 20) {
  const items = Array.isArray(failedItems) ? failedItems : [];
  const visibleItems = items.slice(0, maxItems);
  const suffix = items.length > visibleItems.length
    ? `，另有 ${items.length - visibleItems.length} 个未显示`
    : '';
  return visibleItems
    .map((item) => `${item.detailId || '未知商品'}：${item.error || '未知错误'}`)
    .join('；') + suffix;
}

function appendFailedItemsLog(run, label, failedItems = []) {
  if (!run || !Array.isArray(failedItems) || failedItems.length === 0) {
    return;
  }

  appendLog(run, 'stderr', `${label}：${formatFailedItemsForLog(failedItems)}`);
}

function extractProcessErrorMessage(stderrText = '') {
  const lines = String(stderrText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*at\s+/.test(line));
  const preferred = [...lines]
    .reverse()
    .find((line) => /妙手服务异常|妙手接口|Bad Gateway|Service Unavailable|Gateway Timeout|HTTP\s*(502|503|504)\b/i.test(line));
  return preferred || lines[lines.length - 1] || '';
}

function getSummaryErrorMessage(summary) {
  if (summary && summary.mode === 'product-limit-store-unpublish') {
    const failedItems = Array.isArray(summary.failedItems) ? summary.failedItems : [];
    return `商品管理失败 ${failedItems.length} 项`;
  }

  if (collectionSummaryHasTargetShortfall(summary)) {
    const successCount = Number.isFinite(Number(summary.successCount)) ? Number(summary.successCount) : 0;
    const requestedCount = Number.isFinite(Number(summary.requestedCount)) ? Number(summary.requestedCount) : 0;
    return `商品采集未达到目标：已采集 ${successCount}/${requestedCount} 个。`;
  }

  if (collectionSummaryReachedTarget(summary)) {
    return '';
  }

  const failedItems = Array.isArray(summary && summary.failedItems) ? summary.failedItems : [];
  if (failedItems.length > 0) {
    return failedItems[0].error || '任务结果包含失败项。';
  }

  const results = Array.isArray(summary && summary.results) ? summary.results : [];
  const failed = results.find((item) => item && (
    item.error
    || item.optimizeError
    || item.syncError
    || item.publishError
  ));
  if (!failed) {
    return summaryHasErrors(summary) ? '任务结果包含失败项。' : '';
  }

  return failed.error
    || failed.optimizeError
    || failed.syncError
    || failed.publishError
    || '任务结果包含失败项。';
}

function serializeRun(run) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    status: run.status,
    command: run.command,
    queueLabel: run.queueLabel || '',
    queueAccount: run.queueAccount || null,
    count: run.count,
    detailIds: run.detailIds || [],
    itemSelectionMode: run.itemSelectionMode || ITEM_SELECTION_MODE_RANGE,
    itemStartIndex: run.itemStartIndex || 0,
    itemEndIndex: run.itemEndIndex || 0,
    publish: run.publish,
    sourcePriceExtraCny: run.sourcePriceExtraCny || 0,
    weightPaddingGrams: run.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    buyOneTakeOne: Boolean(run.buyOneTakeOne),
    buyOneTakeOnePriceMarkupPercent: run.buyOneTakeOnePriceMarkupPercent ?? DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT,
    processingMode: run.processingMode,
    flashCount: run.flashCount,
    flashSelectionMode: run.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    flashActivityIds: run.flashActivityIds || [],
    skipFlashActivityIds: run.skipFlashActivityIds || [],
    processedFlashActivities: run.processedFlashActivities || [],
    retrySourceRunId: run.retrySourceRunId || '',
    collectCount: run.collectCount,
    collectDedupeWindowDays: run.collectDedupeWindowDays,
    collectSource: run.collectSource,
    collectAmazonMode: run.collectAmazonMode,
    collectAmazonMarketplace: run.collectAmazonMarketplace,
    collectAmazonMaxPriceUsd: run.collectAmazonMaxPriceUsd,
    collectAmazonMinRating: run.collectAmazonMinRating,
    collectAmazonMinReviewCount: run.collectAmazonMinReviewCount,
    collectShopeeSite: run.collectShopeeSite,
    collectShopeeMaxPrice: run.collectShopeeMaxPrice,
    collectShopeeMaxMoq: run.collectShopeeMaxMoq,
    collectKeywords: run.collectKeywords,
    collectMaxPriceCny: run.collectMaxPriceCny,
    collectPreferredTerms: run.collectPreferredTerms,
    collectExcludedTerms: run.collectExcludedTerms,
    collectMinScore: run.collectMinScore,
    collectSafeMode: run.collectSafeMode,
    collectLinks: run.collectLinks,
    productManagementAction: run.productManagementAction || '',
    productManagementMaxPages: run.productManagementMaxPages || 0,
    productManagementRetainCount: run.productManagementRetainCount ?? DEFAULT_PRODUCT_MANAGEMENT_RETAIN_COUNT,
    productManagementDryRun: Boolean(run.productManagementDryRun),
    productManagementStores: run.productManagementStores || [],
    tasks: run.tasks,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    signal: run.signal,
    error: maskPhoneText(run.error),
    summary: run.summary,
    detailName: run.progress.detailName || '',
    progress: run.progress,
    account: run.account,
    captcha: run.captcha || null,
    logs: run.logs,
  };
}

function hasChildExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function isRunActive(run) {
  return Boolean(run && run.status === 'running' && run.child && !hasChildExited(run.child));
}

function clearStopTimer(run) {
  if (!run || !run.stopTimer) {
    return;
  }
  clearTimeout(run.stopTimer);
  run.stopTimer = null;
}

function finalizeStoppedRun(run) {
  if (!run || !run.stopRequested) {
    return false;
  }

  clearStopTimer(run);
  run.status = 'stopped';
  run.error = '';
  run.captcha = null;
  run.stderrLineBuffer = '';
  run.endedAt = run.endedAt || new Date().toISOString();
  run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
  updateRunProgress(run, {
    phase: 'stopped',
    completed: run.progress.completed,
    total: run.progress.total,
    totalCount: run.progress.totalCount,
    overallPercent: run.progress.overallPercent,
  });
  appendLog(run, 'system', '任务已手动停止。');
  rememberRun(run);
  return true;
}

function rememberRun(run) {
  const diagnostic = saveRunDiagnostic(run, { logLimit: 120 });
  history.unshift({
    id: run.id,
    status: run.status,
    command: run.command,
    count: run.count,
    itemSelectionMode: run.itemSelectionMode || ITEM_SELECTION_MODE_RANGE,
    detailIds: run.detailIds || [],
    itemStartIndex: run.itemStartIndex || 0,
    itemEndIndex: run.itemEndIndex || 0,
    publish: run.publish,
    sourcePriceExtraCny: run.sourcePriceExtraCny || 0,
    weightPaddingGrams: run.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    buyOneTakeOne: Boolean(run.buyOneTakeOne),
    buyOneTakeOnePriceMarkupPercent: run.buyOneTakeOnePriceMarkupPercent ?? DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT,
    processingMode: run.processingMode,
    flashCount: run.flashCount,
    flashSelectionMode: run.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    flashActivityIds: run.flashActivityIds || [],
    skipFlashActivityIds: run.skipFlashActivityIds || [],
    processedFlashActivities: run.processedFlashActivities || [],
    retrySourceRunId: run.retrySourceRunId || '',
    collectCount: run.collectCount,
    collectSource: run.collectSource,
    collectAmazonMode: run.collectAmazonMode,
    collectAmazonMarketplace: run.collectAmazonMarketplace,
    collectAmazonMaxPriceUsd: run.collectAmazonMaxPriceUsd,
    collectAmazonMinRating: run.collectAmazonMinRating,
    collectAmazonMinReviewCount: run.collectAmazonMinReviewCount,
    collectShopeeSite: run.collectShopeeSite,
    collectShopeeMaxPrice: run.collectShopeeMaxPrice,
    collectShopeeMaxMoq: run.collectShopeeMaxMoq,
    collectKeywords: run.collectKeywords,
    collectMaxPriceCny: run.collectMaxPriceCny,
    collectPreferredTerms: run.collectPreferredTerms,
    collectExcludedTerms: run.collectExcludedTerms,
    collectMinScore: run.collectMinScore,
    collectSafeMode: run.collectSafeMode,
    collectLinks: run.collectLinks,
    productManagementAction: run.productManagementAction || '',
    productManagementMaxPages: run.productManagementMaxPages || 0,
    productManagementRetainCount: run.productManagementRetainCount ?? DEFAULT_PRODUCT_MANAGEMENT_RETAIN_COUNT,
    productManagementDryRun: Boolean(run.productManagementDryRun),
    productManagementStores: run.productManagementStores || [],
    tasks: run.tasks,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    signal: run.signal,
    summary: run.summary,
    error: maskPhoneText(run.error),
    detailName: run.progress.detailName || '',
    account: run.account,
    progress: run.progress,
    diagnosticId: diagnostic ? diagnostic.id : '',
    diagnosticFailureType: diagnostic ? diagnostic.failureType : '',
    diagnosticFailureText: diagnostic ? failureTypeLabel(diagnostic.failureType) : '',
  });

  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS);
  }
  saveRunHistory(history, { limit: MAX_HISTORY_ITEMS });
  scheduleNextQueuedRun();
}

function startProductManagementRun(options) {
  ensureCaptchaDir();
  const accountSummary = serializeMiaoshouAccount(options.account);
  const action = normalizeProductManagementAction(options.productManagementAction);
  const maxPages = options.productManagementMaxPages;
  const retainCount = options.productManagementRetainCount ?? DEFAULT_PRODUCT_MANAGEMENT_RETAIN_COUNT;
  const stores = Array.isArray(options.productManagementStores) ? options.productManagementStores : [];
  const args = [
    PRODUCT_MANAGEMENT_SCRIPT_PATH,
    '--task',
    action,
    '--max-pages',
    String(maxPages),
    '--retain-count',
    String(retainCount),
  ];
  let command = `node miaoshou_product_management.js --task unpublish-limit-stores --max-pages ${maxPages} --retain-count ${retainCount}`;
  if (options.productManagementDryRun) {
    args.push('--dry-run');
    command += ' --dry-run';
  }
  if (stores.length > 0) {
    args.push('--stores', stores.join(','));
    command += ` --stores ${stores.join(',')}`;
  }

  const run = {
    id: randomUUID(),
    count: stores.length,
    productManagementAction: action,
    productManagementMaxPages: maxPages,
    productManagementRetainCount: retainCount,
    productManagementDryRun: Boolean(options.productManagementDryRun),
    productManagementStores: stores,
    tasks: options.tasks || {
      collect: false,
      edit: false,
      flash: false,
      productManagement: true,
    },
    account: accountSummary,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    error: '',
    summary: null,
    progress: {
      phase: 'productManagement',
      phaseLabel: '商品管理',
      completed: 0,
      total: stores.length,
      totalCount: stores.length,
      detailId: '',
      detailName: '',
      matchedStores: [],
      overallPercent: 0,
      updatedAt: new Date().toISOString(),
    },
    stdout: '',
    stderr: '',
    stderrLineBuffer: '',
    logs: [],
    captcha: null,
    child: null,
  };

  appendLog(run, 'system', `开始执行：${command}`);
  appendLog(run, 'system', `已选择账号：${accountSummary ? accountSummary.label : '当前账号'}`);
  appendLog(run, 'system', `上限店铺商品下架：扫描发布失败记录，筛选销量 0 到 0，搜索后切换 100条/页；零销量商品超过 ${retainCount} 个时从最后一页开始下架，直到不超过这个数量。`);
  if (stores.length > 0) {
    appendLog(run, 'system', `指定店铺：${stores.join('，')}。`);
  }
  if (run.productManagementDryRun) {
    appendLog(run, 'system', 'Dry-run 模式：只扫描和汇总，不执行下架。');
  }

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: {
      ...buildChildProcessEnv(options.account),
      MIAOSHOU_RUN_ID: run.id,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  currentRun = run;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stdout += text;
    appendLog(run, 'stdout', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stderr += text;
    processStderrChunk(run, text);
  });

  child.on('error', (error) => {
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = 'error';
    run.error = error.message || String(error);
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    updateRunProgress(run, {
      phase: 'error',
      completed: run.progress.completed,
      total: run.progress.total,
      totalCount: run.progress.totalCount,
      overallPercent: run.progress.overallPercent,
    });
    appendLog(run, 'stderr', run.error);
    rememberRun(run);
  });

  child.on('close', (code, signal) => {
    if (run.stderrLineBuffer) {
      processStderrChunk(run, '\n');
    }
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    run.summary = tryParseResult(run);
    if (finalizeStoppedRun(run)) {
      return;
    }
    const resultHasErrors = summaryHasErrors(run.summary);
    run.status = code === 0 && !resultHasErrors && !signal ? 'success' : 'error';
    if (run.status === 'success') {
      const completedStoreCount = run.summary && Number.isFinite(Number(run.summary.processedStoreCount))
        ? Number(run.summary.processedStoreCount)
        : stores.length;
      const matchedStoreCount = run.summary && Number.isFinite(Number(run.summary.matchedStoreCount))
        ? Number(run.summary.matchedStoreCount)
        : stores.length;
      updateRunProgress(run, {
        phase: 'complete',
        completed: completedStoreCount,
        total: matchedStoreCount,
        totalCount: matchedStoreCount,
        overallPercent: 100,
      });
    } else {
      updateRunProgress(run, {
        phase: 'error',
        completed: run.progress.completed,
        total: run.progress.total,
        totalCount: run.progress.totalCount,
        overallPercent: run.progress.overallPercent,
      });
    }
    if (signal) {
      run.error = `进程已停止：${signal}`;
    } else if (resultHasErrors) {
      run.error = getSummaryErrorMessage(run.summary);
    } else if (code !== 0) {
      run.error = extractProcessErrorMessage(run.stderr) || `退出码：${code}`;
    }
    appendLog(
      run,
      run.status === 'success' ? 'system' : 'stderr',
      run.status === 'success' ? '商品管理执行完成。' : `商品管理执行失败：${run.error || `退出码：${code}`}`,
    );
    rememberRun(run);
  });

  return run;
}

function startFlashOnlyRun(options) {
  ensureCaptchaDir();
  const accountSummary = serializeMiaoshouAccount(options.account);
  const flashArgs = options.flashSelectionMode === FLASH_SELECTION_MODE_IDS
    ? ['--activity-ids', (options.flashActivityIds || []).join(',')]
    : (options.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? ['--all'] : ['--count', String(options.flashCount)]);
  if (Array.isArray(options.skipFlashActivityIds) && options.skipFlashActivityIds.length > 0) {
    flashArgs.push('--skip-activity-ids', options.skipFlashActivityIds.join(','));
  }
  const args = [
    FLASH_SCRIPT_PATH,
    ...flashArgs,
  ];
  const command = options.flashSelectionMode === FLASH_SELECTION_MODE_IDS
    ? `node miaoshou_flash_sale.js --activity-ids ${(options.flashActivityIds || []).join(',')}`
    : (options.flashSelectionMode === FLASH_SELECTION_MODE_ALL
      ? 'node miaoshou_flash_sale.js --all'
      : `node miaoshou_flash_sale.js --count ${options.flashCount}`);
  const run = {
    id: randomUUID(),
    count: 0,
    publish: false,
    flashCount: options.flashCount,
    flashSelectionMode: options.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    flashActivityIds: options.flashActivityIds || [],
    skipFlashActivityIds: options.skipFlashActivityIds || [],
    processedFlashActivities: options.processedFlashActivities || [],
    retrySourceRunId: options.retrySourceRunId || '',
    tasks: options.tasks,
    account: accountSummary,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    error: '',
    summary: null,
    progress: {
      phase: 'flash',
      phaseLabel: '秒杀活动',
      completed: 0,
      total: options.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? 0 : options.flashCount,
      totalCount: options.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? 0 : options.flashCount,
      detailId: '',
      detailName: '',
      overallPercent: 0,
      updatedAt: new Date().toISOString(),
    },
    stdout: '',
    stderr: '',
    stderrLineBuffer: '',
    logs: [],
    captcha: null,
    child: null,
  };

  appendLog(run, 'system', `已选择账号：${accountSummary ? accountSummary.label : '当前账号'}`);
  appendLog(run, 'system', `计划处理秒杀活动：${formatFlashSelectionText(run)}。`);
  if (run.skipFlashActivityIds.length > 0) {
    appendLog(run, 'system', `继续秒杀将跳过已处理活动 ${run.skipFlashActivityIds.length} 个。`);
  }
  appendLog(run, 'system', '开始执行秒杀活动自动化。');

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: buildChildProcessEnv(options.account, {
      MIAOSHOU_RUN_ID: run.id,
      MIAOSHOU_CAPTCHA_DIR: CAPTCHA_DIR,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  currentRun = run;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stdout += text;
    appendLog(run, 'stdout', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stderr += text;
    processStderrChunk(run, text);
  });

  child.on('error', (error) => {
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = 'error';
    run.error = error.message || String(error);
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    appendLog(run, 'stderr', run.error);
    rememberRun(run);
  });

  child.on('close', (code, signal) => {
    if (run.stderrLineBuffer) {
      processStderrChunk(run, '\n');
    }
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    run.summary = tryParseResult(run);
    if (finalizeStoppedRun(run)) {
      return;
    }
    const resultHasErrors = summaryHasErrors(run.summary);
    run.status = code === 0 && !resultHasErrors && !signal ? 'success' : 'error';
    if (run.status === 'success') {
      const completedFlashCount = run.summary
        && Number.isFinite(Number(run.summary.totalCount))
        ? Number(run.summary.totalCount)
        : run.flashCount;
      updateRunProgress(run, {
        phase: 'complete',
        completed: completedFlashCount,
        total: completedFlashCount,
        totalCount: completedFlashCount,
        overallPercent: 100,
      });
    } else {
      updateRunProgress(run, {
        phase: 'error',
        completed: run.progress.completed,
        total: run.progress.total,
        totalCount: run.progress.totalCount,
        overallPercent: run.progress.overallPercent,
      });
    }
    if (signal) {
      run.error = `进程已停止：${signal}`;
    } else if (resultHasErrors) {
      run.error = getSummaryErrorMessage(run.summary);
    } else if (code !== 0) {
      run.error = extractProcessErrorMessage(run.stderr) || `退出码：${code}`;
    }
    appendLog(
      run,
      run.status === 'success' ? 'system' : 'stderr',
      run.status === 'success' ? '秒杀活动执行完成。' : `秒杀活动执行失败：${run.error || `退出码：${code}`}`,
    );
    rememberRun(run);
  });

  return run;
}

function startCollectRun(options) {
  ensureCaptchaDir();
  const accountSummary = serializeMiaoshouAccount(options.account);
  const args = [
    COLLECT_SCRIPT_PATH,
    '--source',
    options.collectSource,
    '--amazon-mode',
    options.collectAmazonMode,
    '--amazon-marketplace',
    options.collectAmazonMarketplace,
    '--amazon-max-price-usd',
    String(options.collectAmazonMaxPriceUsd),
    '--amazon-min-rating',
    String(options.collectAmazonMinRating),
    '--amazon-min-review-count',
    String(options.collectAmazonMinReviewCount),
    '--shopee-site',
    options.collectShopeeSite,
    '--shopee-max-price',
    String(options.collectShopeeMaxPrice),
    '--shopee-max-moq',
    String(options.collectShopeeMaxMoq),
    '--keywords',
    options.collectKeywords,
    '--count',
    String(options.collectCount),
    '--dedupe-days',
    String(options.collectDedupeWindowDays),
    '--max-price',
    String(options.collectMaxPriceCny),
    '--preferred-terms',
    options.collectPreferredTerms,
    '--excluded-terms',
    options.collectExcludedTerms,
    '--min-score',
    String(options.collectMinScore),
    '--safe-mode',
    String(options.collectSafeMode),
    '--skip-filters',
    String(options.collectSkipFilters),
    '--links',
    options.collectLinks,
  ];
  const command = `node miaoshou_1688_collect.js --source ${options.collectSource} --amazon-mode ${options.collectAmazonMode} --amazon-marketplace ${options.collectAmazonMarketplace} --amazon-max-price-usd ${options.collectAmazonMaxPriceUsd} --amazon-min-rating ${options.collectAmazonMinRating} --amazon-min-review-count ${options.collectAmazonMinReviewCount} --shopee-site ${options.collectShopeeSite} --shopee-max-price ${options.collectShopeeMaxPrice} --shopee-max-moq ${options.collectShopeeMaxMoq} --keywords ${JSON.stringify(options.collectKeywords)} --count ${options.collectCount} --dedupe-days ${options.collectDedupeWindowDays} --max-price ${options.collectMaxPriceCny} --preferred-terms ${JSON.stringify(options.collectPreferredTerms)} --excluded-terms ${JSON.stringify(options.collectExcludedTerms)} --min-score ${options.collectMinScore} --safe-mode ${options.collectSafeMode} --skip-filters ${options.collectSkipFilters} --links ${JSON.stringify(options.collectLinks || '')}`;
  const run = {
    id: randomUUID(),
    count: options.collectCount,
    collectCount: options.collectCount,
    collectDedupeWindowDays: options.collectDedupeWindowDays,
    collectKeywords: options.collectKeywords,
    collectSource: options.collectSource,
    collectAmazonMode: options.collectAmazonMode,
    collectAmazonMarketplace: options.collectAmazonMarketplace,
    collectAmazonMaxPriceUsd: options.collectAmazonMaxPriceUsd,
    collectAmazonMinRating: options.collectAmazonMinRating,
    collectAmazonMinReviewCount: options.collectAmazonMinReviewCount,
    collectShopeeSite: options.collectShopeeSite,
    collectShopeeMaxPrice: options.collectShopeeMaxPrice,
    collectShopeeMaxMoq: options.collectShopeeMaxMoq,
    collectMaxPriceCny: options.collectMaxPriceCny,
    collectPreferredTerms: options.collectPreferredTerms,
    collectExcludedTerms: options.collectExcludedTerms,
    collectMinScore: options.collectMinScore,
    collectSafeMode: options.collectSafeMode,
    collectSkipFilters: options.collectSkipFilters,
    collectLinks: options.collectLinks,
    tasks: options.tasks || { collect: true, edit: false, flash: false },
    account: accountSummary,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    error: '',
    summary: null,
    progress: {
      phase: 'collect',
      phaseLabel: '商品采集',
      completed: 0,
      total: options.collectCount,
      totalCount: options.collectCount,
      detailId: '',
      overallPercent: 0,
      updatedAt: new Date().toISOString(),
    },
    stdout: '',
    stderr: '',
    stderrLineBuffer: '',
    logs: [],
    captcha: null,
    child: null,
  };

  appendLog(run, 'system', `开始执行：${command}`);
  appendLog(run, 'system', `采集来源：${options.collectSource === COLLECT_SOURCE_LINKS
    ? '商品链接'
    : options.collectSource === COLLECT_SOURCE_AMAZON
      ? 'Amazon.com'
      : (options.collectSource === COLLECT_SOURCE_SHOPEE ? `Shopee ${options.collectShopeeSite}` : '1688')
    }。`);
  appendLog(run, 'system', `采集关键词：${options.collectKeywords}`);
  if (options.collectLinks) {
    appendLog(run, 'system', '已提供商品链接，将直接通过妙手接口采集。');
  }
  if (options.collectSource === COLLECT_SOURCE_AMAZON) {
    appendLog(run, 'system', `计划采集 ${options.collectCount} 个，Amazon 模式：${options.collectAmazonMode === 'links' ? '链接/ASIN' : '关键词'}；最高展示价 ${options.collectAmazonMaxPriceUsd} USD，Amazon 最低评分 ${options.collectAmazonMinRating}，最低评论数 ${options.collectAmazonMinReviewCount}。`);
  } else if (options.collectSource === COLLECT_SOURCE_LINKS) {
    appendLog(run, 'system', `计划采集 ${options.collectCount} 个商品链接。`);
  } else {
    appendLog(run, 'system', `计划采集 ${options.collectCount} 个，最高采购价 ${options.collectMaxPriceCny} 元，最低评分 ${options.collectMinScore}。`);
  }
  if (options.collectSource === COLLECT_SOURCE_SHOPEE) {
    appendLog(run, 'system', `Shopee 最高展示价 ${options.collectShopeeMaxPrice}，1688 最大起批量 ${options.collectShopeeMaxMoq}。`);
  }
  appendLog(run, 'system', `最近 ${options.collectDedupeWindowDays} 天已采集商品会自动跳过。`);
  if (options.collectSource !== COLLECT_SOURCE_AMAZON && options.collectSource !== COLLECT_SOURCE_LINKS) {
    appendLog(run, 'system', `安全模式：${options.collectSafeMode ? '开启' : '关闭'}。`);
  }
  if (accountSummary) {
    appendLog(run, 'system', `使用账号：${accountSummary.label}`);
  }

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: buildChildProcessEnv(options.account, {
      MIAOSHOU_RUN_ID: run.id,
      MIAOSHOU_CAPTCHA_DIR: CAPTCHA_DIR,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  currentRun = run;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stdout += text;
    appendLog(run, 'stdout', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stderr += text;
    processStderrChunk(run, text);
  });

  child.on('error', (error) => {
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = 'error';
    run.error = error.message || String(error);
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    appendLog(run, 'stderr', run.error);
    rememberRun(run);
  });

  child.on('close', (code, signal) => {
    if (run.stderrLineBuffer) {
      processStderrChunk(run, '\n');
    }
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    run.summary = tryParseResult(run);
    if (finalizeStoppedRun(run)) {
      return;
    }
    const resultHasErrors = summaryHasErrors(run.summary);
    run.status = code === 0 && !resultHasErrors && !signal ? 'success' : 'error';
    if (run.status === 'success') {
      updateRunProgress(run, {
        phase: 'complete',
        completed: run.summary && Number.isFinite(Number(run.summary.successCount)) ? Number(run.summary.successCount) : run.collectCount,
        total: run.collectCount,
        totalCount: run.collectCount,
        overallPercent: 100,
      });
    } else {
      updateRunProgress(run, {
        phase: 'error',
        completed: run.progress.completed,
        total: run.progress.total,
        totalCount: run.progress.totalCount,
        overallPercent: run.progress.overallPercent,
      });
    }
    if (signal) {
      run.error = `进程已停止：${signal}`;
    } else if (resultHasErrors) {
      run.error = getSummaryErrorMessage(run.summary);
    } else if (code !== 0) {
      run.error = extractProcessErrorMessage(run.stderr) || `退出码：${code}`;
    }
    appendLog(
      run,
      run.status === 'success' ? 'system' : 'stderr',
      run.status === 'success' ? '商品采集完成。' : `商品采集失败：${run.error || `退出码：${code}`}`,
    );
    rememberRun(run);
  });

  return run;
}

function startChainedFlashRun(run, account) {
  const flashArgs = run.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? ['--all'] : ['--count', String(run.flashCount)];
  if (Array.isArray(run.skipFlashActivityIds) && run.skipFlashActivityIds.length > 0) {
    flashArgs.push('--skip-activity-ids', run.skipFlashActivityIds.join(','));
  }
  const args = [
    FLASH_SCRIPT_PATH,
    ...flashArgs,
  ];
  const command = run.flashSelectionMode === FLASH_SELECTION_MODE_ALL
    ? 'node miaoshou_flash_sale.js --all'
    : `node miaoshou_flash_sale.js --count ${run.flashCount}`;
  let flashStdout = '';
  let settled = false;

  run.status = 'running';
  run.exitCode = null;
  run.signal = null;
  run.error = '';
  run.endedAt = null;
  run.durationMs = null;
  run.stderrLineBuffer = '';
  updateRunProgress(run, {
    phase: 'flash',
    completed: 0,
    total: run.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? 0 : run.flashCount,
    totalCount: run.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? 0 : run.flashCount,
    overallPercent: 0,
  });
  appendLog(run, 'system', '编辑发布已完成，开始执行秒杀活动自动化。');
  appendLog(run, 'system', `开始执行：${command}`);

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: buildChildProcessEnv(account, {
      MIAOSHOU_RUN_ID: run.id,
      MIAOSHOU_CAPTCHA_DIR: CAPTCHA_DIR,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  currentRun = run;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    flashStdout += text;
    run.stdout += text;
    appendLog(run, 'stdout', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stderr += text;
    processStderrChunk(run, text);
  });

  child.on('error', (error) => {
    if (settled) {
      return;
    }
    settled = true;
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = 'error';
    run.error = error.message || String(error);
    run.summary = combineWorkflowSummary(run.editSummary, null);
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    updateRunProgress(run, {
      phase: 'error',
      completed: run.progress.completed,
      total: run.progress.total,
      totalCount: run.progress.totalCount,
      overallPercent: run.progress.overallPercent,
    });
    appendLog(run, 'stderr', run.error);
    rememberRun(run);
  });

  child.on('close', (code, signal) => {
    if (settled) {
      return;
    }
    settled = true;
    if (run.stderrLineBuffer) {
      processStderrChunk(run, '\n');
    }
    const flashSummary = tryParseResultText(flashStdout);
    run.flashSummary = flashSummary;
    run.summary = combineWorkflowSummary(run.editSummary, flashSummary);
    const flashHasErrors = summaryHasErrors(flashSummary);
    const workflowHasErrors = summaryHasErrors(run.summary);
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = code === 0 && !workflowHasErrors && !signal ? 'success' : 'error';

    if (run.status === 'success') {
      const completedFlashCount = flashSummary
        && Number.isFinite(Number(flashSummary.totalCount))
        ? Number(flashSummary.totalCount)
        : run.flashCount;
      updateRunProgress(run, {
        phase: 'complete',
        completed: completedFlashCount,
        total: completedFlashCount,
        totalCount: completedFlashCount,
        overallPercent: 100,
      });
    } else {
      updateRunProgress(run, {
        phase: 'error',
        completed: run.progress.completed,
        total: run.progress.total,
        totalCount: run.progress.totalCount,
        overallPercent: run.progress.overallPercent,
      });
    }

    if (signal) {
      run.error = `进程已停止：${signal}`;
    } else if (workflowHasErrors) {
      appendFailedItemsLog(run, '完整流程失败项', run.summary.failedItems);
      run.error = getSummaryErrorMessage(run.summary);
    } else if (code !== 0) {
      run.error = `退出码：${code}`;
    }
    if (run.status === 'success') {
      appendLog(run, 'system', '完整流程执行完成。');
    } else if (workflowHasErrors && !flashHasErrors && !signal && code === 0) {
      appendLog(run, 'stderr', `完整流程执行完成，但有部分商品失败：${run.error || '请查看失败商品列表'}`);
    } else {
      appendLog(run, 'stderr', `秒杀活动执行失败：${run.error || `退出码：${code}`}`);
    }
    rememberRun(run);
  });
}

function startRun(options) {
  if (options.tasks && options.tasks.productManagement) {
    return startProductManagementRun(options);
  }

  if (options.tasks && options.tasks.collect && !options.tasks.edit && !options.tasks.flash) {
    return startCollectRun(options);
  }

  if (options.tasks && options.tasks.edit === false && options.tasks.flash) {
    return startFlashOnlyRun(options);
  }

  ensureCaptchaDir();
  const account = options.account;
  const accountSummary = serializeMiaoshouAccount(account);
  const processingMode = normalizeProcessingMode(options.processingMode);
  const args = [
    SCRIPT_PATH,
    '--count',
    String(options.count),
    '--item-selection-mode',
    normalizeItemSelectionMode(options.itemSelectionMode),
    '--item-start-index',
    String(options.itemStartIndex || 1),
    '--item-end-index',
    String(options.itemEndIndex || options.count || 1),
    '--publish',
    options.publish ? 'true' : 'false',
    '--source-price-extra',
    String(options.sourcePriceExtraCny || 0),
    '--weight-padding-grams',
    String(options.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS),
    '--buy-one-take-one',
    options.buyOneTakeOne ? 'true' : 'false',
    '--buy-one-take-one-price-markup-percent',
    String(options.buyOneTakeOnePriceMarkupPercent ?? DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT),
  ];
  if (Array.isArray(options.detailIds) && options.detailIds.length > 0) {
    args.push('--detail-ids', options.detailIds.join(','));
  }
  const itemSelectionMode = normalizeItemSelectionMode(options.itemSelectionMode);
  const detailIdsCommand = Array.isArray(options.detailIds) && options.detailIds.length > 0
    ? ` --detail-ids ${options.detailIds.join(',')}`
    : '';
  const command = `node miaoshou_auto.js --count ${options.count} --item-selection-mode ${itemSelectionMode} --item-start-index ${options.itemStartIndex || 1} --item-end-index ${options.itemEndIndex || options.count || 1} --publish ${options.publish ? 'true' : 'false'} --source-price-extra ${options.sourcePriceExtraCny || 0} --weight-padding-grams ${options.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS} --buy-one-take-one ${options.buyOneTakeOne ? 'true' : 'false'} --buy-one-take-one-price-markup-percent ${options.buyOneTakeOnePriceMarkupPercent ?? DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT}${detailIdsCommand}`;
  const run = {
    id: randomUUID(),
    count: options.count,
    detailIds: options.detailIds || [],
    itemSelectionMode,
    itemStartIndex: itemSelectionMode === ITEM_SELECTION_MODE_ALL ? 0 : (options.itemStartIndex || 1),
    itemEndIndex: itemSelectionMode === ITEM_SELECTION_MODE_ALL ? 0 : (options.itemEndIndex || options.count || 1),
    publish: options.publish,
    sourcePriceExtraCny: options.sourcePriceExtraCny || 0,
    weightPaddingGrams: options.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    buyOneTakeOne: Boolean(options.buyOneTakeOne),
    buyOneTakeOnePriceMarkupPercent: options.buyOneTakeOnePriceMarkupPercent ?? DEFAULT_BUY_ONE_TAKE_ONE_PRICE_MARKUP_PERCENT,
    flashCount: options.flashCount,
    flashSelectionMode: options.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    flashActivityIds: options.flashActivityIds || [],
    skipFlashActivityIds: options.skipFlashActivityIds || [],
    processedFlashActivities: options.processedFlashActivities || [],
    retrySourceRunId: options.retrySourceRunId || '',
    tasks: options.tasks || { edit: true, flash: false },
    account: accountSummary,
    command,
    status: 'running',
    processingMode,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    error: '',
    summary: null,
    progress: {
      phase: 'prepare',
      phaseLabel: '准备中',
      completed: 0,
      total: options.count,
      totalCount: options.count,
      detailId: '',
      detailName: '',
      overallPercent: 0,
      updatedAt: new Date().toISOString(),
    },
    stdout: '',
    stderr: '',
    stderrLineBuffer: '',
    logs: [],
    captcha: null,
    child: null,
  };

  appendLog(run, 'system', `开始执行：${command}`);
  appendLog(run, 'system', `处理模式：${processingModeLabel(processingMode)}。`);
  appendLog(run, 'system', `编辑商品范围：${formatItemSelectionText(run)}。`);
  if (run.sourcePriceExtraCny > 0) {
    appendLog(run, 'system', `来源价格额外加价：${run.sourcePriceExtraCny} 元。`);
  }
  appendLog(run, 'system', `重量额外加重：${run.weightPaddingGrams}g。`);
  if (run.buyOneTakeOne) {
    appendLog(run, 'system', `单 SKU Buy 1 Take 1 已开启，加价比例：${run.buyOneTakeOnePriceMarkupPercent}%。`);
  }
  if (accountSummary) {
    appendLog(run, 'system', `使用账号：${accountSummary.label}`);
  }
  if (run.tasks && run.tasks.flash) {
    appendLog(run, 'system', `秒杀活动已选择：计划处理 ${formatFlashSelectionText(run)}。`);
  }

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: buildChildProcessEnv(account, {
      ...processingModeEnv(processingMode),
      MIAOSHOU_RUN_ID: run.id,
      MIAOSHOU_CAPTCHA_DIR: CAPTCHA_DIR,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  currentRun = run;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stdout += text;
    appendLog(run, 'stdout', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    run.stderr += text;
    processStderrChunk(run, text);
  });

  child.on('error', (error) => {
    if (finalizeStoppedRun(run)) {
      return;
    }
    run.status = 'error';
    run.error = error.message || String(error);
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    appendLog(run, 'stderr', run.error);
    rememberRun(run);
  });

  child.on('close', (code, signal) => {
    if (run.stderrLineBuffer) {
      processStderrChunk(run, '\n');
    }
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    run.durationMs = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    run.summary = tryParseResult(run);
    if (finalizeStoppedRun(run)) {
      return;
    }
    const resultHasErrors = summaryHasErrors(run.summary);
    run.status = code === 0 && !resultHasErrors && !signal ? 'success' : 'error';
    const shouldContinueToFlash = run.tasks
      && run.tasks.flash
      && !signal
      && (
        run.status === 'success'
        || isRecoverableEditSummaryForFlash(run.summary)
      );
    if (shouldContinueToFlash) {
      run.editSummary = run.summary;
      if (resultHasErrors) {
        appendFailedItemsLog(run, '编辑商品失败项', run.editSummary.failedItems);
        appendLog(run, 'system', '编辑商品有部分失败，已记录失败商品，继续执行秒杀活动。');
      }
      startChainedFlashRun(run, account);
      return;
    }
    if (run.status === 'success') {
      updateRunProgress(run, {
        phase: 'complete',
        completed: run.count,
        total: run.count,
        totalCount: run.count,
        overallPercent: 100,
      });
    } else {
      updateRunProgress(run, {
        phase: 'error',
        completed: run.progress.completed,
        total: run.progress.total,
        totalCount: run.progress.totalCount,
        overallPercent: run.progress.overallPercent,
      });
    }
    if (signal) {
      run.error = `进程已停止：${signal}`;
    } else if (resultHasErrors) {
      run.error = getSummaryErrorMessage(run.summary);
    } else if (code !== 0) {
      run.error = `退出码：${code}`;
    }
    appendLog(
      run,
      run.status === 'success' ? 'system' : 'stderr',
      run.status === 'success' ? '执行完成。' : `执行失败：${run.error || `退出码：${code}`}`,
    );
    rememberRun(run);
  });

  return run;
}

function stopCurrentRun() {
  if (!isRunActive(currentRun)) {
    return false;
  }

  const run = currentRun;
  if (!run.stopRequested) {
    appendLog(run, 'system', '正在停止当前任务...');
  }
  run.stopRequested = true;
  run.captcha = null;
  const sent = run.child.kill('SIGTERM');
  if (!sent) {
    appendLog(run, 'system', '停止信号发送失败，正在尝试强制结束进程...');
  }
  clearStopTimer(run);
  run.stopTimer = setTimeout(() => {
    if (!run.child || hasChildExited(run.child)) {
      return;
    }
    appendLog(run, 'system', '任务停止超时，正在强制结束进程...');
    run.child.kill('SIGKILL');
  }, STOP_FORCE_KILL_DELAY_MS);
  if (typeof run.stopTimer.unref === 'function') {
    run.stopTimer.unref();
  }
  return true;
}

function submitCaptchaCode(input = {}) {
  if (!isRunActive(currentRun) || !currentRun.captcha || currentRun.captcha.status !== 'waiting') {
    throw new Error('当前没有等待输入的验证码。');
  }

  const captchaId = String(input.id || '').trim();
  if (!captchaId || captchaId !== currentRun.captcha.id) {
    throw new Error('验证码请求已经变化，请刷新页面后重试。');
  }

  const code = String(input.code || '').trim();
  if (!code) {
    throw new Error('验证码不能为空。');
  }
  if (code.length > 20) {
    throw new Error('验证码长度不正确。');
  }

  ensureCaptchaDir();
  fs.writeFileSync(captchaResponsePath(captchaId), JSON.stringify({
    id: captchaId,
    code,
    submittedAt: new Date().toISOString(),
  }), 'utf8');

  currentRun.captcha = {
    ...currentRun.captcha,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
    message: '验证码已提交，正在继续登录。',
  };
  appendLog(currentRun, 'system', '验证码已提交，继续登录妙手。');
  return currentRun;
}

function clearCurrentRunLogs() {
  if (!currentRun) {
    return false;
  }

  if (isRunActive(currentRun)) {
    currentRun.logs = [];
    currentRun.captcha = null;
    return true;
  }

  currentRun = null;
  return true;
}

function clearRunHistory() {
  history.splice(0, history.length);
  clearRunHistoryStore();
  return true;
}

function updateManualFlashRun(input = {}) {
  if (!currentRun || !currentRun.tasks || !currentRun.tasks.flash) {
    throw new Error('当前没有等待处理的秒杀活动任务。');
  }

  const status = String(input.status || currentRun.status || 'running');
  const allowedStatuses = new Set(['ready', 'running', 'success', 'error']);
  if (!allowedStatuses.has(status)) {
    throw new Error('秒杀活动状态不正确。');
  }

  const total = Number.isFinite(Number(input.total))
    ? Math.max(0, Number(input.total))
    : (currentRun.flashCount || currentRun.progress.total || 0);
  const completed = Number.isFinite(Number(input.completed))
    ? Math.max(0, Number(input.completed))
    : currentRun.progress.completed;
  const overallPercent = total > 0 ? Math.round(Math.min(100, (completed / total) * 100)) : currentRun.progress.overallPercent;

  currentRun.status = status;
  currentRun.progress = {
    ...currentRun.progress,
    phase: status === 'success' ? 'complete' : 'flash',
    phaseLabel: status === 'success' ? '完成' : '秒杀活动',
    completed,
    total,
    totalCount: total,
    overallPercent: status === 'success' ? 100 : overallPercent,
    updatedAt: new Date().toISOString(),
  };

  if (input.message) {
    appendLog(currentRun, status === 'error' ? 'stderr' : 'system', String(input.message));
  }

  if (status === 'error') {
    currentRun.error = String(input.error || input.message || '秒杀活动处理失败。');
  }

  if (status === 'success' || status === 'error') {
    currentRun.endedAt = new Date().toISOString();
    currentRun.durationMs = new Date(currentRun.endedAt).getTime() - new Date(currentRun.startedAt).getTime();
    if (input.summary && typeof input.summary === 'object') {
      currentRun.summary = input.summary;
    }
    rememberRun(currentRun);
  }

  return currentRun;
}

function getLanUrls(port = PORT) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}

function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TikTok Shop丨妙手自动化工作台丨首页</title>
  <link rel="icon" href="/assets/tiktok-seller-favicon.ico">
  <link rel="stylesheet" href="/vendor/ant-design-vue/reset.css">
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="/vendor/vue.global.prod.js"></script>
  <script src="/vendor/dayjs/dayjs.min.js"></script>
  <script src="/vendor/dayjs/plugin/advancedFormat.js"></script>
  <script src="/vendor/dayjs/plugin/customParseFormat.js"></script>
  <script src="/vendor/dayjs/plugin/localeData.js"></script>
  <script src="/vendor/dayjs/plugin/quarterOfYear.js"></script>
  <script src="/vendor/dayjs/plugin/weekOfYear.js"></script>
  <script src="/vendor/dayjs/plugin/weekYear.js"></script>
  <script src="/vendor/dayjs/plugin/weekday.js"></script>
  <script src="/vendor/ant-design-vue/antd.min.js"></script>
  <script src="/assets/app.js"></script>
</body>
</html>`;
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstFiniteDiagnosticNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function formatDiagnosticNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '未记录';
}

function formatDiagnosticDate(value = '') {
  if (!value) {
    return '未记录';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDiagnosticDuration(value) {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '未记录';
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function diagnosticStatusLabel(status = '') {
  const labels = {
    error: '执行失败',
    stopped: '已停止',
    success: '已完成',
    running: '执行中',
    pending: '等待中',
  };
  return labels[String(status || '')] || String(status || '未记录');
}

function diagnosticFailureTypeLabel(type = '') {
  return failureTypeLabel(String(type || 'unknown'));
}

function diagnosticTaskLabel(tasks = {}) {
  const labels = [];
  if (tasks.edit) {
    labels.push('编辑商品');
  }
  if (tasks.flash) {
    labels.push('秒杀活动');
  }
  if (tasks.collect) {
    labels.push('采集商品');
  }
  return labels.length > 0 ? labels.join(' + ') : '未记录';
}

function normalizeDiagnosticFailedItem(item = {}, group = '') {
  const title = item.title
    || item.name
    || item.detailId
    || item.activityId
    || item.productId
    || item.itemId
    || item.id
    || '未识别项目';
  return {
    group,
    title: String(title),
    detail: String(item.detailId || item.activityId || item.productId || item.itemId || item.id || ''),
    error: String(item.error || item.reason || item.message || item.statusText || '未记录错误原因'),
  };
}

function collectDiagnosticFailedItems(summary = {}) {
  const failedItems = [];
  const seen = new Set();
  const addItems = (items, group = '') => {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      const normalized = normalizeDiagnosticFailedItem(item || {}, group);
      const key = `${normalized.group}:${normalized.title}:${normalized.detail}:${normalized.error}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      failedItems.push(normalized);
    }
  };

  addItems(summary.failedItems, '');
  addItems(summary.edit && summary.edit.failedItems, '编辑商品');
  addItems(summary.flash && summary.flash.failedItems, '秒杀活动');
  addItems(summary.collect && summary.collect.failedItems, '采集商品');
  addItems(summary.collection && summary.collection.failedItems, '采集商品');

  if (Array.isArray(summary.results)) {
    const failedResults = summary.results.filter((item) => {
      const status = String(item && item.status ? item.status : '').toLowerCase();
      return status === 'failed' || status === 'error' || Boolean(item && item.error);
    });
    addItems(failedResults, '');
  }

  return failedItems;
}

function importantDiagnosticLog(entry = {}) {
  const text = `${entry.stream || ''} ${entry.text || ''}`;
  return /(error|exception|timeout|not found|failed|失败|错误|异常|超时|验证码|登录|没有找到|找不到|等待|中断|停止|已记录失败)/i.test(text);
}

function buildDiagnosticLogRows(logs = []) {
  const rows = Array.isArray(logs) ? logs : [];
  const importantRows = rows.filter((entry) => importantDiagnosticLog(entry));
  const selectedRows = importantRows.length > 0 ? importantRows.slice(-16) : rows.slice(-8);
  return selectedRows.map((entry = {}) => ({
    time: formatDiagnosticDate(entry.time || entry.createdAt || ''),
    stream: String(entry.stream || 'system'),
    text: String(entry.text || ''),
  }));
}

function collectDiagnosticArtifacts(artifacts = []) {
  if (!Array.isArray(artifacts)) {
    return [];
  }
  return artifacts.map((artifact = {}, index) => {
    const files = artifact.files && typeof artifact.files === 'object' ? artifact.files : {};
    const links = Object.entries(files)
      .map(([type, file]) => ({
        type,
        name: file && file.name ? String(file.name) : type,
        url: file && file.url ? String(file.url) : '',
      }))
      .filter((file) => file.url);
    const screenshot = links.find((file) => file.type === 'screenshot' || /\.(png|jpe?g|webp)$/i.test(file.url));
    return {
      index: index + 1,
      stage: String(artifact.stage || artifact.label || '诊断证据'),
      title: String(artifact.title || artifact.url || ''),
      screenshot,
      links,
    };
  }).filter((artifact) => artifact.screenshot || artifact.links.length > 0);
}

function buildDiagnosticViewModel(diagnostic = {}) {
  const summary = diagnostic.summary && typeof diagnostic.summary === 'object' ? diagnostic.summary : {};
  const progress = diagnostic.progress && typeof diagnostic.progress === 'object' ? diagnostic.progress : {};
  const failedItems = collectDiagnosticFailedItems(summary);
  const totalCount = firstFiniteDiagnosticNumber(summary.totalCount, progress.totalCount, progress.total);
  const summarySuccessCount = firstFiniteDiagnosticNumber(summary.successCount);
  const summaryFailedCount = firstFiniteDiagnosticNumber(
    summary.failureCount,
    summary.errorCount,
    failedItems.length > 0 ? failedItems.length : null,
  );
  const completedCount = firstFiniteDiagnosticNumber(progress.successCount, progress.completed);
  const progressFailedCount = firstFiniteDiagnosticNumber(progress.failureCount, progress.errorCount);
  const percent = firstFiniteDiagnosticNumber(progress.overallPercent);
  let progressText = '未记录';
  if (summarySuccessCount !== null || summaryFailedCount !== null) {
    progressText = `总数 ${formatDiagnosticNumber(totalCount)}，成功 ${formatDiagnosticNumber(summarySuccessCount)}，失败 ${formatDiagnosticNumber(summaryFailedCount || 0)}`;
  } else if (totalCount !== null || completedCount !== null || progressFailedCount !== null) {
    progressText = `总数 ${formatDiagnosticNumber(totalCount)}，已完成 ${formatDiagnosticNumber(completedCount)}，失败 ${formatDiagnosticNumber(progressFailedCount || 0)}`;
  }

  return {
    id: String(diagnostic.id || ''),
    title: diagnosticStatusLabel(diagnostic.status),
    status: String(diagnostic.status || ''),
    failureType: diagnosticFailureTypeLabel(diagnostic.failureType),
    taskLabel: diagnosticTaskLabel(diagnostic.tasks || {}),
    phase: String(progress.phaseLabel || progress.phase || '未记录'),
    progressText,
    percentText: percent !== null ? `${Math.max(0, Math.min(100, Math.round(percent)))}%` : '',
    detailId: String(progress.detailId || ''),
    account: diagnostic.account && diagnostic.account.label ? String(diagnostic.account.label) : '未记录',
    startedAt: formatDiagnosticDate(diagnostic.startedAt),
    endedAt: formatDiagnosticDate(diagnostic.endedAt),
    generatedAt: formatDiagnosticDate(diagnostic.generatedAt),
    duration: formatDiagnosticDuration(diagnostic.durationMs),
    error: String(diagnostic.error || diagnostic.stderrTail || '没有记录到明确错误。'),
    failedItems: failedItems.slice(0, 20),
    failedItemOverflow: Math.max(0, failedItems.length - 20),
    logs: buildDiagnosticLogRows(diagnostic.logs),
    artifacts: collectDiagnosticArtifacts(diagnostic.artifacts),
    rawJson: JSON.stringify(diagnostic, null, 2),
  };
}

function renderDiagnosticMetric(label, value) {
  return `<div class="metric-card">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  </div>`;
}

function renderDiagnosticFailedItems(view) {
  if (view.failedItems.length === 0) {
    return `<section class="panel">
      <h2>失败项</h2>
      <p class="muted">没有记录到具体失败项。</p>
    </section>`;
  }

  const rows = view.failedItems.map((item) => `<tr>
    <td>${escapeHtml(item.group || '任务')}</td>
    <td>${escapeHtml(item.title)}</td>
    <td>${escapeHtml(item.detail || '-')}</td>
    <td>${escapeHtml(item.error)}</td>
  </tr>`).join('');
  const overflow = view.failedItemOverflow > 0
    ? `<p class="muted">还有 ${escapeHtml(view.failedItemOverflow)} 个失败项，请在原始诊断数据中查看。</p>`
    : '';

  return `<section class="panel">
    <h2>失败项</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>类型</th>
            <th>对象</th>
            <th>ID</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${overflow}
  </section>`;
}

function renderDiagnosticLogs(logs = []) {
  if (logs.length === 0) {
    return `<section class="panel">
      <h2>关键日志</h2>
      <p class="muted">没有记录到关键日志。</p>
    </section>`;
  }
  const rows = logs.map((entry) => `<li>
    <span>${escapeHtml(entry.time)}</span>
    <strong>${escapeHtml(entry.stream)}</strong>
    <p>${escapeHtml(entry.text)}</p>
  </li>`).join('');
  return `<section class="panel">
    <h2>关键日志</h2>
    <ol class="log-list">${rows}</ol>
  </section>`;
}

function renderDiagnosticArtifacts(artifacts = []) {
  if (artifacts.length === 0) {
    return `<section class="panel">
      <h2>页面截图</h2>
      <p class="muted">没有保存页面截图或证据文件。</p>
    </section>`;
  }

  const cards = artifacts.map((artifact) => {
    const image = artifact.screenshot
      ? `<a class="screenshot" href="${escapeHtml(artifact.screenshot.url)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(artifact.screenshot.url)}" alt="诊断截图 ${escapeHtml(artifact.index)}">
        </a>`
      : '<div class="screenshot empty">无截图</div>';
    const links = artifact.links.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener">${escapeHtml(file.name)}</a>`).join('');
    return `<article class="artifact-card">
      ${image}
      <div>
        <h3>${escapeHtml(artifact.stage)}</h3>
        ${artifact.title ? `<p>${escapeHtml(artifact.title)}</p>` : ''}
        <div class="artifact-links">${links}</div>
      </div>
    </article>`;
  }).join('');

  return `<section class="panel">
    <h2>页面截图</h2>
    <div class="artifact-grid">${cards}</div>
  </section>`;
}

function renderDiagnosticPage(diagnostic = {}) {
  const view = buildDiagnosticViewModel(diagnostic);
  const rawUrl = view.id ? `/api/diagnostics/${encodeURIComponent(view.id)}?format=json` : '';
  const detailText = view.detailId ? `当前对象：${view.detailId}` : '当前对象未记录';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>诊断摘要</title>
  <style>
    :root {
      color: #1f2937;
      background: #f3f6ff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 32px;
      background: #f3f6ff;
    }
    .shell {
      width: min(1180px, 100%);
      margin: 0 auto;
    }
    .page-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    .page-header p {
      margin: 0 0 8px;
      color: #64748b;
      font-weight: 700;
    }
    h1, h2, h3, p {
      margin-top: 0;
    }
    h1 {
      margin-bottom: 0;
      font-size: 32px;
      line-height: 1.2;
    }
    h2 {
      margin-bottom: 16px;
      font-size: 20px;
    }
    h3 {
      margin-bottom: 8px;
      font-size: 16px;
    }
    a {
      color: #1677ff;
      text-decoration: none;
      font-weight: 700;
    }
    .raw-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 18px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      background: #fff;
      white-space: nowrap;
    }
    .alert, .panel, .metric-card {
      border: 1px solid #d7e3f8;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 8px 24px rgba(31, 41, 55, 0.05);
    }
    .alert {
      margin-bottom: 16px;
      padding: 18px 20px;
      border-color: #fecaca;
      background: #fff7f7;
    }
    .alert strong {
      display: block;
      margin-bottom: 8px;
      color: #b42318;
      font-size: 18px;
    }
    .alert p {
      margin-bottom: 0;
      color: #7f1d1d;
      line-height: 1.7;
      white-space: pre-wrap;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric-card {
      min-height: 92px;
      padding: 16px;
    }
    .metric-card span {
      display: block;
      margin-bottom: 10px;
      color: #64748b;
      font-size: 13px;
      font-weight: 700;
    }
    .metric-card strong {
      color: #0f172a;
      font-size: 20px;
      line-height: 1.35;
      word-break: break-word;
    }
    .panel {
      margin-bottom: 16px;
      padding: 20px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .meta-item {
      padding: 14px;
      border-radius: 8px;
      background: #f8fafc;
    }
    .meta-item span {
      display: block;
      margin-bottom: 8px;
      color: #64748b;
      font-size: 13px;
      font-weight: 700;
    }
    .meta-item strong {
      word-break: break-word;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f8fafc;
      color: #334155;
      font-size: 13px;
    }
    td {
      line-height: 1.55;
      word-break: break-word;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .muted {
      margin-bottom: 0;
      color: #64748b;
    }
    .log-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .log-list li {
      display: grid;
      grid-template-columns: 170px 82px minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f8fafc;
    }
    .log-list span {
      color: #64748b;
      font-size: 13px;
    }
    .log-list strong {
      color: #1677ff;
      font-size: 13px;
    }
    .log-list p {
      margin: 0;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .artifact-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .artifact-card {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 14px;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f8fafc;
    }
    .screenshot {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
    }
    .screenshot img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .screenshot.empty {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
    }
    .artifact-card p {
      color: #64748b;
      line-height: 1.5;
      word-break: break-all;
    }
    .artifact-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    details summary {
      cursor: pointer;
      color: #1677ff;
      font-weight: 800;
    }
    pre {
      overflow: auto;
      max-height: 520px;
      margin-bottom: 0;
      padding: 14px;
      border-radius: 8px;
      background: #0f172a;
      color: #dbeafe;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @media (max-width: 900px) {
      body {
        padding: 18px;
      }
      .page-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .metric-grid,
      .meta-grid,
      .artifact-grid {
        grid-template-columns: 1fr;
      }
      .artifact-card,
      .log-list li {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="page-header">
      <div>
        <p>诊断摘要</p>
        <h1>${escapeHtml(view.title)}</h1>
      </div>
      ${rawUrl ? `<a class="raw-link" href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener">查看原始数据</a>` : ''}
    </header>

    <section class="alert">
      <strong>${escapeHtml(view.failureType)}</strong>
      <p>${escapeHtml(view.error)}</p>
    </section>

    <section class="metric-grid">
      ${renderDiagnosticMetric('任务类型', view.taskLabel)}
      ${renderDiagnosticMetric('当前阶段', view.phase)}
      ${renderDiagnosticMetric('处理进度', view.percentText ? `${view.progressText}（${view.percentText}）` : view.progressText)}
      ${renderDiagnosticMetric('耗时', view.duration)}
    </section>

    <section class="panel">
      <h2>基本信息</h2>
      <div class="meta-grid">
        <div class="meta-item"><span>当前账号</span><strong>${escapeHtml(view.account)}</strong></div>
        <div class="meta-item"><span>当前对象</span><strong>${escapeHtml(detailText)}</strong></div>
        <div class="meta-item"><span>诊断生成时间</span><strong>${escapeHtml(view.generatedAt)}</strong></div>
        <div class="meta-item"><span>开始时间</span><strong>${escapeHtml(view.startedAt)}</strong></div>
        <div class="meta-item"><span>结束时间</span><strong>${escapeHtml(view.endedAt)}</strong></div>
        <div class="meta-item"><span>诊断 ID</span><strong>${escapeHtml(view.id || '未记录')}</strong></div>
      </div>
    </section>

    ${renderDiagnosticFailedItems(view)}
    ${renderDiagnosticLogs(view.logs)}
    ${renderDiagnosticArtifacts(view.artifacts)}

    <section class="panel">
      <details>
        <summary>原始诊断数据</summary>
        <pre>${escapeHtml(view.rawJson)}</pre>
      </details>
    </section>
  </main>
</body>
</html>`;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === 'GET' && url.pathname === '/') {
    sendHtml(response, renderPage());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/favicon.ico') {
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    return;
  }

  if (request.method === 'GET' && STATIC_ASSET_MAP.has(url.pathname)) {
    sendStaticAsset(response, STATIC_ASSET_MAP.get(url.pathname));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/captcha/image/')) {
    const imageFile = decodeURIComponent(url.pathname.slice('/api/captcha/image/'.length));
    const filePath = captchaImagePath(imageFile);
    if (!filePath || !fs.existsSync(filePath)) {
      sendJson(response, 404, { error: '验证码图片不存在。' });
      return;
    }
    sendBinary(response, 200, fs.readFileSync(filePath), 'image/png');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, {
      capabilities: buildServerCapabilities(),
      currentRun: serializeRun(currentRun),
      history,
      queue: serializeQueue(taskQueue),
      queuePaused: taskQueuePaused,
      stats: buildRunStats(history),
    });
    return;
  }

  const artifactMatch = url.pathname.match(/^\/api\/diagnostics\/([^/]+)\/artifacts\/([^/]+)$/);
  if (request.method === 'GET' && artifactMatch) {
    const diagnosticId = decodeURIComponent(artifactMatch[1]);
    const fileName = decodeURIComponent(artifactMatch[2]);
    const filePath = artifactFilePath(diagnosticId, fileName);
    if (!filePath || !fs.existsSync(filePath)) {
      sendJson(response, 404, { error: '诊断证据文件不存在。' });
      return;
    }
    sendBinary(response, 200, fs.readFileSync(filePath), contentTypeForAsset(filePath));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/diagnostics/')) {
    const diagnosticId = decodeURIComponent(url.pathname.slice('/api/diagnostics/'.length));
    const diagnostic = loadRunDiagnostic(diagnosticId);
    if (!diagnostic) {
      sendJson(response, 404, { error: '诊断包不存在。' });
      return;
    }
    if (url.searchParams.get('format') === 'json') {
      sendJson(response, 200, { diagnostic });
      return;
    }
    sendHtml(response, renderDiagnosticPage(diagnostic));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/config') {
    const includeLocalEnv = /^(?:1|true|yes)$/i.test(String(url.searchParams.get('useLocalEnv') || ''));
    sendJson(response, 200, {
      config: getProjectConfig({ includeLocalEnv }),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/accounts') {
    const accounts = readMiaoshouAccounts();
    const defaultAccount = getDefaultMiaoshouAccount(accounts);
    sendJson(response, 200, {
      accounts: accounts.map(serializeMiaoshouAccount),
      defaultAccountId: defaultAccount ? defaultAccount.id : '',
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/config') {
    try {
      const body = await readRequestJson(request);
      const updates = normalizeProjectConfig(body);
      updateEnvFile(updates);
      sendJson(response, 200, {
        config: getProjectConfig({ includeLocalEnv: Boolean(body && body.useLocalEnv) }),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run') {
    try {
      if (isRunActive(currentRun)) {
        sendJson(response, 409, { error: '当前已有任务正在运行。' });
        return;
      }

      const body = await readRequestJson(request);
      const options = normalizeRunOptions(body);
      const run = startRun(options);
      sendJson(response, 202, { run: serializeRun(run) });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run/enqueue') {
    try {
      const body = await readRequestJson(request);
      const item = enqueueRunInput(body);
      sendJson(response, 202, {
        queued: item ? item.id : '',
        queue: serializeQueue(taskQueue),
        currentRun: serializeRun(currentRun),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/queue/remove') {
    try {
      const body = await readRequestJson(request);
      const result = removeQueuedRun(taskQueue, body.id);
      if (!result.removed) {
        sendJson(response, 404, { error: '未找到排队任务。' });
        return;
      }
      taskQueue.splice(0, taskQueue.length, ...result.queue);
      persistTaskQueue();
      sendJson(response, 200, {
        removed: result.removed.id,
        queue: serializeQueue(taskQueue),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/queue/move') {
    try {
      const body = await readRequestJson(request);
      const result = moveQueuedRun(taskQueue, body.id, body.direction);
      if (!result.moved) {
        sendJson(response, 400, { error: '这个排队任务不能移动。' });
        return;
      }
      taskQueue.splice(0, taskQueue.length, ...result.queue);
      persistTaskQueue();
      sendJson(response, 200, {
        moved: result.moved.id,
        queue: serializeQueue(taskQueue),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/queue/start') {
    try {
      if (taskQueue.length === 0 && !isRunActive(currentRun)) {
        taskQueuePaused = true;
        persistTaskQueue();
        sendJson(response, 200, {
          started: false,
          queuePaused: taskQueuePaused,
          queue: serializeQueue(taskQueue),
          currentRun: serializeRun(currentRun),
        });
        return;
      }
      taskQueuePaused = false;
      persistTaskQueue();
      const run = runNextQueuedRunNow();
      sendJson(response, 200, {
        started: Boolean(run && run.status === 'running'),
        queuePaused: taskQueuePaused,
        queue: serializeQueue(taskQueue),
        currentRun: serializeRun(currentRun),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/queue/pause') {
    try {
      const body = await readRequestJson(request);
      taskQueuePaused = Boolean(body.paused);
      persistTaskQueue();
      if (!taskQueuePaused) {
        scheduleNextQueuedRun();
      }
      sendJson(response, 200, {
        queuePaused: taskQueuePaused,
        queue: serializeQueue(taskQueue),
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/queue/clear') {
    taskQueue.splice(0, taskQueue.length);
    taskQueuePaused = true;
    clearRunQueueStore();
    sendJson(response, 200, { queue: serializeQueue(taskQueue), queuePaused: taskQueuePaused });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run/precheck') {
    try {
      const body = await readRequestJson(request);
      const options = normalizeRunOptions(body);
      const result = buildRunPrecheck({ options, account: options.account });
      sendJson(response, 200, { precheck: result });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run/resume') {
    try {
      if (isRunActive(currentRun)) {
        sendJson(response, 409, { error: '当前已有任务正在运行。' });
        return;
      }

      const body = await readRequestJson(request);
      const runId = String(body.id || body.runId || '').trim();
      const sourceRun = history.find((item) => item && item.id === runId);
      if (!sourceRun) {
        sendJson(response, 404, { error: '没有找到可续跑的历史任务。' });
        return;
      }

      const diagnostic = loadRunDiagnostic(runId);
      const resumeSourceRun = diagnostic && Array.isArray(diagnostic.logs)
        ? { ...sourceRun, logs: diagnostic.logs }
        : sourceRun;
      const resumeInput = buildResumeRunInput(resumeSourceRun);
      const options = normalizeRunOptions(resumeInput);
      const run = startRun(options);
      appendLog(run, 'system', `从历史任务 ${runId} 续跑。`);
      sendJson(response, 202, { run: serializeRun(run), resumeInput });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run/retry-failed') {
    try {
      if (isRunActive(currentRun)) {
        sendJson(response, 409, { error: '当前已有任务正在运行。' });
        return;
      }

      const body = await readRequestJson(request);
      const runId = String(body.id || body.runId || '').trim();
      const sourceRun = history.find((item) => item && item.id === runId);
      if (!sourceRun) {
        sendJson(response, 404, { error: '没有找到可重跑的历史任务。' });
        return;
      }

      const retryInput = buildFailedItemRetryInput(sourceRun);
      const options = normalizeRunOptions(retryInput);
      const run = startRun(options);
      appendLog(run, 'system', `从历史任务 ${runId} 重跑失败项。`);
      sendJson(response, 202, { run: serializeRun(run), retryInput });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/stop') {
    sendJson(response, 200, { stopped: stopCurrentRun() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/captcha') {
    try {
      const body = await readRequestJson(request);
      const run = submitCaptchaCode(body);
      sendJson(response, 200, { run: serializeRun(run) });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/logs/clear') {
    sendJson(response, 200, {
      capabilities: buildServerCapabilities(),
      cleared: clearCurrentRunLogs(),
      currentRun: serializeRun(currentRun),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/history/clear') {
    sendJson(response, 200, {
      cleared: clearRunHistory(),
      history,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/flash-progress') {
    try {
      const body = await readRequestJson(request);
      const run = updateManualFlashRun(body);
      sendJson(response, 200, { run: serializeRun(run) });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, { error: error.message || String(error) });
  });
});

server.listen(PORT, HOST, () => {
  const browserUrl = getBrowserOpenUrl(HOST, PORT);
  if (HOST === '0.0.0.0' || HOST === '::') {
    console.log(`Miaoshou Auto UI: ${browserUrl}`);
    console.log(`Bind address: http://${HOST}:${PORT}`);
    const lanUrls = getLanUrls(PORT);
    if (lanUrls.length > 0) {
      console.log('LAN URLs:');
      for (const url of lanUrls) {
        console.log(`  ${url}`);
      }
    }
  } else {
    console.log(`Miaoshou Auto UI: ${browserUrl}`);
  }
  openBrowserForServer(browserUrl);
});
