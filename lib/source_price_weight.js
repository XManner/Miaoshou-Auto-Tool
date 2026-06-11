const {
  clampGrossWeightKg,
  enforceMinimumFinalGrossWeightKg,
  normalizeWeightUnitToKg,
} = require('./gross_weight_rules');

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

const DEFAULT_SKU_WEIGHT_PADDING_GRAMS = Math.max(
  0,
  parseNumber(process.env.SKU_WEIGHT_PADDING_GRAMS, 30),
);
const MAX_EXTRACTED_SOURCE_FREIGHT_CNY = parseNumber(process.env.MAX_EXTRACTED_SOURCE_FREIGHT_CNY, 30);

function normalizeSkuWeightPaddingGrams(value = DEFAULT_SKU_WEIGHT_PADDING_GRAMS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_SKU_WEIGHT_PADDING_GRAMS;
  }
  return Number(numeric.toFixed(1));
}

function addSkuWeightPaddingKg(valueKg, fallback = null, paddingGrams = DEFAULT_SKU_WEIGHT_PADDING_GRAMS) {
  const value = clampGrossWeightKg(valueKg, fallback);
  if (!value) {
    return fallback;
  }
  return clampGrossWeightKg(value + (normalizeSkuWeightPaddingGrams(paddingGrams) / 1000), value);
}

function normalizeCurrencyCny(value, fallback = null) {
  const numeric = parsePositiveNumber(value, fallback);
  if (!numeric) {
    return fallback;
  }
  return Number(Number(numeric).toFixed(2));
}

function normalizeSourcePriceExtraCny(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Number(numeric.toFixed(2));
}

function applySourcePriceExtraCny(sourcePrice, sourcePriceExtraCny = 0) {
  const extra = normalizeSourcePriceExtraCny(sourcePriceExtraCny);
  if (!extra) {
    return normalizeCurrencyCny(sourcePrice, sourcePrice);
  }

  const basePrice = normalizeCurrencyCny(sourcePrice, null);
  if (!basePrice) {
    return sourcePrice;
  }

  return normalizeCurrencyCny(basePrice + extra);
}

function extractLowestPriceFromRangeMatch(match = []) {
  const prices = match
    .slice(1)
    .map((value) => normalizeCurrencyCny(value))
    .filter((value) => value && value >= 0.01 && value <= 100000);

  return prices.length > 0 ? Math.min(...prices) : null;
}

function isSuspiciousNonCurrencyPriceContext(text = '', start = 0, end = start) {
  const rawText = String(text || '');
  const before = rawText.slice(Math.max(0, start - 35), start);
  const after = rawText.slice(end, Math.min(rawText.length, end + 35));
  const context = `${before}${after}`;

  if (/^\s*\+/.test(after)) {
    return true;
  }

  if (/^\s*(件以内|个以内|只以内|支以内|片以内|条以内|盒以内|包以内|瓶以内|套以内|件|个|只|支|片|条|盒|包|瓶|套|pcs?|pieces?)/i.test(after)) {
    return true;
  }

  if (/(?:\+\s*)?(人好评|好评|人已加购|已加购|加购|评价|评论|人付款|付款|人浏览|浏览|粉丝|关注)/i.test(context)) {
    return true;
  }

  return /(件以内|个以内|只以内|支以内|片以内|条以内|盒以内|包以内|瓶以内|套以内|已售|销量|成交|累计|库存|stock|sold|sales|review|起批|起订|within\s*\d+\s*(pcs?|pieces?))/i.test(context)
    && !/(price|finalPrice|offerPrice|discountPrice|referencePrice|salePrice|unitPrice)/i.test(context);
}

function isSuspiciousCurrencyPriceContext(text = '', start = 0) {
  const rawText = String(text || '');
  const before = rawText.slice(Math.max(0, start - 28), start);
  return /(?:运费|邮费|快递费|配送费|shipping|freight|postage|delivery)\s*$/i.test(before);
}

