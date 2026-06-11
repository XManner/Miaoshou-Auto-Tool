function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const DEFAULT_SINGLE_SPEC_ATTR_NAME = process.env.DEFAULT_SINGLE_SPEC_ATTR_NAME || '规格';
const DEFAULT_SINGLE_SPEC_ATTR_VALUE = process.env.DEFAULT_SINGLE_SPEC_ATTR_VALUE || '标准款';
const SPEC_ATTR_NAME_API_LIMIT = 20;
const SPEC_ATTR_NAME_MAX_LENGTH = Math.min(
  parsePositiveInteger(process.env.SPEC_ATTR_NAME_MAX_LENGTH, SPEC_ATTR_NAME_API_LIMIT),
  SPEC_ATTR_NAME_API_LIMIT,
);
const SPEC_ATTR_VALUE_MAX_LENGTH = parsePositiveInteger(process.env.SPEC_ATTR_VALUE_MAX_LENGTH, 40);

const SPEC_TEXT_FALLBACK_TRANSLATIONS_SAFE = Object.freeze({
  '\u89c4\u683c': 'Specification',
  '\u989c\u8272': 'Color',
  '\u8272\u53f7': 'Shade',
  '\u6b3e\u5f0f': 'Style',
  '\u5c3a\u7801': 'Size',
  '\u578b\u53f7': 'Model',
  '\u9999\u578b': 'Scent',
  '\u5bb9\u91cf': 'Capacity',
  '\u6750\u8d28': 'Material',
  '\u6807\u51c6\u6b3e': 'Standard',
  '\u5747\u7801': 'One Size',
  '\u9ed1\u8272': 'Black',
  '\u767d\u8272': 'White',
  '\u7070\u8272': 'Gray',
  '\u94f6\u8272': 'Silver',
  '\u91d1\u8272': 'Gold',
  '\u7ea2\u8272': 'Red',
  '\u84dd\u8272': 'Blue',
  '\u7eff\u8272': 'Green',
  '\u9ec4\u8272': 'Yellow',
  '\u7d2b\u8272': 'Purple',
  '\u7c89\u8272': 'Pink',
  '\u68d5\u8272': 'Brown',
  '\u85cf\u9752': 'Navy Blue',
  '\u519b\u7eff': 'Army Green',
  '\u6a59\u8272': 'Orange',
  '\u900f\u660e': 'Transparent',
  '\u80a4\u8272': 'Nude',
  '\u968f\u673a': 'Random',
  '\u6df7\u8272': 'Mixed Colors',
});

function containsCjkText(value = '') {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function normalizeSpecTranslationTextSafe(value = '') {
  return normalizeText(value)
    .replace(/\uFF0C/g, ',')
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')');
}

