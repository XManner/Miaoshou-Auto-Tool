const AMAZON_US_ORIGIN = 'https://www.amazon.com';
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

function normalizeRawInput(value = '') {
  return String(value || '').trim();
}

function isAmazonUsHost(hostname = '') {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'amazon.com' || normalized.endsWith('.amazon.com');
}

function normalizeAsin(value = '') {
  const raw = normalizeRawInput(value).toUpperCase();
  return ASIN_PATTERN.test(raw) ? raw : '';
}

function extractAsinFromPath(pathname = '') {
  const path = String(pathname || '');
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/exec\/obidos\/ASIN\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/product-reviews\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = path.match(pattern);
    if (match) {
      return normalizeAsin(match[1]);
    }
  }

  return '';
}

function tryParseAmazonUrl(rawInput = '') {
  const raw = normalizeRawInput(rawInput);
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    return isAmazonUsHost(parsed.hostname) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function extractAmazonAsin(input = '') {
  const raw = normalizeRawInput(input);
  const directAsin = normalizeAsin(raw);
  if (directAsin) {
    return directAsin;
  }

  const parsed = tryParseAmazonUrl(raw);
  if (!parsed) {
    return '';
  }

  const pathAsin = extractAsinFromPath(parsed.pathname);
  if (pathAsin) {
    return pathAsin;
  }

  for (const key of ['asin', 'ASIN']) {
    const queryAsin = normalizeAsin(parsed.searchParams.get(key));
    if (queryAsin) {
      return queryAsin;
    }
  }

  for (const key of ['url', 'u']) {
    const nested = parsed.searchParams.get(key);
    if (!nested) {
      continue;
    }
    const nestedUrl = nested.startsWith('http')
      ? nested
      : `${AMAZON_US_ORIGIN}${nested.startsWith('/') ? nested : `/${nested}`}`;
    const nestedAsin = extractAmazonAsin(nestedUrl);
    if (nestedAsin) {
      return nestedAsin;
    }
  }

  return '';
}

function normalizeAmazonProductUrl(input = '') {
  const asin = extractAmazonAsin(input);
  return asin ? `${AMAZON_US_ORIGIN}/dp/${asin}` : '';
}

function isLikelyAmazonProductUrl(input = '') {
  const parsed = tryParseAmazonUrl(input);
  return Boolean(parsed && extractAmazonAsin(input));
}

function splitAmazonProductInputs(value = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitAmazonProductInputs(item));
  }

  return String(value || '')
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAmazonProductInputs(value = []) {
  const seen = new Set();
  const normalized = [];

  for (const input of splitAmazonProductInputs(value)) {
    const asin = extractAmazonAsin(input);
    if (!asin || seen.has(asin)) {
      continue;
    }
    seen.add(asin);
    normalized.push({
      input,
      asin,
      url: `${AMAZON_US_ORIGIN}/dp/${asin}`,
    });
  }

  return normalized;
}

module.exports = {
  AMAZON_US_ORIGIN,
  extractAmazonAsin,
  isLikelyAmazonProductUrl,
  normalizeAmazonProductInputs,
  normalizeAmazonProductUrl,
  splitAmazonProductInputs,
};
