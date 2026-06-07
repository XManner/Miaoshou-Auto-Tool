const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createHash, randomUUID } = require('crypto');

const ENV_PATH = path.join(__dirname, '.env');

function parseEnvValue(rawValue) {
  const value = String(rawValue || '').trim();
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }

  return value;
}

function loadDotEnv(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const HOST = process.env.WEB_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.WEB_PORT || '3000', 10);
const SCRIPT_PATH = path.join(__dirname, 'miaoshou_auto.js');
const FLASH_SCRIPT_PATH = path.join(__dirname, 'miaoshou_flash_sale.js');
const COLLECT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_1688_collect.js');
const CAPTCHA_DIR = path.join(__dirname, '.captcha');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_LOG_LINES = 2000;
const MAX_HISTORY_ITEMS = 20;
const PROCESSING_MODE_FAST = 'fast';
const PROCESSING_MODE_PRECISE = 'precise';
const ITEM_SELECTION_MODE_RANGE = 'range';
const ITEM_SELECTION_MODE_ALL = 'all';
const FLASH_SELECTION_MODE_COUNT = 'count';
const FLASH_SELECTION_MODE_ALL = 'all';
const COLLECT_TASK_DEFAULT_KEYWORDS = '';
const COLLECT_TASK_DEFAULT_PREFERRED_TERMS = '';
const COLLECT_TASK_DEFAULT_EXCLUDED_TERMS = '';
const COLLECT_SOURCE_1688 = '1688';
const COLLECT_SOURCE_SHOPEE = 'shopee';
const SHOPEE_SITE_CODES = new Set(['my', 'ph', 'th']);
const MAX_EDIT_ITEM_INDEX = 500;
const MAX_SOURCE_PRICE_EXTRA_CNY = 1000;
const MAX_COLLECT_COUNT = 100;
const MAX_COLLECT_PRICE_CNY = 10000;
const MIAOSHOU_ACCOUNT_SLOT_LIMIT = 10;
const DEFAULT_WEIGHT_PADDING_GRAMS = (() => {
  const parsed = Number.parseFloat(process.env.SKU_WEIGHT_PADDING_GRAMS || '30');
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(1)) : 30;
})();
const MAX_WEIGHT_PADDING_GRAMS = 5000;
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

const AI_PROVIDER_OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'kimi', label: 'Kimi' },
];

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

// Keep model choices in sync with the providers' official model pages.
const DEEPSEEK_MODEL_OPTIONS = [
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
];