function isSuspiciousPriceRangeContext(text = '', start = 0, end = start, matchText = '') {
  const rawText = String(text || '');
  const matchedText = String(matchText || '');
  if (/(?:¥|￥)/.test(matchedText)) {
    return false;
  }

  const before = rawText.slice(Math.max(0, start - 35), start);
  const after = rawText.slice(end, Math.min(rawText.length, end + 35));
  const context = `${before}${after}`;

  if (/^\s*(件以内|个以内|只以内|支以内|片以内|条以内|盒以内|包以内|瓶以内|套以内|件|个|只|支|片|条|盒|包|瓶|套|pcs?|pieces?)/i.test(after)) {
    return true;
  }

  return /(起批|起订|起购|起售|批量|阶梯|库存|销量|已售|成交|quantity|beginAmount|startQuantity|minimum\s*order|min\s*order|moq)/i
    .test(context);
}

function extractFirstValidPriceFromText(text = '') {
  const rawText = String(text || '');
  const rangePatterns = [
    /(?:¥|￥)\s*(\d+(?:\.\d+)?)\s*(?:-|~|－|—|–|至|到)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)/gi,
    /"priceRange"\s*:\s*"?(\d+(?:\.\d+)?)\s*(?:-|~|－|—|–|至|到)\s*(\d+(?:\.\d+)?)"?/gi,
    /"priceRange"\s*:\s*\[\s*"?(\d+(?:\.\d+)?)"?\s*,\s*"?(\d+(?:\.\d+)?)"?\s*\]/gi,
  ];

  for (const pattern of rangePatterns) {
    let match = pattern.exec(rawText);
    while (match) {
      const price = extractLowestPriceFromRangeMatch(match);
      const matchEnd = match.index + match[0].length;
      if (price && !isSuspiciousPriceRangeContext(rawText, match.index, matchEnd, match[0])) {
        return price;
      }
      match = pattern.exec(rawText);
    }
  }

  const patterns = [
    { regex: /"finalPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /"offerPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /"discountPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /"referencePrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /"salePrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /"unitPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi, hasCurrency: false },
    { regex: /(?:¥|￥)\s*(\d+(?:\.\d+)?)/gi, hasCurrency: true },
  ];

  for (const { regex, hasCurrency } of patterns) {
    let match = regex.exec(rawText);
    while (match) {
      const price = normalizeCurrencyCny(match[1]);
      const matchEnd = match.index + match[0].length;
      if (
        price
        && price >= 0.01
        && price <= 100000
        && (
          hasCurrency
            ? !isSuspiciousCurrencyPriceContext(rawText, match.index)
            : !isSuspiciousNonCurrencyPriceContext(rawText, match.index, matchEnd)
        )
      ) {
        return price;
      }
      match = regex.exec(rawText);
    }
  }

  return null;
}

function extractFreightPriceFromText(text = '') {
  const rawText = String(text || '');

  if (/(free\s*shipping|shipping\s*free|postage\s*free)/i.test(rawText)) {
    return 0;
  }

  const maxFreightCny = parsePositiveNumber(MAX_EXTRACTED_SOURCE_FREIGHT_CNY, 30);
  const patterns = [
    /"postFee"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi,
    /"freight"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi,
    /"shippingFee"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi,
    /"deliveryFee"\s*:\s*"?(\d+(?:\.\d+)?)"?/gi,
    /(?:shipping|freight|postage|delivery)[^0-9]{0,10}(?:¥|￥)?\s*(\d+(?:\.\d+)?)/gi,
    /(?:运费|邮费|快递费|配送费)[^0-9]{0,10}(?:¥|￥)?\s*(\d+(?:\.\d+)?)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(rawText);
    while (match) {
      const freight = normalizeCurrencyCny(match[1]);
      const matchEnd = match.index + match[0].length;
      const explicitFreightLabel = /postFee|freight|shippingFee|deliveryFee|运费|邮费|快递费|配送费|shipping\s*fee|freight\s*fee|postage\s*fee|delivery\s*fee/i
        .test(match[0]);
      if (
        freight !== null
        && freight >= 0
        && freight <= maxFreightCny
        && !isSuspiciousFreightContext(rawText, match.index, matchEnd, explicitFreightLabel, match[0])
      ) {
        return freight;
      }
      match = pattern.exec(rawText);
    }
  }

  return null;
}

