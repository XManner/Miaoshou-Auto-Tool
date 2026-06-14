const {
  AMAZON_US_ORIGIN,
  extractAmazonAsin,
  normalizeAmazonProductUrl,
} = require('./amazon_url');

const DEFAULT_AMAZON_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitTerms(value = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitTerms(item)).filter(Boolean);
  }
  return String(value || '')
    .split(/[,，、\n\r\t]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildAmazonSearchUrl(keyword = '') {
  const url = new URL('/s', AMAZON_US_ORIGIN);
  url.searchParams.set('k', String(keyword || '').trim());
  return url.toString();
}

function parseAmazonPrice(value = '') {
  const text = String(value || '').replace(/,/g, '');
  const match = text.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function hasValidAmazonPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function parseAmazonRating(value = '') {
  const match = String(value || '').match(/([0-5](?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5
    ? Number(parsed.toFixed(1))
    : null;
}

function parseAmazonReviewCount(value = '') {
  const match = String(value || '').replace(/,/g, '').match(/(\d+)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatWeightText(weightGrams) {
  const grams = Number(weightGrams);
  if (!Number.isFinite(grams) || grams <= 0) {
    return '';
  }
  return `${Number(grams.toFixed(1))}g`;
}

function parseAmazonWeight(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || !/(weight|重量|ounces?|oz\.?|pounds?|lbs?|grams?|g\b|kilograms?|kg\b)/i.test(text)) {
    return { weightGrams: null, weightText: '' };
  }

  const labeledMatch = text.match(/(?:item|package|shipping|product|商品|包装)?\s*(?:weight|重量)[^0-9]{0,80}(\d+(?:\.\d+)?)\s*(kilograms?|kg|grams?|g|pounds?|lbs?|ounces?|oz\.?)/i);
  const looseMatch = text.match(/(\d+(?:\.\d+)?)\s*(kilograms?|kg|grams?|g|pounds?|lbs?|ounces?|oz\.?)/i);
  const match = labeledMatch || looseMatch;
  if (!match) {
    return { weightGrams: null, weightText: '' };
  }

  const amount = Number(match[1]);
  const unit = String(match[2] || '').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return { weightGrams: null, weightText: '' };
  }

  let weightGrams = amount;
  if (/kg|kilogram/.test(unit)) {
    weightGrams = amount * 1000;
  } else if (/pound|lbs?/.test(unit)) {
    weightGrams = amount * 453.59237;
  } else if (/ounce|oz/.test(unit)) {
    weightGrams = amount * 28.349523125;
  }

  weightGrams = Number(weightGrams.toFixed(1));
  return {
    weightGrams,
    weightText: formatWeightText(weightGrams),
  };
}

function normalizeAmazonDetailRecord(record = {}, candidate = {}) {
  const title = String(record.title || '').replace(/\s+/g, ' ').trim();
  const detailPriceUsd = parseAmazonPrice(record.priceText);
  const candidatePriceUsd = hasValidAmazonPrice(candidate.priceUsd)
    ? Number(candidate.priceUsd)
    : null;
  const hasDetailPrice = hasValidAmazonPrice(detailPriceUsd);
  const weight = parseAmazonWeight([
    record.weightText,
    record.detailText,
  ].filter(Boolean).join(' '));

  return {
    ...candidate,
    title: title || candidate.title || candidate.asin || '',
    priceUsd: hasDetailPrice ? detailPriceUsd : candidatePriceUsd,
    detailPriceUsd: hasDetailPrice ? detailPriceUsd : null,
    hasDetailPrice,
    weightGrams: weight.weightGrams,
    weightText: weight.weightText,
  };
}

function filterAmazonCandidatesWithDetailPrices(candidates = []) {
  const accepted = [];
  const skipped = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (candidate && candidate.hasDetailPrice === true && hasValidAmazonPrice(candidate.detailPriceUsd)) {
      accepted.push(candidate);
      continue;
    }
    skipped.push({
      ...candidate,
      reason: 'missing_amazon_detail_price',
    });
  }

  return { accepted, skipped };
}

function toAbsoluteAmazonUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `${AMAZON_US_ORIGIN}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function normalizeAmazonCandidateRecords(records = [], { keyword = '' } = {}) {
  const candidates = [];

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.sponsored) {
      continue;
    }
    const rawUrl = toAbsoluteAmazonUrl(record.url || '');
    const asin = extractAmazonAsin(record.asin || rawUrl);
    const url = normalizeAmazonProductUrl(asin || rawUrl);
    if (!asin || !url) {
      continue;
    }

    candidates.push({
      source: 'amazon',
      marketplace: 'US',
      asin,
      url,
      title: String(record.title || '').replace(/\s+/g, ' ').trim(),
      priceUsd: parseAmazonPrice(record.priceText),
      rating: parseAmazonRating(record.ratingText),
      reviewCount: parseAmazonReviewCount(record.reviewText),
      imageUrl: String(record.imageUrl || '').trim(),
      keyword,
      reason: 'Amazon search candidate',
    });
  }

  return candidates;
}

function filterAmazonCandidates(candidates = [], options = {}) {
  const accepted = [];
  const skipped = [];
  const seenAsins = new Set();
  const excludedTerms = splitTerms(options.excludedTerms);
  const maxPrice = Number(options.amazonMaxPriceUsd || 0);
  const minRating = Number(options.amazonMinRating || 0);
  const minReviewCount = Number(options.amazonMinReviewCount || 0);
  const count = Number.isFinite(Number(options.count)) && Number(options.count) > 0
    ? Number(options.count)
    : Infinity;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const asin = extractAmazonAsin(candidate.asin || candidate.url || '');
    const title = String(candidate.title || '');
    const lowerTitle = title.toLowerCase();
    const addSkipped = (reason) => {
      skipped.push({
        ...candidate,
        asin,
        reason,
      });
    };

    if (!asin || !candidate.url) {
      addSkipped('missing_asin_or_url');
      continue;
    }
    if (seenAsins.has(asin)) {
      addSkipped('duplicate_asin');
      continue;
    }

    const excludedTerm = excludedTerms.find((term) => lowerTitle.includes(String(term).toLowerCase()));
    if (excludedTerm) {
      seenAsins.add(asin);
      addSkipped(`excluded_term: ${excludedTerm}`);
      continue;
    }
    if (maxPrice > 0 && Number.isFinite(Number(candidate.priceUsd)) && Number(candidate.priceUsd) > maxPrice) {
      seenAsins.add(asin);
      addSkipped('price_above_max');
      continue;
    }
    if (minRating > 0 && Number.isFinite(Number(candidate.rating)) && Number(candidate.rating) < minRating) {
      seenAsins.add(asin);
      addSkipped('rating_below_min');
      continue;
    }
    if (minReviewCount > 0 && Number.isFinite(Number(candidate.reviewCount)) && Number(candidate.reviewCount) < minReviewCount) {
      seenAsins.add(asin);
      addSkipped('review_count_below_min');
      continue;
    }

    seenAsins.add(asin);
    if (accepted.length < count) {
      accepted.push({
        ...candidate,
        asin,
        url: normalizeAmazonProductUrl(asin),
      });
    }
  }

  return { accepted, skipped };
}

function detectAmazonAccessBlock(text = '', url = '') {
  const content = `${url || ''}\n${text || ''}`;
  return /validateCaptcha|robot\s*check|enter\s+the\s+characters\s+you\s+see\s+below|not\s+a\s+robot|captcha|sorry,\s*we\s+just\s+need\s+to\s+make\s+sure/i
    .test(content);
}

async function readAmazonPageText(page) {
  return page.evaluate(() => document.body ? document.body.innerText || document.body.textContent || '' : '');
}

async function searchAmazonKeyword(page, keyword, {
  timeoutMs = DEFAULT_AMAZON_TIMEOUT_MS,
} = {}) {
  const url = buildAmazonSearchUrl(keyword);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('body', { timeout: timeoutMs }).catch(() => {});
  const text = await readAmazonPageText(page).catch(() => '');
  if (detectAmazonAccessBlock(text, page.url())) {
    throw new Error('Amazon 要求人工验证，请在自动化 Chrome 中完成验证后重试。');
  }
  return url;
}

async function extractAmazonSearchCandidates(page, keyword = '', options = {}) {
  const rawRecords = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };
    const textOf = (element) => (element ? (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const rows = Array.from(document.querySelectorAll('[data-asin]'))
      .filter(isVisible)
      .filter((element) => /^[A-Z0-9]{10}$/i.test(element.getAttribute('data-asin') || ''));

    return rows.map((row) => {
      const titleElement = row.querySelector('h2 span, [data-cy="title-recipe"] span, .a-size-medium.a-color-base.a-text-normal, .a-size-base-plus.a-color-base.a-text-normal');
      const linkElement = row.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], h2 a');
      const priceElement = row.querySelector('.a-price .a-offscreen');
      const ratingElement = row.querySelector('.a-icon-alt');
      const reviewElement = row.querySelector('a[href*="customerReviews"] span, .s-underline-text');
      const imageElement = row.querySelector('img.s-image, img');
      const rowText = textOf(row);

      return {
        asin: row.getAttribute('data-asin') || '',
        title: textOf(titleElement),
        url: linkElement ? linkElement.getAttribute('href') || '' : '',
        priceText: textOf(priceElement),
        ratingText: textOf(ratingElement),
        reviewText: textOf(reviewElement),
        imageUrl: imageElement ? imageElement.getAttribute('src') || '' : '',
        sponsored: /(^|\s)(sponsored|sponsorisé|gesponsert|广告|赞助)(\s|$)/i.test(rowText),
      };
    });
  });

  const normalized = normalizeAmazonCandidateRecords(rawRecords, { keyword });
  return filterAmazonCandidates(normalized, options);
}

async function extractAmazonProductDetail(page, candidate = {}, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_AMAZON_TIMEOUT_MS;
  await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('body', { timeout: timeoutMs }).catch(() => {});
  const text = await readAmazonPageText(page).catch(() => '');
  if (detectAmazonAccessBlock(text, page.url())) {
    throw new Error('Amazon 要求人工验证，请在自动化 Chrome 中完成验证后重试。');
  }

  const rawRecord = await page.evaluate(() => {
    const textOf = (element) => (element ? (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const rowPairs = [];
    for (const row of Array.from(document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productOverview_feature_div tr, #prodDetails tr'))) {
      const label = textOf(row.querySelector('th, .a-span3, .a-color-secondary'));
      const value = textOf(row.querySelector('td, .a-span9, .a-color-base'));
      if (label || value) {
        rowPairs.push(`${label} ${value}`.trim());
      }
    }
    const bullets = Array.from(document.querySelectorAll('#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li'))
      .map((item) => textOf(item))
      .filter(Boolean);
    const weightText = [...rowPairs, ...bullets].find((line) => /(?:item|package|shipping|product)?\s*(?:weight|重量)/i.test(line)) || '';
    return {
      title: textOf(document.querySelector('#productTitle')),
      priceText: textOf(document.querySelector('#corePrice_feature_div .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen')),
      weightText,
      detailText: [...rowPairs, ...bullets].join(' '),
    };
  });

  return normalizeAmazonDetailRecord(rawRecord, candidate);
}

async function collectAmazonCandidatesFromKeywords(page, options = {}) {
  const keywords = splitTerms(options.keywords);
  const skipped = [];
  const candidates = [];
  const maxCandidates = Number.isFinite(Number(options.maxCandidates)) && Number(options.maxCandidates) > 0
    ? Number(options.maxCandidates)
    : 80;

  for (const keyword of keywords) {
    if (candidates.length >= options.count || candidates.length + skipped.length >= maxCandidates) {
      break;
    }
    await searchAmazonKeyword(page, keyword, options);
    await sleep(1200);

    for (let scrollIndex = 0; scrollIndex < 4; scrollIndex += 1) {
      const extracted = await extractAmazonSearchCandidates(page, keyword, options);
      candidates.push(...extracted.accepted);
      skipped.push(...extracted.skipped);
      if (candidates.length >= options.count || candidates.length + skipped.length >= maxCandidates) {
        break;
      }
      await page.evaluate(() => {
        window.scrollBy({ top: Math.max(500, Math.floor(window.innerHeight * 0.75)), left: 0, behavior: 'instant' });
      }).catch(() => {});
      await sleep(1000);
    }

    if (candidates.length === 0) {
      const text = await readAmazonPageText(page).catch(() => '');
      if (!/results|RESULTS|搜索结果/i.test(text)) {
        skipped.push({
          source: 'amazon',
          marketplace: 'US',
          keyword,
          reason: 'no_result_cards',
        });
      }
    }
  }

  const filtered = filterAmazonCandidates(candidates, options);
  return {
    candidates: filtered.accepted,
    skipped: [...skipped, ...filtered.skipped],
    reviewedCount: candidates.length + skipped.length,
  };
}

module.exports = {
  buildAmazonSearchUrl,
  collectAmazonCandidatesFromKeywords,
  detectAmazonAccessBlock,
  extractAmazonSearchCandidates,
  filterAmazonCandidatesWithDetailPrices,
  filterAmazonCandidates,
  normalizeAmazonCandidateRecords,
  normalizeAmazonDetailRecord,
  parseAmazonPrice,
  parseAmazonRating,
  parseAmazonReviewCount,
  parseAmazonWeight,
  extractAmazonProductDetail,
  searchAmazonKeyword,
};
