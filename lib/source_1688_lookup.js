const {
  extractFirstValidPriceFromText,
  extractFreightPriceFromText,
  resolveGrossWeightFromText,
} = require('./source_price_weight');
const { clampGrossWeightKg } = require('./gross_weight_rules');

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

const DEFAULT_1688_LOOKUP_TIMEOUT_MS = parsePositiveInteger(process.env.DEFAULT_1688_LOOKUP_TIMEOUT_MS, 12000);
const DEFAULT_1688_ESTIMATED_SHIPPING_BASE_CNY = parseNumber(process.env.DEFAULT_1688_ESTIMATED_SHIPPING_BASE_CNY, 2.5);
const DEFAULT_1688_ESTIMATED_SHIPPING_PER_KG_CNY = parseNumber(process.env.DEFAULT_1688_ESTIMATED_SHIPPING_PER_KG_CNY, 5);
const DEFAULT_1688_ESTIMATED_SHIPPING_MIN_CNY = parseNumber(process.env.DEFAULT_1688_ESTIMATED_SHIPPING_MIN_CNY, 1);

function normalizeCurrencyCny(value, fallback = null) {
  const numeric = parsePositiveNumber(value, fallback);
  if (!numeric) {
    return fallback;
  }
  return Number(Number(numeric).toFixed(2));
}