const KIMI_MODEL_OPTIONS = [
  { value: 'kimi-k2.6', label: 'kimi-k2.6' },
  { value: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
  { value: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
  { value: 'moonshot-v1-128k', label: 'moonshot-v1-128k' },
];

const TEXT_FUNCTION_MODEL_OPTIONS = [
  ...DEEPSEEK_MODEL_OPTIONS.map((item) => ({ ...item, label: `DeepSeek ${item.label}` })),
  ...KIMI_MODEL_OPTIONS.map((item) => ({ ...item, label: `Kimi ${item.label}` })),
];

const MIMO_MODEL_OPTIONS = [
  { value: 'mimo-v2.5-pro', label: 'mimo-v2.5-pro' },
  { value: 'mimo-v2.5', label: 'mimo-v2.5' },
  { value: 'mimo-v2-pro', label: 'mimo-v2-pro' },
  { value: 'mimo-v2-omni', label: 'mimo-v2-omni' },
];

const MIMO_IMAGE_MODEL_OPTIONS = [
  { value: 'mimo-v2.5', label: 'mimo-v2.5' },
  { value: 'mimo-v2-omni', label: 'mimo-v2-omni' },
];

TEXT_FUNCTION_MODEL_OPTIONS.push(
  ...MIMO_MODEL_OPTIONS.map((item) => ({ ...item, label: `MiMo ${item.label}` })),
);

const VISION_FUNCTION_MODEL_OPTIONS = [
  ...KIMI_MODEL_OPTIONS.map((item) => ({ ...item, label: `Kimi ${item.label}` })),
  ...MIMO_IMAGE_MODEL_OPTIONS.map((item) => ({ ...item, label: `MiMo ${item.label}` })),
];

const AI_USAGE_SUMMARY = [
  {
    feature: '商品标题优化',
    service: '商品标题优化模型',
    modelKey: 'TITLE_OPTIMIZE_MODEL',
    description: '文字任务，可选择 DeepSeek、Kimi 或 MiMo，把中文标题翻译并优化为适合 TikTok Shop 的英文标题。',
  },
  {
    feature: '文案翻译 / SKU 属性翻译',
    service: '文案翻译 / SKU 属性翻译模型',
    modelKey: 'SKU_TRANSLATION_MODEL',
    description: '文字任务，可选择 DeepSeek、Kimi 或 MiMo；本地词库无法处理的规格名和值会交给所选模型翻译成英文。',
  },
  {
    feature: '图片审核：快速模式',
    service: '本地规则',
    description: '不调用 AI，使用本地规则过滤供应商广告、声明图、工厂图和无关图片。',
  },
  {
    feature: '图片审核：精细模式',
    service: '图片审核模型',
    modelKey: 'IMAGE_AUDIT_MODEL',
    description: '图片任务，可选择 Kimi 或 MiMo；DeepSeek 只处理文字，不会出现在这里。',
  },
  {
    feature: '重量识别和估算',
    service: '重量识别和估算模型',
    modelKey: 'WEIGHT_ESTIMATION_MODEL',
    description: '图片任务，可选择 Kimi 或 MiMo；优先识别包装净含量/重量，没有可见重量时再估算基础重量。',
  },
];

const PROJECT_CONFIG_SCHEMA = [
  {
    key: 'miaoshou',
    title: '妙手 ERP',
    description: '用于采集箱商品编辑、发布和秒杀活动处理。',
    fields: [
      { key: 'MIAOSHOU_MS_URL', label: '接口地址', type: 'url', placeholder: 'https://openapi-erp.91miaoshou.com' },
    ],
  },
  {
    key: 'ai',
    title: 'AI 模型服务',
    description: '配置各个 AI 大模型服务的版本、接口地址和 Key。',
    fields: [
      { key: 'AI_PROVIDER', label: '默认 AI 服务', type: 'select', options: AI_PROVIDER_OPTIONS, placeholder: '请选择默认 AI 服务' },
      { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key', type: 'password', secret: true, allowEmptyUpdate: true, placeholder: '留空则不修改' },
      { key: 'DEEPSEEK_BASE_URL', label: 'DeepSeek Base URL', type: 'url', placeholder: 'https://api.deepseek.com' },
      { key: 'DEEPSEEK_MODEL', label: 'DeepSeek 模型', type: 'select', options: DEEPSEEK_MODEL_OPTIONS, placeholder: '请选择 DeepSeek 模型' },
      { key: 'KIMI_API_KEY', label: 'Kimi API Key', type: 'password', secret: true, allowEmptyUpdate: true, placeholder: '留空则不修改' },
      { key: 'KIMI_MODEL', label: 'Kimi 模型', type: 'select', options: KIMI_MODEL_OPTIONS, placeholder: '请选择 Kimi 模型' },
      { key: 'MIMO_API_KEY', aliases: ['Mimo_API_KEY'], label: 'MiMo API Key', type: 'password', secret: true, allowEmptyUpdate: true, placeholder: '留空则不修改' },
      { key: 'MIMO_BASE_URL', aliases: ['Mimo_BASE_URL'], label: 'MiMo Base URL', type: 'url', placeholder: 'https://token-plan-cn.xiaomimimo.com/v1' },
      { key: 'MIMO_MODEL', aliases: ['Mimo_MODEL'], label: 'MiMo 模型', type: 'select', options: MIMO_MODEL_OPTIONS, placeholder: '请选择 MiMo 模型' },
      { key: 'MIMO_IMAGE_MODEL', aliases: ['Mimo_IMAGE_MODEL'], label: 'MiMo 图片模型', type: 'select', options: MIMO_IMAGE_MODEL_OPTIONS, placeholder: '请选择 MiMo 图片模型' },
    ],
  },
  {
    key: 'featureModels',
    title: '功能模型配置',
    description: '选择本地服务里的具体功能调用哪个大模型。',
    fields: [
      { key: 'TITLE_OPTIMIZE_MODEL', label: '商品标题优化模型', type: 'select', options: TEXT_FUNCTION_MODEL_OPTIONS, defaultValue: 'deepseek-v4-flash', placeholder: '不选则使用 DeepSeek 模型', help: '可选 DeepSeek、Kimi 或 MiMo。' },
      { key: 'SKU_TRANSLATION_MODEL', label: '文案翻译 / SKU 属性翻译模型', type: 'select', options: TEXT_FUNCTION_MODEL_OPTIONS, defaultValue: 'deepseek-v4-flash', placeholder: '不选则使用 DeepSeek 模型', help: '可选 DeepSeek、Kimi 或 MiMo。' },
      { key: 'IMAGE_AUDIT_MODEL', label: '图片审核模型', type: 'select', options: VISION_FUNCTION_MODEL_OPTIONS, defaultValue: 'mimo-v2.5', placeholder: '不选则使用 MiMo 图片模型', help: '可选 Kimi 或 MiMo，不提供 DeepSeek。' },
      { key: 'WEIGHT_ESTIMATION_MODEL', label: '重量识别和估算模型', type: 'select', options: VISION_FUNCTION_MODEL_OPTIONS, defaultValue: 'mimo-v2.5', placeholder: '不选则使用 MiMo 图片模型', help: '可选 Kimi 或 MiMo，不提供 DeepSeek。' },
    ],
  },
];

let currentRun = null;
const history = [];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
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

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return {};
  }

  const env = {};
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    if (key) {
      env[key] = value;
    }
  }

  return env;
}

