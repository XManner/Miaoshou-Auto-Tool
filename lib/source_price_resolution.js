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

const SOURCE_PRICE_DIRECT_USE_MAX_CNY = parseNumber(process.env.SOURCE_PRICE_DIRECT_USE_MAX_CNY, 100);
const SOURCE_PRICE_LOOKUP_ABSOLUTE_MAX_CNY = parseNumber(process.env.SOURCE_PRICE_LOOKUP_ABSOLUTE_MAX_CNY, 300);
const SOURCE_PRICE_LOOKUP_RELATIVE_MAX_MULTIPLIER = parseNumber(
  process.env.SOURCE_PRICE_LOOKUP_RELATIVE_MAX_MULTIPLIER,
  8,
);
const SOURCE_PRICE_LOOKUP_RELATIVE_MAX_DELTA_CNY = parseNumber(
  process.env.SOURCE_PRICE_LOOKUP_RELATIVE_MAX_DELTA_CNY,
  30,
);
const SOURCE_PRICE_SUSPICIOUS_OVERWRITE_DELTA_CNY = parseNumber(
  process.env.SOURCE_PRICE_SUSPICIOUS_OVERWRITE_DELTA_CNY,
  50,
);
const SOURCE_PRICE_SUSPICIOUS_OVERWRITE_MULTIPLIER = parseNumber(
  process.env.SOURCE_PRICE_SUSPICIOUS_OVERWRITE_MULTIPLIER,
  4,
);
const LOW_SOURCE_PRICE_PADDING_THRESHOLD_CNY = parseNumber(
  process.env.LOW_SOURCE_PRICE_PADDING_THRESHOLD_CNY,
  3,
);
const LOW_SOURCE_PRICE_PADDING_CNY = parseNumber(process.env.LOW_SOURCE_PRICE_PADDING_CNY, 3);
const ALLOW_ESTIMATED_FREIGHT_WITH_1688_UNIT = String(
  process.env.ALLOW_ESTIMATED_FREIGHT_WITH_1688_UNIT || '1',
) !== '0';

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

function computeMedianNumber(values = []) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (numbers.length === 0) {
    return null;
  }
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) {
    return numbers[middle];
  }
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function collectRepresentativeOriginPrices(itemInfo = {}, item = {}) {
  const prices = [];

  for (const skuValue of Object.values(itemInfo.skuMap || {})) {
    const price = normalizeCurrencyCny(skuValue && skuValue.originPrice);
    if (price) {
      prices.push(price);
    }
  }

  for (const value of [
    itemInfo.originPrice,
    itemInfo.price,
    item.price,
  ]) {
    const price = normalizeCurrencyCny(value);
    if (price) {
      prices.push(price);
    }
  }

  return prices;
}

function extractRepresentativeOriginPrice(itemInfo = {}, item = {}) {
  return collectRepresentativeOriginPrices(itemInfo, item)[0] || null;
}

function buildSkuOriginPriceSnapshot(skuMap = {}) {
  return Object.entries(skuMap || {}).map(([skuKey, skuValue]) => [
    skuKey,
    normalizeCurrencyCny(skuValue && skuValue.originPrice, null),
  ]);
}

function validateResolvedSourceUnitPrice({
  unitPriceCny,
  itemInfo = {},
  item = {},
} = {}) {
  const unitPrice = normalizeCurrencyCny(unitPriceCny);
  if (!unitPrice) {
    return {
      ok: false,
      reason: 'missing_unit_price',
    };
  }

  const absoluteMax = parsePositiveNumber(SOURCE_PRICE_LOOKUP_ABSOLUTE_MAX_CNY, 300);
  if (absoluteMax && unitPrice > absoluteMax) {
    return {
      ok: false,
      reason: `unit_price_above_absolute_guard:${unitPrice}>${absoluteMax}`,
    };
  }

  const referencePrices = collectRepresentativeOriginPrices(itemInfo, item)
    .filter((price) => price && price > 0);
  const referencePrice = computeMedianNumber(referencePrices);

  if (referencePrice) {
    const multiplier = parsePositiveNumber(SOURCE_PRICE_LOOKUP_RELATIVE_MAX_MULTIPLIER, 8);
    const delta = parsePositiveNumber(SOURCE_PRICE_LOOKUP_RELATIVE_MAX_DELTA_CNY, 30);
    const relativeMax = Math.max(referencePrice * multiplier, referencePrice + delta);

    if (unitPrice > relativeMax) {
      return {
        ok: false,
        reason: `unit_price_above_relative_guard:${unitPrice}>${Number(relativeMax.toFixed(2))}`,
      };
    }
  }

  return {
    ok: true,
    reason: '',
  };
}

function buildLowLookupSourcePriceResolution({
  unitPriceCny,
  lowPricePaddingThresholdCny,
  lowPricePaddingCny,
  blockedBy1688 = false,
  source = '',
  lookup = null,
  lookupAttempts = [],
} = {}) {
  const unitPrice = normalizeCurrencyCny(unitPriceCny);
  const threshold = parsePositiveNumber(lowPricePaddingThresholdCny, 3);
  const padding = parsePositiveNumber(lowPricePaddingCny, 3);

  if (!unitPrice || !threshold || !padding || unitPrice >= threshold) {
    return null;
  }

  return {
    sourcePriceCny: normalizeCurrencyCny(unitPrice + padding),
    unitPriceCny: unitPrice,
    freightPriceCny: normalizeCurrencyCny(padding),
    sourcePriceAdjustmentCny: null,
    sourcePriceAdjustmentThresholdCny: null,
    blockedBy1688,
    source: `${source || '1688_lookup'}_plus_low_price_padding`,
    lookup,
    lookupAttempts,
  };
}