function isSuspiciousFreightContext(
  text = '',
  start = 0,
  end = start,
  explicitFreightLabel = false,
  matchText = '',
) {
  const rawText = String(text || '');
  const before = rawText.slice(Math.max(0, start - 45), start);
  const after = rawText.slice(end, Math.min(rawText.length, end + 45));
  const around = rawText.slice(Math.max(0, start - 20), Math.min(rawText.length, end + 20));
  const context = `${before}${after}`;
  const matchedText = String(matchText || '');

  if (/^\s*(件|个|只|支|片|条|盒|包|瓶|套|人|单|pcs?|pieces?)/i.test(after)) {
    return true;
  }

  if (/(运费模板|邮费模板|快递模板|配送模板|shipping\s*template|freight\s*template|delivery\s*template)/i.test(around)) {
    return true;
  }

  if (/(起批|起订|起购|起售|批量|minimum\s*order|min\s*order|moq|minOrder|beginAmount|startQuantity|quantity)/i.test(matchedText)) {
    return true;
  }

  if (explicitFreightLabel) {
    return false;
  }

  return /(件以内|个以内|只以内|支以内|片以内|条以内|盒以内|包以内|瓶以内|套以内|人已加购|已加购|已售|销量|库存|起批|起订|评价|确认收货|额度|within\s*\d+\s*(pcs?|pieces?))/i
    .test(context);
}

function normalizeSourceWeightText(text = '') {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWeightValueWithInferredUnit(value, unit = '', {
  defaultUnit = 'kg',
  inferLargeNumberAsGram = false,
} = {}) {
  const numeric = parsePositiveNumber(value);
  if (!numeric) {
    return null;
  }

  let resolvedUnit = String(unit || '').trim();
  if (!resolvedUnit && inferLargeNumberAsGram && numeric > 10) {
    resolvedUnit = 'g';
  }
  return normalizeWeightUnitToKg(numeric, resolvedUnit || defaultUnit);
}

function findPackageWeightFromText(text = '', {
  packageSource = 'source_url_package_weight',
} = {}) {
  const normalizedText = normalizeSourceWeightText(text);
  const start = normalizedText.search(/包装信息|商品件重尺|包装重量|package\s*(?:info|information|details)|packing\s*(?:info|information|details)/i);
  if (start < 0) {
    return null;
  }

  const tail = normalizedText.slice(start);
  const nextSection = tail.slice(1).search(/商品详情|热门推荐|商品评价|商品属性|商品资质证书|product\s*details|reviews?/i);
  const packageText = tail.slice(0, nextSection > 0 ? nextSection + 1 : 1600);
  const patterns = [
    /(?:重量|包装重量|毛重|package\s*weight|gross\s*weight|shipping\s*weight)\s*[\(（]\s*(kg|公斤|千克|g|克|ml|毫升|gram|grams)\s*[\)）]\s*[^0-9]{0,40}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|ml|毫升|gram|grams)?/i,
    /(?:包装重量|毛重|package\s*weight|gross\s*weight|shipping\s*weight)[^0-9]{0,60}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|ml|毫升|gram|grams)?/i,
    /(?:商品件重尺|包装信息)[^0-9]{0,100}(?:重量|weight)[^0-9]{0,60}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|ml|毫升|gram|grams)?/i,
  ];

  for (const pattern of patterns) {
    const match = packageText.match(pattern);
    if (!match) {
      continue;
    }
    const value = pattern === patterns[0] ? match[2] : match[1];
    const unit = pattern === patterns[0] ? (match[3] || match[1]) : match[2];
    const weightKg = normalizeWeightValueWithInferredUnit(value, unit, {
      defaultUnit: 'kg',
      inferLargeNumberAsGram: true,
    });
    if (weightKg) {
      return {
        weightKg: enforceMinimumFinalGrossWeightKg(weightKg),
        source: packageSource,
        evidence: match[0],
      };
    }
  }

  return null;
}

