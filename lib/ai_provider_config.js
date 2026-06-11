function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_KIMI_MODEL = 'kimi-k2.6';
const DEFAULT_KIMI_TEMPERATURE = 1;
const DEFAULT_KIMI_REQUEST_TIMEOUT_MS = parsePositiveInteger(process.env.KIMI_REQUEST_TIMEOUT_MS, 90000);
const DEFAULT_KIMI_MAX_RETRIES = Math.max(0, Math.floor(parseNumber(process.env.KIMI_MAX_RETRIES, 0)));
const DEFAULT_MIMO_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const DEFAULT_MIMO_MODEL = 'mimo-v2.5-pro';
const DEFAULT_MIMO_IMAGE_MODEL = 'mimo-v2.5';
const DEFAULT_MIMO_TEMPERATURE = parseNumber(
  process.env.Mimo_TEMPERATURE || process.env.MIMO_TEMPERATURE || process.env.KIMI_TEMPERATURE,
  DEFAULT_KIMI_TEMPERATURE,
);
const DEFAULT_MIMO_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.Mimo_REQUEST_TIMEOUT_MS || process.env.MIMO_REQUEST_TIMEOUT_MS || process.env.KIMI_REQUEST_TIMEOUT_MS,
  DEFAULT_KIMI_REQUEST_TIMEOUT_MS,
);
const DEFAULT_MIMO_MAX_RETRIES = Math.max(
  0,
  Math.floor(parseNumber(process.env.Mimo_MAX_RETRIES || process.env.MIMO_MAX_RETRIES, 1)),
);
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DEEPSEEK_REQUEST_TIMEOUT_MS,
  DEFAULT_KIMI_REQUEST_TIMEOUT_MS,
);
const DEFAULT_DEEPSEEK_MAX_RETRIES = Math.max(
  0,
  Math.floor(parseNumber(process.env.DEEPSEEK_MAX_RETRIES, 2)),
);
const DEFAULT_TITLE_OPTIMIZE_MODEL = DEFAULT_DEEPSEEK_MODEL;
const DEFAULT_SKU_TRANSLATION_MODEL = DEFAULT_DEEPSEEK_MODEL;
const DEFAULT_IMAGE_AUDIT_MODEL = DEFAULT_MIMO_IMAGE_MODEL;
const DEFAULT_WEIGHT_ESTIMATION_MODEL = DEFAULT_MIMO_IMAGE_MODEL;
const DEFAULT_AI_PROVIDER = String(
  process.env.AI_PROVIDER || process.env.LLM_PROVIDER || (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'kimi'),
).trim().toLowerCase();

function normalizeAiProvider(provider = DEFAULT_AI_PROVIDER) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'deepseek' || normalized === 'mimo') {
    return normalized;
  }
  return 'kimi';
}

function getMimoApiKey() {
  return process.env.Mimo_API_KEY || process.env.MIMO_API_KEY || '';
}

function getMimoBaseUrl() {
  return process.env.Mimo_BASE_URL || process.env.MIMO_BASE_URL || DEFAULT_MIMO_BASE_URL;
}

function getMimoModel(envKey = '') {
  return (envKey ? (process.env[envKey] || process.env[envKey.replace(/^MIMO_/, 'Mimo_')]) : '')
    || process.env.Mimo_MODEL
    || process.env.MIMO_MODEL
    || DEFAULT_MIMO_MODEL;
}

function getMimoImageModel(envKey = '') {
  return (envKey ? (process.env[envKey] || process.env[envKey.replace(/^MIMO_/, 'Mimo_')]) : '')
    || process.env.Mimo_IMAGE_MODEL
    || process.env.MIMO_IMAGE_MODEL
    || DEFAULT_MIMO_IMAGE_MODEL;
}