function formatEnvValue(value) {
  const cleaned = String(value || '').replace(/[\r\n]/g, '').trim();
  if (!cleaned) {
    return '';
  }
  if (/[\s#"'\\]/.test(cleaned)) {
    return JSON.stringify(cleaned);
  }
  return cleaned;
}

function updateEnvFile(updates = {}) {
  const existing = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8')
    : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }

    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      return line;
    }

    seen.add(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });

  for (const key of Object.keys(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${formatEnvValue(updates[key])}`);
    }
  }

  fs.writeFileSync(ENV_PATH, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = String(value || '');
  }
}

function maskSecret(value = '') {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  if (text.length <= 8) {
    return '已设置';
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function maskIdentifier(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= 8) {
    return text;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function maskPhoneText(value = '') {
  return String(value || '').replace(/(^|[^\d])(1\d{2})\d{4}(\d{4})(?!\d)/g, '$1$2****$3');
}

function stripEnvComment(rawLine = '') {
  return String(rawLine || '').trim().replace(/^#+\s?/, '').trim();
}

function parseEnvAssignment(rawLine = '') {
  const trimmed = String(rawLine || '').trim();
  if (!trimmed) {
    return null;
  }

  const commented = trimmed.startsWith('#');
  const body = commented ? stripEnvComment(trimmed) : trimmed;
  const separatorIndex = body.indexOf('=');
  if (separatorIndex === -1) {
    return null;
  }

  const key = body.slice(0, separatorIndex).trim();
  const value = parseEnvValue(body.slice(separatorIndex + 1));
  return key ? { commented, key, value } : null;
}

function createStableAccountId(parts = []) {
  return createHash('sha1')
    .update(parts.map((part) => String(part || '')).join('|'))
    .digest('hex')
    .slice(0, 12);
}

function isLikelyMiaoshouAppId(value = '') {
  return /^ak_[A-Za-z0-9]+$/i.test(String(value || '').trim());
}

function isLikelyMiaoshouAppSecret(value = '') {
  return /^[a-f0-9]{32,}$/i.test(String(value || '').trim());
}

function parseMiaoshouPasswordComment(value = '') {
  const match = String(value || '').trim().match(/^密码\s*[:：]\s*(.+)$/);
  return match ? match[1].trim() : '';
}

function parseMiaoshouAccountEnvKey(key = '') {
  const match = String(key || '').trim().match(/^(MIAOSHOU_LOGIN_PHONE|MIAOSHOU_ACCOUNT|MIAOSHOU_LOGIN_PASSWORD|MIAOSHOU_PASSWORD|MIAOSHOU_APP_ID|MIAOSHOU_APP_SECRET|APP_ID|APP_SECRET)(?:_(\d+))?$/);
  if (!match) {
    return null;
  }

  const baseKey = match[1];
  const index = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (baseKey === 'MIAOSHOU_LOGIN_PHONE' || baseKey === 'MIAOSHOU_ACCOUNT') {
    return { field: 'loginPhone', index };
  }
  if (baseKey === 'MIAOSHOU_LOGIN_PASSWORD' || baseKey === 'MIAOSHOU_PASSWORD') {
    return { field: 'loginPassword', index };
  }
  if (baseKey === 'MIAOSHOU_APP_ID' || baseKey === 'APP_ID') {
    return { field: 'appId', index };
  }
  if (baseKey === 'MIAOSHOU_APP_SECRET' || baseKey === 'APP_SECRET') {
    return { field: 'appSecret', index };
  }
  return null;
}

function createMiaoshouAccountRecord(raw = {}, accounts = []) {
  const fallbackLabel = `妙手账号 ${accounts.length + 1}`;
  const loginPhone = String(raw.loginPhone || raw.label || '').trim();
  const label = loginPhone || fallbackLabel;
  const appId = String(raw.appId || '').trim();
  const appSecret = String(raw.appSecret || '').trim();
  const accountIndex = Number.isInteger(raw.index) && raw.index > 0 ? raw.index : accounts.length + 1;
  return {
    id: createStableAccountId([label, appId, accountIndex]),
    index: accountIndex,
    label,
    loginPhone,
    msUrl: raw.msUrl,
    appId,
    appSecret,
    loginPassword: String(raw.loginPassword || '').trim(),
    active: Boolean(raw.active),
    lineNumber: raw.lineNumber || 0,
    complete: Boolean(appId && appSecret),
  };
}

function accountDedupeKey(account = {}) {
  return [
    String(account.loginPhone || account.label || '').trim(),
    String(account.appId || '').trim(),
  ].join('|');
}

function readMiaoshouAccounts() {
  const env = readEnvFile();
  const msUrl = env.MIAOSHOU_MS_URL || env.MS_URL || 'https://openapi-erp.91miaoshou.com';
  if (!fs.existsSync(ENV_PATH)) {
    return [];
  }

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const selectedIndex = Number.parseInt(env.MIAOSHOU_ACTIVE_ACCOUNT_INDEX || '0', 10);
  const indexedGroups = new Map();
  lines.forEach((line, offset) => {
    const assignment = parseEnvAssignment(line);
    if (!assignment) {
      return;
    }
    const parsed = parseMiaoshouAccountEnvKey(assignment.key);
    if (!parsed || !parsed.index) {
      return;
    }
    const entry = indexedGroups.get(parsed.index) || {
      index: parsed.index,
      msUrl,
      active: false,
      lineNumber: offset + 1,
    };
    entry[parsed.field] = assignment.value;
    entry.active = entry.active || (!assignment.commented && selectedIndex === parsed.index);
    entry.lineNumber = Math.min(entry.lineNumber || offset + 1, offset + 1);
    indexedGroups.set(parsed.index, entry);
  });

  const groups = [];
  let currentGroup = [];

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  };

  for (const line of lines) {
    if (!String(line || '').trim()) {
      flushGroup();
      continue;
    }
    currentGroup.push(line);
  }
  flushGroup();

  const accounts = [];
  const seen = new Set();
  const addAccount = (raw) => {
    const account = createMiaoshouAccountRecord({ ...raw, msUrl }, accounts);
    const dedupeKey = accountDedupeKey(account);
    if (!account.appId && !account.appSecret && !account.loginPhone) {
      return;
    }
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    accounts.push(account);
  };

  Array.from(indexedGroups.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([, entry]) => {
      addAccount({
        ...entry,
        active: selectedIndex ? selectedIndex === entry.index : Boolean(entry.active),
      });
    });

  for (const group of groups) {
    let loginPhone = '';
    let appId = '';
    let appSecret = '';
    let loginPassword = '';
    let active = false;
    let lineNumber = 0;

    group.forEach((line, offset) => {
      const trimmed = String(line || '').trim();
      const body = trimmed.startsWith('#') ? stripEnvComment(trimmed) : trimmed;
      if (!loginPhone && /^\d{8,}$/.test(body)) {
        loginPhone = body;
      }

      if (!loginPassword) {
        loginPassword = parseMiaoshouPasswordComment(body);
      }

      const assignment = parseEnvAssignment(line);
      if (assignment) {
        if (assignment.key === 'MIAOSHOU_ACCOUNT' || assignment.key === 'MIAOSHOU_LOGIN_PHONE') {
          loginPhone = assignment.value;
          active = active || !assignment.commented;
          lineNumber = lineNumber || offset + 1;
        }
        if (assignment.key === 'MIAOSHOU_PASSWORD' || assignment.key === 'MIAOSHOU_LOGIN_PASSWORD') {
          loginPassword = assignment.value;
          active = active || !assignment.commented;
          lineNumber = lineNumber || offset + 1;
        }
        if (assignment.key === 'MIAOSHOU_APP_ID' || assignment.key === 'APP_ID') {
          appId = assignment.value;
          active = active || !assignment.commented;
          lineNumber = lineNumber || offset + 1;
        }
        if (assignment.key === 'MIAOSHOU_APP_SECRET' || assignment.key === 'APP_SECRET') {
          appSecret = assignment.value;
          active = active || !assignment.commented;
          lineNumber = lineNumber || offset + 1;
        }
        return;
      }

      if (!appId && trimmed.startsWith('#') && isLikelyMiaoshouAppId(body)) {
        appId = body;
      }

      if (!appSecret && trimmed.startsWith('#') && isLikelyMiaoshouAppSecret(body)) {
        appSecret = body;
      }
    });

    if (!appId && !appSecret) {
      continue;
    }

    const envLoginPhone = env.MIAOSHOU_LOGIN_PHONE || env.MIAOSHOU_ACCOUNT || '';
    const envLoginPasswordValue = env.MIAOSHOU_LOGIN_PASSWORD || env.MIAOSHOU_PASSWORD || '';
    const envLoginPassword = loginPhone && loginPhone === envLoginPhone ? envLoginPasswordValue : '';
    addAccount({
      loginPhone,
      appId,
      appSecret,
      loginPassword: loginPassword || envLoginPassword,
      active,
      lineNumber,
    });
  }

  if (accounts.length === 0 && (env.MIAOSHOU_APP_ID || env.APP_ID || env.MIAOSHOU_APP_SECRET || env.APP_SECRET)) {
    const fallbackLoginPhone = env.MIAOSHOU_LOGIN_PHONE || env.MIAOSHOU_ACCOUNT || env.MIAOSHOU_ACCOUNT_LABEL || '';
    addAccount({
      index: 1,
      loginPhone: fallbackLoginPhone || '当前账号',
      appId: env.MIAOSHOU_APP_ID || env.APP_ID || '',
      appSecret: env.MIAOSHOU_APP_SECRET || env.APP_SECRET || '',
      loginPassword: env.MIAOSHOU_LOGIN_PASSWORD || env.MIAOSHOU_PASSWORD || '',
      active: true,
      lineNumber: 0,
    });
  }

  return accounts;
}

function serializeMiaoshouAccount(account) {
  if (!account) {
    return null;
  }

  return {
    id: account.id,
    index: account.index,
    label: maskPhoneText(account.label),
    msUrl: account.msUrl,
    hasAppId: Boolean(account.appId),
    hasAppSecret: Boolean(account.appSecret),
    hasLoginPassword: Boolean(account.loginPassword),
    active: Boolean(account.active),
    complete: Boolean(account.complete),
  };
}

function serializeProjectMiaoshouAccount(account, { includeLocalEnv = false } = {}) {
  if (!account) {
    return null;
  }

  return {
    id: account.id,
    index: account.index,
    label: maskPhoneText(account.label),
    loginPhone: includeLocalEnv ? account.loginPhone : '',
    loginPassword: includeLocalEnv ? account.loginPassword : '',
    appId: includeLocalEnv ? account.appId : '',
    appSecret: includeLocalEnv ? account.appSecret : '',
    hasLoginPhone: Boolean(account.loginPhone),
    hasLoginPassword: Boolean(account.loginPassword),
    hasAppId: Boolean(account.appId),
    hasAppSecret: Boolean(account.appSecret),
    complete: Boolean(account.complete),
    active: Boolean(account.active),
  };
}

function getDefaultMiaoshouAccount(accounts = readMiaoshouAccounts()) {
  return accounts.find((account) => account.active && account.complete)
    || accounts.find((account) => account.complete)
    || accounts[0]
    || null;
}

function findMiaoshouAccount(accountId = '') {
  const accounts = readMiaoshouAccounts();
  if (accountId) {
    const matched = accounts.find((account) => account.id === accountId);
    if (matched) {
      return matched;
    }
  }
  return getDefaultMiaoshouAccount(accounts);
}

function getMiaoshouConfig() {
  const env = readEnvFile();
  const appSecret = env.MIAOSHOU_APP_SECRET || env.APP_SECRET || env.MIAOSHOU_APP_SECRET_1 || '';
  const currentAccount = getDefaultMiaoshouAccount();
  return {
    msUrl: env.MIAOSHOU_MS_URL || env.MS_URL || 'https://openapi-erp.91miaoshou.com',
    appId: env.MIAOSHOU_APP_ID || env.APP_ID || env.MIAOSHOU_APP_ID_1 || '',
    hasAppSecret: Boolean(appSecret),
    appSecretPreview: maskSecret(appSecret),
    currentAccount: serializeMiaoshouAccount(currentAccount),
  };
}

function flattenProjectConfigFields() {
  return PROJECT_CONFIG_SCHEMA.flatMap((section) => (
    section.fields.map((field) => ({
      ...field,
      sectionKey: section.key,
      sectionTitle: section.title,
    }))
  ));
}

function normalizeProjectConfigValue(field, rawValue) {
  const value = String(rawValue || '').replace(/[\r\n]/g, '').trim();
  if (!value) {
    return '';
  }

  if (field.type === 'url') {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) {
        throw new Error('invalid protocol');
      }
      return url.toString().replace(/\/+$/, '');
    } catch (error) {
      throw new Error(`${field.label}格式不正确。`);
    }
  }

  if (field.type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${field.label}必须是非负数字。`);
    }
    return String(Math.floor(parsed));
  }

  if (field.key === 'DEFAULT_WORKFLOW_GROUP_SITES') {
    const sites = value
      .split(/[,\s，]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    return Array.from(new Set(sites)).join(',');
  }

  if (field.key === 'DEFAULT_WORKFLOW_SOURCE_SITE') {
    return value.toUpperCase();
  }

  return value;
}

