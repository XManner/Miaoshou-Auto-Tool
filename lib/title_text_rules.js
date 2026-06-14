function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueTextList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

const DEFAULT_TITLE_MAX_LENGTH = parsePositiveInteger(process.env.TITLE_OPTIMIZE_MAX_LENGTH, 180);
const DEFAULT_TITLE_MIN_LENGTH = parsePositiveInteger(process.env.TITLE_OPTIMIZE_MIN_LENGTH, 25);
const BUILT_IN_SENSITIVE_WORDS = Object.freeze([
  '跨境', '工厂', '货源', '抖音', '小红书', '亚马逊', '批发', '一件代发', '厂家直销',
  'tiktok', 'tk', 'TK', '抑菌', 'yi菌', '益菌', '真菌', '抗菌', '草膏', '药膏',
  '丰胸', '美白', '增强', '抗皱', '抗衰', '壮阳', '专供', '药品', '杀菌',
  '治疗', '药品药用', '祛痘', '直销', '代理', '正品', '仿品', '源头', '止痛',
  '独立站', '私密', '私处', '下体', '药薰', '药熏', '薰王', '薰', '外贸',
  '全英文', '提臀', '丰臀', '美乳', '速卖通', '虾皮', 'temu', 'TEMU', '电商',
  '妇科', '阴道', '阴茎', '阴道药膏', '厂家', 'Lazada', 'sumifun', 'HBESTY',
  'Sumifun', '代发',
  'factory', 'wholesale', 'dropship', 'dropshipping', 'whitening', 'anti-aging',
  'anti aging', 'anti-wrinkle', 'anti wrinkle', 'antibacterial', 'anti-bacterial',
  'bactericidal', 'sterilizing', 'treatment', 'medicine', 'drug', 'pharmaceutical',
  'acne', 'pain relief', 'breast enlargement', 'breast enhancement', 'butt lift',
  'hip lift', 'vaginal', 'vagina', 'penis', 'private part', 'private parts',
  'fungus', 'fungal', 'genuine', 'authentic',
]);
const SENSITIVE_WORDS = Object.freeze(uniqueTextList([
  ...BUILT_IN_SENSITIVE_WORDS,
  ...String(process.env.EXTRA_SENSITIVE_WORDS || '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean),
]).sort((left, right) => right.length - left.length));

function normalizeOptimizedTitle(title, maxLength = DEFAULT_TITLE_MAX_LENGTH) {
  const normalized = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .trim();

  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength).trim()
    : normalized;
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSensitiveWordPattern(word = '') {
  const raw = String(word || '').trim();
  if (!raw) {
    return null;
  }

  const escaped = escapeRegExp(raw).replace(/\s+/g, '\\s+');
  if (/^[A-Za-z0-9][A-Za-z0-9\s%+_.-]*[A-Za-z0-9]$/.test(raw)) {
    return new RegExp(`\\b${escaped}\\b`, 'gi');
  }

  return /[A-Za-z]/.test(raw)
    ? new RegExp(escaped, 'gi')
    : new RegExp(escaped, 'g');
}

function sanitizeSensitiveWordsFromText(value = '', maxLength = null) {
  let output = String(value || '');

  for (const word of SENSITIVE_WORDS) {
    const pattern = buildSensitiveWordPattern(word);
    if (!pattern) {
      continue;
    }
    output = output.replace(pattern, ' ');
  }

  output = output
    .replace(/\s*[-_]\s*/g, ' ')
    .replace(/[|/\\_-]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (maxLength) {
    return normalizeOptimizedTitle(output, maxLength);
  }

  return output;
}

function chooseSafeTitleSuffix(title = '', originalTitle = '') {
  const combined = `${title} ${originalTitle}`.toLowerCase();

  if (/brooch|pin|necklace|ring|bracelet|earring|accessor/.test(combined)) {
    return 'Fashion Accessory for Daily Wear';
  }
  if (/lip|makeup|cosmetic|mascara|eyeliner|foundation|powder/.test(combined)) {
    return 'Cosmetic Product for Daily Use';
  }
  if (/patch|plaster/.test(combined)) {
    return 'Daily Care Patch for Home Use';
  }
  if (/cream|serum|gel|lotion|soap|cleanser|toothpaste|shampoo|oil/.test(combined)) {
    return 'Daily Skin Care Product';
  }

  return 'Daily Use Product';
}

function ensureOptimizedTitleMinLength(title = '', {
  originalTitle = '',
  maxLength = DEFAULT_TITLE_MAX_LENGTH,
  minLength = DEFAULT_TITLE_MIN_LENGTH,
} = {}) {
  let output = sanitizeSensitiveWordsFromText(
    normalizeOptimizedTitle(title, maxLength),
    maxLength,
  );

  if (!output || output.length >= minLength || maxLength < minLength) {
    return output;
  }

  const suffix = chooseSafeTitleSuffix(output, originalTitle);
  if (!new RegExp(`\\b${escapeRegExp(suffix)}\\b`, 'i').test(output)) {
    output = `${output} ${suffix}`;
  }

  output = sanitizeSensitiveWordsFromText(output, maxLength);
  if (output.length >= minLength) {
    return output;
  }

  return sanitizeSensitiveWordsFromText(`${output} Product for Daily Use`, maxLength);
}

module.exports = {
  BUILT_IN_SENSITIVE_WORDS,
  SENSITIVE_WORDS,
  buildSensitiveWordPattern,
  chooseSafeTitleSuffix,
  ensureOptimizedTitleMinLength,
  escapeRegExp,
  normalizeOptimizedTitle,
  sanitizeSensitiveWordsFromText,
};