function findNetContentWeightFromText(text = '', {
  netSource = 'source_url_net_estimated_to_gross',
} = {}) {
  const normalizedText = normalizeSourceWeightText(text);
  const patterns = [
    /(?:净含量|净重|net\s*(?:content|weight))[^0-9]{0,40}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|ml|毫升|gram|grams|g\/ml)?/i,
    /(?:产品规格|规格)[^0-9]{0,80}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|ml|毫升|gram|grams|g\/ml)(?:\/|每|瓶|支|盒|包|件|个|只|套)?/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match) {
      continue;
    }
    const weightKg = normalizeWeightValueWithInferredUnit(match[1], match[2], {
      defaultUnit: 'g',
      inferLargeNumberAsGram: true,
    });
    if (weightKg) {
      return {
        weightKg: enforceMinimumFinalGrossWeightKg(weightKg),
        source: netSource,
        evidence: match[0],
      };
    }
  }

  return null;
}

function parseWeightCandidatesFromText(text = '') {
  const normalizedText = normalizeSourceWeightText(text);
  const matches = [];
  const patterns = [
    { type: 'gross', regex: /(毛重|含包装重量|包装重量|包装后重量|重量\s*[\(（]\s*含包装\s*[\)）]|gross\s*weight|shipping\s*weight|package\s*weight|packed\s*weight)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|gram|grams)?/gi },
    { type: 'net', regex: /(净重|产品重量|商品重量|单品重量|重量|net\s*weight|product\s*weight|item\s*weight)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克|gram|grams)?/gi },
  ];

  for (const { type, regex } of patterns) {
    for (const match of normalizedText.matchAll(regex)) {
      const weightKg = normalizeWeightUnitToKg(match[2], match[3] || 'kg');
      if (weightKg) {
        matches.push({
          type,
          weightKg: clampGrossWeightKg(weightKg),
          raw: match[0],
        });
      }
    }
  }

  return matches;
}

function resolveGrossWeightFromText(text = '', {
  packageSource = 'source_url_package_weight',
  grossSource = 'source_url_gross',
  netSource = 'source_url_net_estimated_to_gross',
} = {}) {
  const packageMatch = findPackageWeightFromText(text, { packageSource });
  if (packageMatch) {
    return packageMatch;
  }

  const weightMatches = parseWeightCandidatesFromText(text);
  const grossMatch = weightMatches.find((item) => item.type === 'gross');
  if (grossMatch) {
    return {
      weightKg: enforceMinimumFinalGrossWeightKg(grossMatch.weightKg),
      source: grossSource,
      evidence: grossMatch.raw,
    };
  }

  const netContentMatch = findNetContentWeightFromText(text, { netSource });
  if (netContentMatch) {
    return netContentMatch;
  }

  const netMatch = weightMatches.find((item) => item.type === 'net');
  if (netMatch) {
    const netWithPack = clampGrossWeightKg(netMatch.weightKg * 1.2 + 0.02, netMatch.weightKg);
    return {
      weightKg: enforceMinimumFinalGrossWeightKg(netWithPack),
      source: netSource,
      evidence: netMatch.raw,
    };
  }

  return null;
}

module.exports = {
  addSkuWeightPaddingKg,
  applySourcePriceExtraCny,
  extractFirstValidPriceFromText,
  extractFreightPriceFromText,
  normalizeSkuWeightPaddingGrams,
  resolveGrossWeightFromText,
};