function getDefaultAiModel(provider = DEFAULT_AI_PROVIDER) {
  const normalizedProvider = normalizeAiProvider(provider);
  if (normalizedProvider === 'deepseek') {
    return process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  }
  if (normalizedProvider === 'mimo') {
    return getMimoModel();
  }
  return process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL;
}

function isKimiModel(model = '') {
  return /^(?:kimi-|moonshot-)/i.test(String(model || '').trim());
}

function isMimoModel(model = '') {
  return /^mimo-/i.test(String(model || '').trim());
}

function resolveAiProviderForRequest(requestBody = {}, provider = DEFAULT_AI_PROVIDER) {
  const normalizedProvider = normalizeAiProvider(provider);
  const model = String(requestBody.model || '');
  if (/^deepseek-/i.test(model)) {
    return 'deepseek';
  }
  if (isKimiModel(model)) {
    return 'kimi';
  }
  if (/^mimo-/i.test(model)) {
    return 'mimo';
  }
  return normalizedProvider;
}

function isDeepSeekModel(model = getDefaultAiModel()) {
  return resolveAiProviderForRequest({ model }, DEFAULT_AI_PROVIDER) === 'deepseek';
}

function hasKimiApiKey() {
  return Boolean(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY);
}

function hasMimoApiKey() {
  return Boolean(getMimoApiKey());
}

function normalizeModelName(value = '') {
  return String(value || '').trim();
}

function isMimoImageCapableModel(model = '') {
  return /^(?:mimo-v2\.5|mimo-v2-omni)$/i.test(String(model || '').trim());
}

function resolveKimiVisionModel(model = getDefaultAiModel(), envKey = '') {
  const requestedModel = normalizeModelName(model);
  if (isKimiModel(requestedModel)) {
    return requestedModel;
  }

  const envModel = normalizeModelName(envKey ? process.env[envKey] : '');
  if (isKimiModel(envModel)) {
    return envModel;
  }

  return normalizeModelName(process.env.KIMI_WEIGHT_ESTIMATION_MODEL)
    || normalizeModelName(process.env.KIMI_IMAGE_AUDIT_MODEL)
    || normalizeModelName(process.env.KIMI_MODEL)
    || DEFAULT_KIMI_MODEL;
}

function resolveMimoVisionModel(model = getDefaultAiModel(), envKey = '') {
  if (!isDeepSeekModel(model)
    && /^mimo-/i.test(String(model || ''))
    && isMimoImageCapableModel(model)) {
    return model;
  }

  const imageModel = getMimoImageModel(envKey);
  return isMimoImageCapableModel(imageModel)
    ? imageModel
    : DEFAULT_MIMO_IMAGE_MODEL;
}

function resolveVisionFunctionModel(model = '', envKey = '') {
  const requestedModel = normalizeModelName(model);
  const envModel = normalizeModelName(envKey ? process.env[envKey] : '');
  const candidate = requestedModel || envModel;

  if (isKimiModel(candidate)) {
    return resolveKimiVisionModel(candidate, envKey);
  }
  if (isMimoModel(candidate)) {
    return resolveMimoVisionModel(candidate, envKey);
  }

  return resolveMimoVisionModel('', envKey);
}

function isKimiVisionModel(model = '') {
  return isKimiModel(model);
}

function getTitleOptimizeModel(model = '') {
  return normalizeModelName(model)
    || normalizeModelName(process.env.TITLE_OPTIMIZE_MODEL)
    || DEFAULT_TITLE_OPTIMIZE_MODEL;
}

function getSkuTranslationModel(model = '') {
  return normalizeModelName(model)
    || normalizeModelName(process.env.SKU_TRANSLATION_MODEL)
    || DEFAULT_SKU_TRANSLATION_MODEL;
}

function getImageAuditModel(model = '') {
  return resolveVisionFunctionModel(
    normalizeModelName(model) || normalizeModelName(process.env.IMAGE_AUDIT_MODEL) || DEFAULT_IMAGE_AUDIT_MODEL,
    'IMAGE_AUDIT_MODEL',
  );
}