function toTitleCaseSpecToken(token = '') {
  const text = String(token || '').trim();
  if (!text) {
    return '';
  }
  if (/^[A-Z0-9+#./-]+$/.test(text)) {
    return text;
  }
  if (/^\d+(?:\.\d+)?[a-z%]+$/i.test(text)) {
    return text.replace(/[A-Z]+/g, (match) => match.toLowerCase());
  }
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function compactSkuSpecTextPreservingOrder(value = '', maxLength = SPEC_ATTR_VALUE_MAX_LENGTH) {
  const lowPriorityWords = new Set([
    'premium',
    'quality',
    'factory',
    'wholesale',
    'dropshipping',
    'tiktok',
    'amazon',
    'lazada',
    'shopee',
    'hot',
    'sale',
    'selling',
    'popular',
    'version',
    'option',
    'variant',
    'style',
    'type',
    'gift',
    'hydrating',
    'moisturizing',
    'nourishing',
    'waterproof',
    'lasting',
    'non',
    'stick',
    'cup',
    'shade',
  ]);
  const stopWords = new Set(['for', 'with', 'and', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'by', 'from']);
  const tokens = String(value || '')
    .replace(/[+]+/g, ' ')
    .split(/[\s,]+/)
    .map((token) => token.replace(/^[^\w#.%]+|[^\w#.%]+$/g, ''))
    .filter(Boolean);

  const buildCandidate = (filterLowPriority) => tokens
    .filter((token) => {
      const key = token.toLowerCase();
      if (stopWords.has(key)) {
        return false;
      }
      if (filterLowPriority && lowPriorityWords.has(key)) {
        return false;
      }
      return true;
    })
    .map(toTitleCaseSpecToken)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutLowPriority = buildCandidate(true);
  if (withoutLowPriority && withoutLowPriority.length <= maxLength) {
    return withoutLowPriority;
  }

  const allMeaningful = buildCandidate(false);
  if (allMeaningful && allMeaningful.length <= maxLength) {
    return allMeaningful;
  }

  let compacted = '';
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (stopWords.has(key) || lowPriorityWords.has(key)) {
      continue;
    }
    const resolved = toTitleCaseSpecToken(token);
    const next = compacted ? `${compacted} ${resolved}` : resolved;
    if (next.length <= maxLength) {
      compacted = next;
    }
  }

  return compacted;
}

function compactSkuSpecTextByMeaning(value = '', maxLength = SPEC_ATTR_VALUE_MAX_LENGTH) {
  const source = normalizeSpecTranslationTextSafe(value)
    .replace(/[“”"]/g, '')
    .replace(/[+|/\\]+/g, ' ')
    .replace(/[，、；;]+/g, ',')
    .replace(/[-_]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!source || source.length <= maxLength) {
    return source;
  }

  const withoutBrackets = source
    .replace(/\(([^)]*)\)/g, (fullText, innerText) => {
      const inner = String(innerText || '');
      if (/(export|prohibit|disclaimer|responsib|accept|domestic sale|purchase implies)/i.test(inner)) {
        return '';
      }
      return fullText;
    })
    .trim();
  const candidateSource = withoutBrackets || source;
  if (candidateSource.length <= maxLength) {
    return candidateSource;
  }

  const normalized = candidateSource
    .replace(/\b(?:for|with|and|the|a|an|of|to|in|on|by|from)\b/gi, ' ')
    .replace(/\b(?:new|hot|sale|selling|popular|premium|high\s*quality|factory|wholesale|dropshipping|tiktok|amazon|lazada|shopee)\b/gi, ' ')
    .replace(/\b(?:style|type|model|version|option|variant)\b\s*[:：-]?\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const orderedCompacted = compactSkuSpecTextPreservingOrder(normalized, maxLength);
  if (orderedCompacted) {
    return orderedCompacted;
  }

  const important = [];
  const addToken = (token) => {
    const cleaned = toTitleCaseSpecToken(token)
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (!important.some((item) => item.toLowerCase() === key)) {
      important.push(cleaned);
    }
  };

  const tokenPatterns = [
    /\b\d+(?:\.\d+)?\s*(?:ml|g|kg|oz|lb|cm|mm|m|inch|in|pcs?|pieces?|pack|packs|sets?|pairs?|colors?|count|ct|瓶|支|个|片|包|盒)\b/gi,
    /\b(?:#[a-z0-9-]+|[a-z]{1,8}\d{1,6}[a-z0-9-]*)\b/gi,
    /\b(?:black|white|red|blue|green|yellow|pink|purple|brown|gray|grey|orange|gold|silver|clear|transparent|nude|beige|ivory|navy|rose|mixed|random)\b/gi,
    /\b(?:small|medium|large|mini|standard|classic|short|long|thin|thick|round|square|oval|matte|glossy|warm|cool)\b/gi,
    /\b(?:box|bag|bottle|tube|jar|opp|blister|card|set|pair|kit|refill)\b/gi,
  ];

  for (const pattern of tokenPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      addToken(match[0]);
    }
  }

  for (const token of normalized.split(/[\s,]+/)) {
    if (important.join(' ').length >= maxLength) {
      break;
    }
    if (/^(?:for|with|and|the|of|to|in|on|by|from)$/i.test(token)) {
      continue;
    }
    if (token.length <= 2 && !/\d/.test(token)) {
      continue;
    }
    addToken(token);
  }

  if (important.length > 0) {
    let compacted = '';
    for (const token of important) {
      const next = compacted ? `${compacted} ${token}` : token;
      if (next.length > maxLength) {
        continue;
      }
      compacted = next;
    }
    if (compacted) {
      return compacted;
    }
  }

  const firstPhrase = normalized.split(/[,.!?]/)[0].trim();
  return firstPhrase || normalized;
}

function sanitizeSkuSpecText(value = '', maxLength = SPEC_ATTR_VALUE_MAX_LENGTH) {
  const normalized = normalizeSpecTranslationTextSafe(value);
  if (!normalized) {
    return '';
  }

  let cleaned = compactSkuSpecTextByMeaning(normalized, maxLength)
    .replace(/\s+/g, ' ')
    .replace(/[“”"]/g, '')
    .trim();

  cleaned = cleaned.replace(/\(([^)]*)\)/g, (fullText, innerText) => {
    const inner = String(innerText || '');
    if (/(export|prohibit|disclaimer|responsib|accept|domestic sale|purchase implies)/i.test(inner)) {
      return '';
    }
    return fullText;
  }).trim();

  if (cleaned.length > maxLength) {
    cleaned = compactSkuSpecTextByMeaning(cleaned.replace(/\([^)]*\)/g, '').trim(), maxLength);
  }
  if (cleaned.length > maxLength) {
    const firstPhrase = cleaned.split(/[;；|,，。!?]/)[0].trim();
    cleaned = compactSkuSpecTextByMeaning(firstPhrase || cleaned, maxLength);
  }
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trim();
  }

  return cleaned;
}

function normalizeSkuSpecDuplicateKey(value = '') {
  return normalizeSpecTranslationTextSafe(value)
    .replace(/^#\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildIndexedSkuSpecText(value = '', index = 1, maxLength = SPEC_ATTR_VALUE_MAX_LENGTH) {
  const prefix = `#${index} `;
  const base = sanitizeSkuSpecText(
    normalizeSpecTranslationTextSafe(value).replace(/^#\d+\s+/, ''),
    Math.max(1, maxLength - prefix.length),
  ) || 'Option';
  return sanitizeSkuSpecText(`${prefix}${base}`, maxLength) || `${prefix}${base}`.slice(0, maxLength).trim();
}

function ensureUniqueSkuPropertyValueNames(skuPropertyList = []) {
  return (Array.isArray(skuPropertyList) ? skuPropertyList : []).map((property) => {
    const attrValueList = Array.isArray(property && property.attrValueList)
      ? property.attrValueList
      : [];
    const duplicateGroups = new Map();

    for (const value of attrValueList) {
      const attrValue = sanitizeSkuSpecText(
        value && value.attrValue,
        SPEC_ATTR_VALUE_MAX_LENGTH,
      ) || DEFAULT_SINGLE_SPEC_ATTR_VALUE;
      const duplicateKey = normalizeSkuSpecDuplicateKey(attrValue) || '__empty__';

      if (!duplicateGroups.has(duplicateKey)) {
        duplicateGroups.set(duplicateKey, []);
      }
      duplicateGroups.get(duplicateKey).push(attrValue);
    }

    const seenDuplicateIndexByKey = new Map();

    return {
      ...property,
      attrValueList: attrValueList.map((value) => {
        const attrValue = sanitizeSkuSpecText(
          value && value.attrValue,
          SPEC_ATTR_VALUE_MAX_LENGTH,
        ) || DEFAULT_SINGLE_SPEC_ATTR_VALUE;
        const duplicateKey = normalizeSkuSpecDuplicateKey(attrValue) || '__empty__';
        const duplicateCount = duplicateGroups.has(duplicateKey)
          ? duplicateGroups.get(duplicateKey).length
          : 0;
        let resolvedAttrValue = attrValue;

        if (duplicateCount > 1) {
          const duplicateIndex = (seenDuplicateIndexByKey.get(duplicateKey) || 0) + 1;
          seenDuplicateIndexByKey.set(duplicateKey, duplicateIndex);
          resolvedAttrValue = buildIndexedSkuSpecText(
            attrValue,
            duplicateIndex,
            SPEC_ATTR_VALUE_MAX_LENGTH,
          );
        }

        return {
          ...value,
          attrValue: resolvedAttrValue,
        };
      }),
    };
  });
}

function resolveFallbackSpecTranslation(value = '') {
  const normalized = normalizeSpecTranslationTextSafe(value);
  if (!normalized) {
    return '';
  }
  if (SPEC_TEXT_FALLBACK_TRANSLATIONS_SAFE[normalized]) {
    return SPEC_TEXT_FALLBACK_TRANSLATIONS_SAFE[normalized];
  }
  if (!containsCjkText(normalized)) {
    return normalized;
  }
  return '';
}

function cleanSkuPropertyList(skuPropertyList = []) {
  return (Array.isArray(skuPropertyList) ? skuPropertyList : []).map((property) => ({
    ...property,
    attrName: normalizeText(property && property.attrName),
    attrValueList: (Array.isArray(property && property.attrValueList) ? property.attrValueList : []).map((value) => ({
      ...value,
      attrValue: normalizeText(value && value.attrValue),
      supplementarySkuImageUrls: Array.isArray(value && value.supplementarySkuImageUrls)
        ? value.supplementarySkuImageUrls
        : [],
    })),
  }));
}

function translateSkuPropertyListWithFallbackMap(skuPropertyList = []) {
  return ensureUniqueSkuPropertyValueNames(cleanSkuPropertyList(skuPropertyList).map((property) => ({
    ...property,
    attrName: sanitizeSkuSpecText(
      resolveFallbackSpecTranslation(property && property.attrName)
      || normalizeSpecTranslationTextSafe(property && property.attrName),
      SPEC_ATTR_NAME_MAX_LENGTH,
    ) || sanitizeSkuSpecText(
      normalizeSpecTranslationTextSafe(property && property.attrName),
      SPEC_ATTR_NAME_MAX_LENGTH,
    ),
    attrValueList: (Array.isArray(property && property.attrValueList) ? property.attrValueList : []).map((value) => ({
      ...value,
      attrValue: sanitizeSkuSpecText(
        resolveFallbackSpecTranslation(value && value.attrValue)
        || normalizeSpecTranslationTextSafe(value && value.attrValue),
        SPEC_ATTR_VALUE_MAX_LENGTH,
      ) || sanitizeSkuSpecText(
        normalizeSpecTranslationTextSafe(value && value.attrValue),
        SPEC_ATTR_VALUE_MAX_LENGTH,
      ),
    })),
  })));
}

function collectSkuTextsForTranslation(skuPropertyList = []) {
  const textSet = new Set();

  for (const property of Array.isArray(skuPropertyList) ? skuPropertyList : []) {
    const attrName = normalizeSpecTranslationTextSafe(property && property.attrName);
    if (attrName) {
      textSet.add(attrName);
    }
    for (const value of Array.isArray(property && property.attrValueList) ? property.attrValueList : []) {
      const attrValue = normalizeSpecTranslationTextSafe(value && value.attrValue);
      if (attrValue) {
        textSet.add(attrValue);
      }
    }
  }

  return [...textSet];
}

function parseSpecTranslationEntries(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (payload.map && typeof payload.map === 'object') {
    return Object.entries(payload.map).map(([source, target]) => ({ source, target }));
  }

  if (Array.isArray(payload.translations)) {
    return payload.translations;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  return [];
}

module.exports = {
  DEFAULT_SINGLE_SPEC_ATTR_NAME,
  DEFAULT_SINGLE_SPEC_ATTR_VALUE,
  SPEC_ATTR_NAME_MAX_LENGTH,
  SPEC_ATTR_VALUE_MAX_LENGTH,
  SPEC_TEXT_FALLBACK_TRANSLATIONS_SAFE,
  buildIndexedSkuSpecText,
  cleanSkuPropertyList,
  collectSkuTextsForTranslation,
  compactSkuSpecTextByMeaning,
  compactSkuSpecTextPreservingOrder,
  containsCjkText,
  ensureUniqueSkuPropertyValueNames,
  normalizeSkuSpecDuplicateKey,
  normalizeSpecTranslationTextSafe,
  parseSpecTranslationEntries,
  resolveFallbackSpecTranslation,
  sanitizeSkuSpecText,
  toTitleCaseSpecToken,
  translateSkuPropertyListWithFallbackMap,
};