function getProjectConfigEnvValue(env = {}, field = {}) {
  const keys = [field.key, ...(Array.isArray(field.aliases) ? field.aliases : [])].filter(Boolean);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key]) {
      return env[key];
    }
  }
  return '';
}

function serializeProjectConfigField(field, env, { includeLocalEnv = false } = {}) {
  const value = getProjectConfigEnvValue(env, field);
  const effectiveValue = value || field.defaultValue || '';
  const secret = Boolean(field.secret);
  return {
    key: field.key,
    label: field.label,
    type: field.type || 'text',
    placeholder: field.placeholder || '',
    options: Array.isArray(field.options) ? field.options : [],
    secret,
    value: includeLocalEnv ? effectiveValue : '',
    hasValue: Boolean(value),
    masked: maskSecret(value),
  };
}

function normalizeMiaoshouAccountRows(rows = [], selectedIndex = 0) {
  const existingAccounts = readMiaoshouAccounts();
  const existingById = new Map(existingAccounts.map((account) => [account.id, account]));
  const normalizedRows = [];

  rows.slice(0, MIAOSHOU_ACCOUNT_SLOT_LIMIT).forEach((row, index) => {
    const source = row && typeof row === 'object' ? row : {};
    const existing = (source.id && existingById.get(source.id)) || existingAccounts[index] || {};
    const loginPhone = String(source.loginPhone || existing.loginPhone || existing.label || '').trim();
    const loginPassword = String(source.loginPassword || existing.loginPassword || '').trim();
    const appId = String(source.appId || existing.appId || '').trim();
    const appSecret = String(source.appSecret || existing.appSecret || '').trim();
    const hasAnyValue = Boolean(loginPhone || loginPassword || appId || appSecret);
    if (!hasAnyValue) {
      return;
    }
    if (!loginPhone) {
      throw new Error(`妙手账号 ${index + 1} 缺少登录手机号/账号。`);
    }
    if (!appId) {
      throw new Error(`妙手账号 ${index + 1} 缺少 App ID。`);
    }
    if (!appSecret) {
      throw new Error(`妙手账号 ${index + 1} 缺少 App Secret。`);
    }
    normalizedRows.push({
      loginPhone,
      loginPassword,
      appId,
      appSecret,
    });
  });

  if (normalizedRows.length === 0) {
    throw new Error('请至少保留一个完整的妙手账号。');
  }

  const selected = Math.max(0, Math.min(normalizedRows.length - 1, Number.parseInt(selectedIndex, 10) || 0));
  const selectedAccount = normalizedRows[selected];
  const updates = {
    MIAOSHOU_ACTIVE_ACCOUNT_INDEX: String(selected + 1),
    MIAOSHOU_ACCOUNT: selectedAccount.loginPhone,
    MIAOSHOU_LOGIN_PHONE: selectedAccount.loginPhone,
    MIAOSHOU_PASSWORD: selectedAccount.loginPassword,
    MIAOSHOU_LOGIN_PASSWORD: selectedAccount.loginPassword,
    MIAOSHOU_APP_ID: selectedAccount.appId,
    MIAOSHOU_APP_SECRET: selectedAccount.appSecret,
  };

  for (let index = 0; index < MIAOSHOU_ACCOUNT_SLOT_LIMIT; index += 1) {
    const account = normalizedRows[index] || {};
    const slot = index + 1;
    updates[`MIAOSHOU_ACCOUNT_${slot}`] = account.loginPhone || '';
    updates[`MIAOSHOU_PASSWORD_${slot}`] = account.loginPassword || '';
    updates[`MIAOSHOU_APP_ID_${slot}`] = account.appId || '';
    updates[`MIAOSHOU_APP_SECRET_${slot}`] = account.appSecret || '';
  }

  return updates;
}

