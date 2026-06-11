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

const DEFAULT_FALLBACK_WEIGHT = parseNumber(process.env.DEFAULT_FALLBACK_WEIGHT, 0.1);
const DEFAULT_MIN_GROSS_WEIGHT_KG = parseNumber(process.env.MIN_GROSS_WEIGHT_KG, 0.01);
const DEFAULT_MAX_GROSS_WEIGHT_KG = parseNumber(process.env.MAX_GROSS_WEIGHT_KG, 30);
const DEFAULT_MIN_FINAL_GROSS_WEIGHT_KG = Math.max(
  0,
  parseNumber(process.env.MIN_FINAL_GROSS_WEIGHT_GRAMS, 30) / 1000,
);
const DEFAULT_1688_WEIGHT_LOOKUP_THRESHOLD_KG = Math.max(
  DEFAULT_MIN_FINAL_GROSS_WEIGHT_KG,
  parseNumber(process.env.WEIGHT_1688_LOOKUP_THRESHOLD_GRAMS, 1000) / 1000,
);

function clampGrossWeightKg(valueKg, fallback = null) {
  const value = parsePositiveNumber(valueKg, fallback);
  if (!value) {
    return fallback;
  }

  const minWeight = parsePositiveNumber(DEFAULT_MIN_GROSS_WEIGHT_KG, 0.01);
  const maxWeight = parsePositiveNumber(DEFAULT_MAX_GROSS_WEIGHT_KG, 30);
  const clamped = Math.min(maxWeight, Math.max(minWeight, value));
  return Number(clamped.toFixed(3));
}

function enforceMinimumFinalGrossWeightKg(valueKg, fallback = null) {
  const value = clampGrossWeightKg(valueKg, fallback);
  if (!value) {
    return fallback;
  }
  const minWeight = parsePositiveNumber(DEFAULT_MIN_FINAL_GROSS_WEIGHT_KG, 0.03);
  return Number(Math.max(minWeight, value).toFixed(3));
}

function isGrossWeightTooHighForDirectUse(valueKg) {
  const value = clampGrossWeightKg(valueKg, null);
  const threshold = parsePositiveNumber(DEFAULT_1688_WEIGHT_LOOKUP_THRESHOLD_KG, 5);
  return Boolean(value && threshold && value > threshold);
}

function normalizeWeightUnitToKg(value, unit = '') {
  const numeric = parsePositiveNumber(value);
  if (!numeric) {
    return null;
  }

  const normalizedUnit = String(unit || '').toLowerCase();
  if (/^(g|gram|grams|克|ml|毫升|g\/ml)$/.test(normalizedUnit)) {
    return numeric / 1000;
  }
  return numeric;
}

function chooseGrossWeightKg({
  currentWeightKg,
  estimatedGrossWeightKg,
  estimateSource,
  estimateConfidence,
} = {}) {
  const current = clampGrossWeightKg(currentWeightKg, null);
  const estimated = clampGrossWeightKg(estimatedGrossWeightKg, null);
  if (!estimated) {
    return enforceMinimumFinalGrossWeightKg(current, current);
  }
  if (!current) {
    return enforceMinimumFinalGrossWeightKg(estimated, estimated);
  }

  if (
    isGrossWeightTooHighForDirectUse(current)
    || String(estimateSource || '').startsWith('source_url_')
    || String(estimateSource || '').startsWith('1688_')
  ) {
    return enforceMinimumFinalGrossWeightKg(estimated, estimated);
  }

  const diff = Math.abs(estimated - current);
  const relativeDiff = diff / current;
  const confidence = String(estimateConfidence || '').toLowerCase();

  if (diff <= 0.01 || relativeDiff <= 0.2) {
    return enforceMinimumFinalGrossWeightKg(current, current);
  }
  if (confidence === 'high') {
    return enforceMinimumFinalGrossWeightKg(estimated, estimated);
  }
  if (confidence === 'medium' && relativeDiff >= 0.5) {
    return enforceMinimumFinalGrossWeightKg(estimated, estimated);
  }

  return enforceMinimumFinalGrossWeightKg(current, current);
}

function resolveFallbackWeight(itemInfo = {}, skuMap = {}) {
  const itemWeight = parsePositiveNumber(itemInfo.weight);
  if (itemWeight) {
    return itemWeight;
  }

  for (const skuValue of Object.values(skuMap || {})) {
    const skuWeight = parsePositiveNumber(skuValue && skuValue.weight);
    if (skuWeight) {
      return skuWeight;
    }
  }

  return parsePositiveNumber(DEFAULT_FALLBACK_WEIGHT, 0.1);
}

module.exports = {
  clampGrossWeightKg,
  enforceMinimumFinalGrossWeightKg,
  isGrossWeightTooHighForDirectUse,
  normalizeWeightUnitToKg,
  chooseGrossWeightKg,
  resolveFallbackWeight,
};
