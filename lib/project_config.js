const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const DEFAULT_ENV_PATH = path.join(__dirname, '..', '.env');
const MIAOSHOU_ACCOUNT_SLOT_LIMIT = 10;

const AI_PROVIDER_OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'kimi', label: 'Kimi' },
];

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

function createContext(options = {}) {
  return {
    envPath: options.envPath || DEFAULT_ENV_PATH,
    env: options.env || process.env,
  };
}

function parseEnvValue(rawValue) {
  const value = String(rawValue || '').trim();
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }

  return value;
}

function loadDotEnv(filePath = DEFAULT_ENV_PATH, env = process.env) {
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
    if (key && env[key] === undefined) {
      env[key] = value;
    }
  }
}

function readEnvFile(context = createContext()) {
  if (!fs.existsSync(context.envPath)) {
    return {};
  }

  const env = {};
  const lines = fs.readFileSync(context.envPath, 'utf8').split(/\r?\n/);
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

function updateEnvFile(updates = {}, context = createContext()) {
  const existing = fs.existsSync(context.envPath)
    ? fs.readFileSync(context.envPath, 'utf8')
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

  fs.writeFileSync(context.envPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');

  for (const [key, value] of Object.entries(updates)) {
    context.env[key] = String(value || '');
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

function readMiaoshouAccounts(context = createContext()) {
  const env = readEnvFile(context);
  const msUrl = env.MIAOSHOU_MS_URL || env.MS_URL || 'https://openapi-erp.91miaoshou.com';
  if (!fs.existsSync(context.envPath)) {
    return [];
  }

  const lines = fs.readFileSync(context.envPath, 'utf8').split(/\r?\n/);
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

function getDefaultMiaoshouAccount(accounts) {
  const list = Array.isArray(accounts) ? accounts : readMiaoshouAccounts();
  return list.find((account) => account.active && account.complete)
    || list.find((account) => account.complete)
    || list[0]
    || null;
}

function findMiaoshouAccount(accountId = '', context = createContext()) {
  const accounts = readMiaoshouAccounts(context);
  if (accountId) {
    const matched = accounts.find((account) => account.id === accountId);
    if (matched) {
      return matched;
    }
  }
  return getDefaultMiaoshouAccount(accounts);
}

function getMiaoshouConfig(context = createContext()) {
  const env = readEnvFile(context);
  const appSecret = env.MIAOSHOU_APP_SECRET || env.APP_SECRET || env.MIAOSHOU_APP_SECRET_1 || '';
  const currentAccount = getDefaultMiaoshouAccount(readMiaoshouAccounts(context));
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

function normalizeMiaoshouAccountRows(rows = [], selectedIndex = 0, context = createContext()) {
  const existingAccounts = readMiaoshouAccounts(context);
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

function getProjectConfig(options = {}, context = createContext()) {
  const includeLocalEnv = Boolean(options.includeLocalEnv);
  const env = readEnvFile(context);
  const miaoshouAccounts = readMiaoshouAccounts(context);
  const selectedMiaoshouAccountIndex = Math.max(0, miaoshouAccounts.findIndex((account) => account.active));
  return {
    envPath: context.envPath,
    includeLocalEnv,
    aiUsage: AI_USAGE_SUMMARY,
    sections: PROJECT_CONFIG_SCHEMA.map((section) => ({
      key: section.key,
      title: section.title,
      description: section.description,
      fields: section.fields.map((field) => serializeProjectConfigField(field, env, { includeLocalEnv })),
    })),
    miaoshou: getMiaoshouConfig(context),
    miaoshouAccounts: miaoshouAccounts.map((account) => serializeProjectMiaoshouAccount(account, { includeLocalEnv })),
    selectedMiaoshouAccountIndex,
  };
}

function normalizeProjectConfig(input = {}, context = createContext()) {
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
      normalizeMiaoshouAccountRows(input.miaoshouAccounts, input.selectedMiaoshouAccountIndex, context),
    );
  }

  return updates;
}

function buildChildProcessEnv(account = null, extraEnv = {}, context = createContext()) {
  const envFromFile = readEnvFile(context);
  const nextEnv = {
    ...context.env,
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

function createProjectConfigManager(options = {}) {
  const context = createContext(options);
  return {
    envPath: context.envPath,
    loadDotEnv: (filePath = context.envPath) => loadDotEnv(filePath, context.env),
    readEnvFile: () => readEnvFile(context),
    updateEnvFile: (updates) => updateEnvFile(updates, context),
    readMiaoshouAccounts: () => readMiaoshouAccounts(context),
    getDefaultMiaoshouAccount: (accounts) => getDefaultMiaoshouAccount(accounts || readMiaoshouAccounts(context)),
    findMiaoshouAccount: (accountId) => findMiaoshouAccount(accountId, context),
    getMiaoshouConfig: () => getMiaoshouConfig(context),
    getProjectConfig: (configOptions = {}) => getProjectConfig(configOptions, context),
    normalizeProjectConfig: (input = {}) => normalizeProjectConfig(input, context),
    buildChildProcessEnv: (account = null, extraEnv = {}) => buildChildProcessEnv(account, extraEnv, context),
    normalizeMiaoshouConfig,
  };
}

const defaultManager = createProjectConfigManager();

module.exports = {
  DEFAULT_ENV_PATH,
  PROJECT_CONFIG_SCHEMA,
  AI_PROVIDER_OPTIONS,
  DEEPSEEK_MODEL_OPTIONS,
  KIMI_MODEL_OPTIONS,
  TEXT_FUNCTION_MODEL_OPTIONS,
  VISION_FUNCTION_MODEL_OPTIONS,
  MIMO_MODEL_OPTIONS,
  MIMO_IMAGE_MODEL_OPTIONS,
  AI_USAGE_SUMMARY,
  createProjectConfigManager,
  parseEnvValue,
  loadDotEnv,
  readEnvFile: defaultManager.readEnvFile,
  updateEnvFile: defaultManager.updateEnvFile,
  maskSecret,
  maskIdentifier,
  maskPhoneText,
  parseMiaoshouAccountEnvKey,
  readMiaoshouAccounts: defaultManager.readMiaoshouAccounts,
  serializeMiaoshouAccount,
  serializeProjectMiaoshouAccount,
  getDefaultMiaoshouAccount: defaultManager.getDefaultMiaoshouAccount,
  findMiaoshouAccount: defaultManager.findMiaoshouAccount,
  getMiaoshouConfig: defaultManager.getMiaoshouConfig,
  getProjectConfig: defaultManager.getProjectConfig,
  normalizeProjectConfig: defaultManager.normalizeProjectConfig,
  normalizeMiaoshouConfig,
  buildChildProcessEnv: defaultManager.buildChildProcessEnv,
};