function getProjectConfig({ includeLocalEnv = false } = {}) {
  const env = readEnvFile();
  const miaoshouAccounts = readMiaoshouAccounts();
  const selectedMiaoshouAccountIndex = Math.max(0, miaoshouAccounts.findIndex((account) => account.active));
  return {
    envPath: ENV_PATH,
    includeLocalEnv,
    aiUsage: AI_USAGE_SUMMARY,
    sections: PROJECT_CONFIG_SCHEMA.map((section) => ({
      key: section.key,
      title: section.title,
      description: section.description,
      fields: section.fields.map((field) => serializeProjectConfigField(field, env, { includeLocalEnv })),
    })),
    miaoshou: getMiaoshouConfig(),
    miaoshouAccounts: miaoshouAccounts.map((account) => serializeProjectMiaoshouAccount(account, { includeLocalEnv })),
    selectedMiaoshouAccountIndex,
  };
}

function normalizeProjectConfig(input = {}) {
  const source = input.values && typeof input.values === 'object' ? input.values : input;
  const updates = {};

  for (const field of flattenProjectConfigFields()) {
    if (!Object.prototype.hasOwnProperty.call(source, field.key)) {
      continue;
    }

    const normalized = normalizeProjectConfigValue(field, source[field.key]);
    updates[field.key] = normalized;
    if (!normalized) {
      delete updates[field.key];
      continue;
    }
  }

  if (input.manageMiaoshouAccounts) {
    Object.assign(
      updates,
      normalizeMiaoshouAccountRows(input.miaoshouAccounts, input.selectedMiaoshouAccountIndex),
    );
  }

  return updates;
}