function normalizeLookupUrl(url = '') {
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

function is1688AntiBotBlocked(text = '', url = '') {
  const content = `${String(url || '')}\n${String(text || '')}`;
  return [
    /_____tmd_____/i,
    /x5secdata/i,
    /captcha/i,
    /verify/i,
    /intercept/i,
    /sessionStorage\.x5referer/i,
    /punish\?/i,
  ].some((pattern) => pattern.test(content));
}

function extractFirst1688OfferUrl(text = '') {
  const match = String(text || '').match(/https?:\/\/detail\.1688\.com\/offer\/\d+\.html[^\s"'<>]*/i);
  if (!match) {
    return '';
  }
  try {
    return new URL(match[0]).toString();
  } catch (error) {
    return match[0];
  }
}

function build1688RequestHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

async function fetchHtmlText(url, timeoutMs = DEFAULT_1688_LOOKUP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: build1688RequestHeaders(),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      text: '',
      error: error.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function estimateDomesticFreightByWeight(weightKg) {
  const normalizedWeight = clampGrossWeightKg(weightKg, null);
  const estimated = normalizedWeight
    ? DEFAULT_1688_ESTIMATED_SHIPPING_BASE_CNY + normalizedWeight * DEFAULT_1688_ESTIMATED_SHIPPING_PER_KG_CNY
    : DEFAULT_1688_ESTIMATED_SHIPPING_BASE_CNY;
  return normalizeCurrencyCny(
    Math.max(DEFAULT_1688_ESTIMATED_SHIPPING_MIN_CNY, estimated),
    DEFAULT_1688_ESTIMATED_SHIPPING_MIN_CNY,
  );
}

function isLikely1688Url(url = '') {
  try {
    const parsed = new URL(String(url || '').trim());
    return /(^|\.)1688\.com$/i.test(parsed.hostname);
  } catch (error) {
    return false;
  }
}

async function loadOfferTextFromSearchPage({
  baseText = '',
  baseFinalUrl = '',
  preferOfferFirst = false,
  fetchText = fetchHtmlText,
} = {}) {
  const offerUrl = extractFirst1688OfferUrl(baseText);
  let mergedText = baseText;

  if (offerUrl && normalizeLookupUrl(offerUrl) !== normalizeLookupUrl(baseFinalUrl)) {
    const offerPage = await fetchText(offerUrl);
    if (offerPage.ok && !is1688AntiBotBlocked(offerPage.text, offerPage.finalUrl)) {
      mergedText = preferOfferFirst
        ? `${offerPage.text}\n${mergedText}`
        : `${mergedText}\n${offerPage.text}`;
    }
  }

  return { offerUrl, mergedText };
}

async function tryResolve1688UnitAndFreightByImage({
  imageUrl,
  fetchText = fetchHtmlText,
} = {}) {
  if (!imageUrl) {
    return {
      matched: false,
      blocked: false,
      reason: 'missing_image',
    };
  }

  const searchUrl = `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageAddress=${encodeURIComponent(imageUrl)}`;
  const searchPage = await fetchText(searchUrl);

  if (!searchPage.ok) {
    return {
      matched: false,
      blocked: false,
      reason: `search_http_${searchPage.status}`,
      searchUrl,
    };
  }

  if (is1688AntiBotBlocked(searchPage.text, searchPage.finalUrl)) {
    return {
      matched: false,
      blocked: true,
      reason: '1688_antibot',
      searchUrl,
    };
  }

  const { offerUrl, mergedText } = await loadOfferTextFromSearchPage({
    baseText: searchPage.text,
    baseFinalUrl: searchPage.finalUrl,
    preferOfferFirst: true,
    fetchText,
  });
  const unitPriceCny = extractFirstValidPriceFromText(mergedText);
  const freightPriceCny = extractFreightPriceFromText(mergedText);

  if (!unitPriceCny) {
    return {
      matched: false,
      blocked: false,
      reason: 'price_not_found',
      searchUrl,
      offerUrl,
    };
  }

  return {
    matched: true,
    blocked: false,
    source: '1688_image_search',
    searchUrl,
    offerUrl,
    unitPriceCny,
    freightPriceCny,
  };
}

async function tryResolve1688UnitAndFreightBySourceUrl({
  sourceUrl,
  fetchText = fetchHtmlText,
} = {}) {
  if (!sourceUrl) {
    return {
      matched: false,
      blocked: false,
      reason: 'missing_source_url',
    };
  }
  if (!isLikely1688Url(sourceUrl)) {
    return {
      matched: false,
      blocked: false,
      reason: 'source_url_not_1688',
      sourceUrl,
    };
  }

  const sourcePage = await fetchText(sourceUrl);
  if (!sourcePage.ok) {
    return {
      matched: false,
      blocked: false,
      reason: `source_http_${sourcePage.status}`,
      sourceUrl,
    };
  }
  if (is1688AntiBotBlocked(sourcePage.text, sourcePage.finalUrl)) {
    return {
      matched: false,
      blocked: true,
      reason: '1688_antibot',
      sourceUrl,
    };
  }

  const { offerUrl, mergedText } = await loadOfferTextFromSearchPage({
    baseText: sourcePage.text,
    baseFinalUrl: sourcePage.finalUrl,
    fetchText,
  });
  const unitPriceCny = extractFirstValidPriceFromText(mergedText);
  const freightPriceCny = extractFreightPriceFromText(mergedText);

  if (!unitPriceCny) {
    return {
      matched: false,
      blocked: false,
      reason: 'price_not_found',
      sourceUrl,
      offerUrl,
    };
  }

  return {
    matched: true,
    blocked: false,
    source: '1688_source_url',
    sourceUrl,
    offerUrl,
    unitPriceCny,
    freightPriceCny,
  };
}

async function tryResolve1688GrossWeightBySourceUrl({
  sourceUrl,
  fetchText = fetchHtmlText,
} = {}) {
  if (!sourceUrl) {
    return {
      matched: false,
      blocked: false,
      reason: 'missing_source_url',
    };
  }
  if (!isLikely1688Url(sourceUrl)) {
    return {
      matched: false,
      blocked: false,
      reason: 'source_url_not_1688',
      sourceUrl,
    };
  }

  const sourcePage = await fetchText(sourceUrl);
  if (!sourcePage.ok) {
    return {
      matched: false,
      blocked: false,
      reason: `source_http_${sourcePage.status}`,
      sourceUrl,
    };
  }
  if (is1688AntiBotBlocked(sourcePage.text, sourcePage.finalUrl)) {
    return {
      matched: false,
      blocked: true,
      reason: '1688_antibot',
      sourceUrl,
    };
  }

  const { offerUrl, mergedText } = await loadOfferTextFromSearchPage({
    baseText: sourcePage.text,
    baseFinalUrl: sourcePage.finalUrl,
    fetchText,
  });
  const resolvedWeight = resolveGrossWeightFromText(mergedText, {
    grossSource: '1688_source_url_gross',
    netSource: '1688_source_url_net_estimated_to_gross',
  });

  if (!resolvedWeight || !resolvedWeight.weightKg) {
    return {
      matched: false,
      blocked: false,
      reason: 'weight_not_found',
      sourceUrl,
      offerUrl,
    };
  }

  return {
    matched: true,
    blocked: false,
    source: resolvedWeight.source,
    sourceUrl,
    offerUrl,
    weightKg: resolvedWeight.weightKg,
    evidence: resolvedWeight.evidence,
  };
}

async function tryResolve1688GrossWeightByImage({
  imageUrl,
  fetchText = fetchHtmlText,
} = {}) {
  if (!imageUrl) {
    return {
      matched: false,
      blocked: false,
      reason: 'missing_image',
    };
  }

  const searchUrl = `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageAddress=${encodeURIComponent(imageUrl)}`;
  const searchPage = await fetchText(searchUrl);

  if (!searchPage.ok) {
    return {
      matched: false,
      blocked: false,
      reason: `search_http_${searchPage.status}`,
      searchUrl,
    };
  }

  if (is1688AntiBotBlocked(searchPage.text, searchPage.finalUrl)) {
    return {
      matched: false,
      blocked: true,
      reason: '1688_antibot',
      searchUrl,
    };
  }

  const { offerUrl, mergedText } = await loadOfferTextFromSearchPage({
    baseText: searchPage.text,
    baseFinalUrl: searchPage.finalUrl,
    preferOfferFirst: true,
    fetchText,
  });
  const resolvedWeight = resolveGrossWeightFromText(mergedText, {
    grossSource: '1688_image_search_gross',
    netSource: '1688_image_search_net_estimated_to_gross',
  });

  if (!resolvedWeight || !resolvedWeight.weightKg) {
    return {
      matched: false,
      blocked: false,
      reason: 'weight_not_found',
      searchUrl,
      offerUrl,
    };
  }

  return {
    matched: true,
    blocked: false,
    source: resolvedWeight.source,
    searchUrl,
    offerUrl,
    weightKg: resolvedWeight.weightKg,
    evidence: resolvedWeight.evidence,
  };
}

module.exports = {
  build1688RequestHeaders,
  estimateDomesticFreightByWeight,
  extractFirst1688OfferUrl,
  fetchHtmlText,
  is1688AntiBotBlocked,
  isLikely1688Url,
  tryResolve1688GrossWeightByImage,
  tryResolve1688GrossWeightBySourceUrl,
  tryResolve1688UnitAndFreightByImage,
  tryResolve1688UnitAndFreightBySourceUrl,
};