function isSourcePriceTooHighForDirectUse(valueCny, directUseMaxCny = SOURCE_PRICE_DIRECT_USE_MAX_CNY) {
  const value = normalizeCurrencyCny(valueCny, null);
  const directUseMax = parsePositiveNumber(directUseMaxCny, 100);
  return Boolean(value && directUseMax && value > directUseMax);
}

function hasSuspiciousHighSourcePrice(itemInfo = {}, item = {}, directUseMaxCny = SOURCE_PRICE_DIRECT_USE_MAX_CNY) {
  return collectRepresentativeOriginPrices(itemInfo, item)
    .some((price) => isSourcePriceTooHighForDirectUse(price, directUseMaxCny));
}

function buildCurrentSourcePriceFallbackAfterHighResolvedGuard({
  resolvedSourcePriceCny,
  itemInfo = {},
  item = {},
  blockedBy1688 = false,
  lookup = null,
  lookupAttempts = [],
} = {}) {
  if (!isSourcePriceTooHighForDirectUse(resolvedSourcePriceCny)) {
    return null;
  }

  const currentSourcePrice = extractRepresentativeOriginPrice(itemInfo, item);
  if (!currentSourcePrice) {
    return null;
  }

  return {
    sourcePriceCny: normalizeCurrencyCny(currentSourcePrice),
    unitPriceCny: normalizeCurrencyCny(currentSourcePrice),
    freightPriceCny: null,
    sourcePriceAdjustmentCny: null,
    sourcePriceAdjustmentThresholdCny: null,
    blockedBy1688,
    source: 'fallback_current_source_price_after_high_resolved_guard',
    lookup,
    lookupAttempts,
  };
}

function buildResolvedSourcePriceFromLookup({
  lookup,
  source,
  itemInfo = {},
  item = {},
  weightFreightCny = null,
  lowPricePaddingThresholdCny = LOW_SOURCE_PRICE_PADDING_THRESHOLD_CNY,
  lowPricePaddingCny = LOW_SOURCE_PRICE_PADDING_CNY,
  blockedBy1688 = false,
  lookupAttempts = [],
} = {}) {
  if (!lookup || !lookup.matched || !lookup.unitPriceCny) {
    return null;
  }

  const validation = validateResolvedSourceUnitPrice({
    unitPriceCny: lookup.unitPriceCny,
    itemInfo,
    item,
  });
  if (!validation.ok) {
    lookup.rejected = true;
    lookup.rejectReason = validation.reason;
    return null;
  }

  const lowLookupResolution = buildLowLookupSourcePriceResolution({
    unitPriceCny: lookup.unitPriceCny,
    lowPricePaddingThresholdCny,
    lowPricePaddingCny,
    blockedBy1688,
    source,
    lookup,
    lookupAttempts,
  });
  if (lowLookupResolution) {
    return buildCurrentSourcePriceFallbackAfterHighResolvedGuard({
      resolvedSourcePriceCny: lowLookupResolution.sourcePriceCny,
      itemInfo,
      item,
      blockedBy1688,
      lookup,
      lookupAttempts,
    }) || lowLookupResolution;
  }

  const hasFreight = lookup.freightPriceCny !== null && lookup.freightPriceCny !== undefined;
  const resolvedFreightCny = hasFreight
    ? normalizeCurrencyCny(lookup.freightPriceCny, weightFreightCny)
    : (ALLOW_ESTIMATED_FREIGHT_WITH_1688_UNIT ? weightFreightCny : null);
  if (resolvedFreightCny === null || resolvedFreightCny === undefined) {
    return null;
  }

  const resolvedSourcePriceCny = normalizeCurrencyCny(lookup.unitPriceCny + resolvedFreightCny);
  const highResolvedFallback = buildCurrentSourcePriceFallbackAfterHighResolvedGuard({
    resolvedSourcePriceCny,
    itemInfo,
    item,
    blockedBy1688,
    lookup,
    lookupAttempts,
  });
  if (highResolvedFallback) {
    return highResolvedFallback;
  }

  return {
    sourcePriceCny: resolvedSourcePriceCny,
    unitPriceCny: normalizeCurrencyCny(lookup.unitPriceCny),
    freightPriceCny: normalizeCurrencyCny(resolvedFreightCny, 0),
    sourcePriceAdjustmentCny: null,
    sourcePriceAdjustmentThresholdCny: null,
    blockedBy1688,
    source: hasFreight ? source : `${source}_plus_estimated_freight`,
    lookup,
    lookupAttempts,
  };
}

function shouldOverwriteSuspiciousOriginPrice(currentOriginPrice, forcedOriginPrice) {
  const current = normalizeCurrencyCny(currentOriginPrice, null);
  const forced = normalizeCurrencyCny(forcedOriginPrice, null);
  if (!current || !forced) {
    return false;
  }

  const directUseMax = parsePositiveNumber(SOURCE_PRICE_DIRECT_USE_MAX_CNY, 100);
  const suspiciousDelta = parsePositiveNumber(SOURCE_PRICE_SUSPICIOUS_OVERWRITE_DELTA_CNY, 50);
  const suspiciousMultiplier = parsePositiveNumber(SOURCE_PRICE_SUSPICIOUS_OVERWRITE_MULTIPLIER, 4);

  return current > directUseMax
    && current >= forced + suspiciousDelta
    && current >= forced * suspiciousMultiplier;
}

module.exports = {
  buildResolvedSourcePriceFromLookup,
  buildSkuOriginPriceSnapshot,
  collectRepresentativeOriginPrices,
  extractRepresentativeOriginPrice,
  hasSuspiciousHighSourcePrice,
  isSourcePriceTooHighForDirectUse,
  normalizeSourcePriceExtraCny,
  shouldOverwriteSuspiciousOriginPrice,
};