function buildChildProcessEnv(account = null, extraEnv = {}) {
  const envFromFile = readEnvFile();
  const nextEnv = {
    ...process.env,
    ...envFromFile,
    MIAOSHOU_PROGRESS: '1',
  };

  if (account) {
    nextEnv.MIAOSHOU_MS_URL = account.msUrl || nextEnv.MIAOSHOU_MS_URL;
    nextEnv.MIAOSHOU_APP_ID = account.appId || nextEnv.MIAOSHOU_APP_ID;
    nextEnv.MIAOSHOU_APP_SECRET = account.appSecret || nextEnv.MIAOSHOU_APP_SECRET;
    nextEnv.MIAOSHOU_ACCOUNT_ID = account.id || '';
    nextEnv.MIAOSHOU_ACCOUNT_LABEL = account.label || '';
    nextEnv.MIAOSHOU_LOGIN_PHONE = account.loginPhone || account.label || nextEnv.MIAOSHOU_LOGIN_PHONE || nextEnv.MIAOSHOU_ACCOUNT || '';
    nextEnv.MIAOSHOU_LOGIN_PASSWORD = account.loginPassword || nextEnv.MIAOSHOU_LOGIN_PASSWORD || nextEnv.MIAOSHOU_PASSWORD || '';
  }

  return {
    ...nextEnv,
    ...extraEnv,
  };
}

function normalizeMiaoshouConfig(input = {}) {
  const updates = {};
  const msUrl = String(input.msUrl || '').trim();
  const appId = String(input.appId || '').trim();
  const appSecret = String(input.appSecret || '').trim();

  if (msUrl) {
    try {
      const url = new URL(msUrl);
      if (!/^https?:$/.test(url.protocol)) {
        throw new Error('接口地址必须是 http 或 https。');
      }
      updates.MIAOSHOU_MS_URL = url.toString().replace(/\/+$/, '');
    } catch (error) {
      throw new Error('妙手接口地址格式不正确。');
    }
  }

  if (!appId) {
    throw new Error('App ID 不能为空。');
  }
  updates.MIAOSHOU_APP_ID = appId;

  if (appSecret) {
    updates.MIAOSHOU_APP_SECRET = appSecret;
  }

  return updates;
}