function getWeightEstimationModel(model = '') {
  return resolveVisionFunctionModel(
    normalizeModelName(model) || normalizeModelName(process.env.WEIGHT_ESTIMATION_MODEL) || DEFAULT_WEIGHT_ESTIMATION_MODEL,
    'WEIGHT_ESTIMATION_MODEL',
  );
}

function buildDeepSeekApiUrl(path) {
  const baseURL = String(process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, '');
  return `${baseURL}/${String(path || '').replace(/^\/+/, '')}`;
}

function buildMimoApiUrl(path) {
  const baseURL = String(getMimoBaseUrl()).replace(/\/+$/, '');
  return `${baseURL}/${String(path || '').replace(/^\/+/, '')}`;
}

function extractMimoImageTokenCount(usage = {}) {
  const candidates = [
    usage.image_tokens,
    usage.imageTokens,
    usage.prompt_tokens_details && usage.prompt_tokens_details.image_tokens,
    usage.prompt_tokens_details && usage.prompt_tokens_details.imageTokens,
    usage.promptTokensDetails && usage.promptTokensDetails.imageTokens,
    usage.input_tokens_details && usage.input_tokens_details.image_tokens,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

function formatMimoUsageForLog(usage = {}) {
  const promptTokens = Number(usage.prompt_tokens || usage.input_tokens || usage.promptTokens || 0);
  const completionTokens = Number(usage.completion_tokens || usage.output_tokens || usage.completionTokens || 0);
  const totalTokens = Number(usage.total_tokens || usage.totalTokens || (promptTokens + completionTokens) || 0);
  const imageTokens = extractMimoImageTokenCount(usage);
  const parts = [
    `输入 ${Number.isFinite(promptTokens) ? promptTokens : 0}`,
    `输出 ${Number.isFinite(completionTokens) ? completionTokens : 0}`,
    `合计 ${Number.isFinite(totalTokens) ? totalTokens : 0}`,
  ];

  if (imageTokens > 0) {
    parts.push(`图片 ${imageTokens}`);
  }

  return parts.join(' / ');
}

module.exports = {
  DEFAULT_AI_PROVIDER,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MAX_RETRIES,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS,
  DEFAULT_IMAGE_AUDIT_MODEL,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MAX_RETRIES,
  DEFAULT_KIMI_MODEL,
  DEFAULT_KIMI_REQUEST_TIMEOUT_MS,
  DEFAULT_KIMI_TEMPERATURE,
  DEFAULT_MIMO_BASE_URL,
  DEFAULT_MIMO_IMAGE_MODEL,
  DEFAULT_MIMO_MAX_RETRIES,
  DEFAULT_MIMO_MODEL,
  DEFAULT_MIMO_REQUEST_TIMEOUT_MS,
  DEFAULT_MIMO_TEMPERATURE,
  DEFAULT_SKU_TRANSLATION_MODEL,
  DEFAULT_TITLE_OPTIMIZE_MODEL,
  DEFAULT_WEIGHT_ESTIMATION_MODEL,
  buildDeepSeekApiUrl,
  buildMimoApiUrl,
  extractMimoImageTokenCount,
  formatMimoUsageForLog,
  getDefaultAiModel,
  getImageAuditModel,
  getMimoApiKey,
  getMimoBaseUrl,
  getMimoImageModel,
  getMimoModel,
  getSkuTranslationModel,
  getTitleOptimizeModel,
  getWeightEstimationModel,
  hasKimiApiKey,
  hasMimoApiKey,
  isDeepSeekModel,
  isKimiModel,
  isKimiVisionModel,
  isMimoImageCapableModel,
  isMimoModel,
  normalizeAiProvider,
  normalizeModelName,
  resolveAiProviderForRequest,
  resolveKimiVisionModel,
  resolveMimoVisionModel,
  resolveVisionFunctionModel,
};