function normalizeRunOptions(input = {}) {
  const rawTasks = input.tasks && typeof input.tasks === 'object' ? input.tasks : {};
  const collectRequested = Boolean(rawTasks.collect);
  const tasks = {
    collect: Boolean(rawTasks.collect),
    edit: collectRequested ? Boolean(rawTasks.edit) : rawTasks.edit !== false,
    flash: Boolean(rawTasks.flash),
  };

  if (!tasks.collect && !tasks.edit && !tasks.flash) {
    throw new Error('请至少选择一个要执行的任务。');
  }
  if (tasks.collect && (tasks.edit || tasks.flash)) {
    throw new Error('商品采集任务需要单独执行。');
  }

  const account = findMiaoshouAccount(String(input.accountId || '').trim());
  if (!account) {
    throw new Error('没有找到可用的妙手账号配置。');
  }
  if (!account.appId || !account.appSecret) {
    throw new Error(`账号 ${maskPhoneText(account.label)} 缺少 App ID 或 App Secret。`);
  }

  if (tasks.collect) {
    return {
      ...normalizeCollectOptions(input),
      tasks,
      account,
    };
  }

  const itemRange = tasks.edit
    ? normalizeEditItemSelection(input)
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

  const flashSelectionMode = tasks.flash ? normalizeFlashSelectionMode(input.flashSelectionMode) : FLASH_SELECTION_MODE_COUNT;
  const flashCount = tasks.flash && flashSelectionMode === FLASH_SELECTION_MODE_COUNT
    ? Number.parseInt(input.flashCount, 10)
    : 0;
  if (tasks.flash && flashSelectionMode === FLASH_SELECTION_MODE_COUNT && (!Number.isFinite(flashCount) || flashCount < 1 || flashCount > 100)) {
    throw new Error('秒杀活动数量必须是 1 到 100 之间的整数。');
  }

  return {
    count: itemRange.count,
    itemSelectionMode: itemRange.itemSelectionMode,
    itemStartIndex: itemRange.itemStartIndex,
    itemEndIndex: itemRange.itemEndIndex,
    publish,
    processingMode,
    sourcePriceExtraCny,
    weightPaddingGrams,
    flashSelectionMode,
    flashCount,
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
  return normalized === COLLECT_SOURCE_SHOPEE ? COLLECT_SOURCE_SHOPEE : COLLECT_SOURCE_1688;
}

function normalizeShopeeSite(value = 'my') {
  const normalized = String(value || 'my').trim().toLowerCase();
  return SHOPEE_SITE_CODES.has(normalized) ? normalized : 'my';
}

function normalizeCollectOptions(input = {}) {
  const collectCount = normalizeCollectInteger(input.collectCount || input.count, 10, 1, MAX_COLLECT_COUNT, '采集数量');
  return {
    count: collectCount,
    collectCount,
    collectSource: normalizeCollectSource(input.collectSource || input.source),
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
    collectLinks: normalizeOptionalCollectText(input.collectLinks || input.links, '1688 详情链接'),
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

function normalizeProcessingMode(value = PROCESSING_MODE_FAST) {
  return String(value || '').trim() === PROCESSING_MODE_PRECISE
    ? PROCESSING_MODE_PRECISE
    : PROCESSING_MODE_FAST;
}

function normalizeFlashSelectionMode(value = FLASH_SELECTION_MODE_COUNT) {
  return String(value || '').trim() === FLASH_SELECTION_MODE_ALL
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
  if (normalizeItemSelectionMode(selection.itemSelectionMode) === ITEM_SELECTION_MODE_ALL) {
    return `全部商品（最多扫描 ${MAX_EDIT_ITEM_INDEX} 个）`;
  }

  const countText = Number(selection.count || 0) > 0 ? `，共 ${selection.count} 个` : '';
  return `${formatItemRangeText(selection.itemStartIndex, selection.itemEndIndex)}${countText}`;
}

function formatFlashSelectionText(selection = {}) {
  if (normalizeFlashSelectionMode(selection.flashSelectionMode) === FLASH_SELECTION_MODE_ALL) {
    return '全部进行中活动';
  }
  return `${selection.flashCount || 0} 个`;
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
  const detailText = progress.detailId ? `，当前商品 ${progress.detailId}` : '';

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
  ].join('|');
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

function updateRunProgress(run, event = {}) {
  const overallPercent = Number.isFinite(Number(event.overallPercent))
    ? Math.max(0, Math.min(100, Number(event.overallPercent)))
    : run.progress.overallPercent;
  const phase = event.phase || run.progress.phase || 'prepare';
  const completed = Number.isFinite(Number(event.completed)) ? Number(event.completed) : run.progress.completed;
  const total = Number.isFinite(Number(event.total)) ? Number(event.total) : run.progress.total;

  run.progress = {
    ...run.progress,
    phase,
    phaseLabel: getPhaseLabel(phase),
    completed,
    total,
    totalCount: Number.isFinite(Number(event.totalCount)) ? Number(event.totalCount) : run.progress.totalCount,
    detailId: event.detailId ? String(event.detailId) : run.progress.detailId,
    overallPercent,
    updatedAt: new Date().toISOString(),
  };

  if (event.captcha && event.captcha.id) {
    const imageFile = safeCaptchaName(event.captcha.imageFile || '');
    run.captcha = {
      id: String(event.captcha.id),
      status: 'waiting',
      accountLabel: event.captcha.accountLabel ? maskPhoneText(event.captcha.accountLabel) : '',
      message: event.captcha.message ? maskPhoneText(event.captcha.message) : '请输入验证码后继续。',
      imageUrl: imageFile ? `/api/captcha/image/${encodeURIComponent(imageFile)}?v=${Date.now()}` : '',
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
    params: parsed.params,
    results: parsed.results,
    failedItems: collectFailedResultItems(parsed.results),
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

function collectionSummaryHasTargetShortfall(summary) {
  if (!summary || !['1688-collection', 'shopee-collection'].includes(summary.mode)) {
    return false;
  }
  const requestedCount = Number(summary.requestedCount);
  const successCount = Number(summary.successCount);
  return Number.isFinite(requestedCount)
    && requestedCount > 0
    && (!Number.isFinite(successCount) || successCount < requestedCount);
}

function summaryHasErrors(summary) {
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
  const failedItems = Array.isArray(summary && summary.failedItems) ? summary.failedItems : [];
  if (failedItems.length > 0) {
    return failedItems[0].error || '任务结果包含失败项。';
  }

  if (collectionSummaryHasTargetShortfall(summary)) {
    const successCount = Number.isFinite(Number(summary.successCount)) ? Number(summary.successCount) : 0;
    const requestedCount = Number.isFinite(Number(summary.requestedCount)) ? Number(summary.requestedCount) : 0;
    return `商品采集未达到目标：已采集 ${successCount}/${requestedCount} 个。`;
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
    count: run.count,
    itemSelectionMode: run.itemSelectionMode || ITEM_SELECTION_MODE_RANGE,
    itemStartIndex: run.itemStartIndex || 0,
    itemEndIndex: run.itemEndIndex || 0,
    publish: run.publish,
    sourcePriceExtraCny: run.sourcePriceExtraCny || 0,
    weightPaddingGrams: run.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    processingMode: run.processingMode,
    flashCount: run.flashCount,
    flashSelectionMode: run.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    collectCount: run.collectCount,
    collectSource: run.collectSource,
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
    tasks: run.tasks,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    signal: run.signal,
    error: maskPhoneText(run.error),
    summary: run.summary,
    progress: run.progress,
    account: run.account,
    captcha: run.captcha || null,
    logs: run.logs,
  };
}

function isRunActive(run) {
  return run && run.status === 'running' && run.child && !run.child.killed;
}

function finalizeStoppedRun(run) {
  if (!run || !run.stopRequested) {
    return false;
  }

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
  history.unshift({
    id: run.id,
    status: run.status,
    command: run.command,
    count: run.count,
    itemSelectionMode: run.itemSelectionMode || ITEM_SELECTION_MODE_RANGE,
    itemStartIndex: run.itemStartIndex || 0,
    itemEndIndex: run.itemEndIndex || 0,
    publish: run.publish,
    sourcePriceExtraCny: run.sourcePriceExtraCny || 0,
    weightPaddingGrams: run.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    processingMode: run.processingMode,
    flashCount: run.flashCount,
    flashSelectionMode: run.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
    collectCount: run.collectCount,
    collectSource: run.collectSource,
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
    tasks: run.tasks,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    signal: run.signal,
    summary: run.summary,
    error: maskPhoneText(run.error),
    account: run.account,
  });

  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS);
  }
}

function startFlashOnlyRun(options) {
  ensureCaptchaDir();
  const accountSummary = serializeMiaoshouAccount(options.account);
  const flashArgs = options.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? ['--all'] : ['--count', String(options.flashCount)];
  const args = [
    FLASH_SCRIPT_PATH,
    ...flashArgs,
  ];
  const command = options.flashSelectionMode === FLASH_SELECTION_MODE_ALL
    ? 'node miaoshou_flash_sale.js --all'
    : `node miaoshou_flash_sale.js --count ${options.flashCount}`;
  const run = {
    id: randomUUID(),
    count: 0,
    publish: false,
    flashCount: options.flashCount,
    flashSelectionMode: options.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
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
  const command = `node miaoshou_1688_collect.js --source ${options.collectSource} --shopee-site ${options.collectShopeeSite} --shopee-max-price ${options.collectShopeeMaxPrice} --shopee-max-moq ${options.collectShopeeMaxMoq} --keywords ${JSON.stringify(options.collectKeywords)} --count ${options.collectCount} --max-price ${options.collectMaxPriceCny} --preferred-terms ${JSON.stringify(options.collectPreferredTerms)} --excluded-terms ${JSON.stringify(options.collectExcludedTerms)} --min-score ${options.collectMinScore} --safe-mode ${options.collectSafeMode} --skip-filters ${options.collectSkipFilters} --links ${JSON.stringify(options.collectLinks || '')}`;
  const run = {
    id: randomUUID(),
    count: options.collectCount,
    collectCount: options.collectCount,
    collectKeywords: options.collectKeywords,
    collectSource: options.collectSource,
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
  appendLog(run, 'system', `采集来源：${options.collectSource === COLLECT_SOURCE_SHOPEE ? `Shopee ${options.collectShopeeSite}` : '1688'}。`);
  appendLog(run, 'system', `采集关键词：${options.collectKeywords}`);
  if (options.collectLinks) {
    appendLog(run, 'system', '已提供 1688 详情链接，将优先按链接采集。');
  }
  appendLog(run, 'system', `计划采集 ${options.collectCount} 个，最高采购价 ${options.collectMaxPriceCny} 元，最低评分 ${options.collectMinScore}。`);
  if (options.collectSource === COLLECT_SOURCE_SHOPEE) {
    appendLog(run, 'system', `Shopee 最高展示价 ${options.collectShopeeMaxPrice}，1688 最大起批量 ${options.collectShopeeMaxMoq}。`);
  }
  appendLog(run, 'system', `安全模式：${options.collectSafeMode ? '开启' : '关闭'}。`);
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
  ];
  const itemSelectionMode = normalizeItemSelectionMode(options.itemSelectionMode);
  const command = `node miaoshou_auto.js --count ${options.count} --item-selection-mode ${itemSelectionMode} --item-start-index ${options.itemStartIndex || 1} --item-end-index ${options.itemEndIndex || options.count || 1} --publish ${options.publish ? 'true' : 'false'} --source-price-extra ${options.sourcePriceExtraCny || 0} --weight-padding-grams ${options.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS}`;
  const run = {
    id: randomUUID(),
    count: options.count,
    itemSelectionMode,
    itemStartIndex: itemSelectionMode === ITEM_SELECTION_MODE_ALL ? 0 : (options.itemStartIndex || 1),
    itemEndIndex: itemSelectionMode === ITEM_SELECTION_MODE_ALL ? 0 : (options.itemEndIndex || options.count || 1),
    publish: options.publish,
    sourcePriceExtraCny: options.sourcePriceExtraCny || 0,
    weightPaddingGrams: options.weightPaddingGrams ?? DEFAULT_WEIGHT_PADDING_GRAMS,
    flashCount: options.flashCount,
    flashSelectionMode: options.flashSelectionMode || FLASH_SELECTION_MODE_COUNT,
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
  appendLog(run, 'system', '正在停止当前任务...');
  run.stopRequested = true;
  run.captcha = null;
  run.child.kill('SIGTERM');
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
      currentRun: serializeRun(currentRun),
      history,
    });
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
