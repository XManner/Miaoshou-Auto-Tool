const fs = require('fs');
const path = require('path');
const {
  extractAmazonAsin,
  normalizeAmazonProductUrl,
} = require('./amazon_url');

const DEFAULT_COLLECTION_DEDUPE_PATH = path.join(__dirname, '..', '.collection-dedupe.json');
const DEFAULT_DEDUPE_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeSource(source = '') {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'amazon' || normalized === 'shopee' || normalized === '1688') {
    return normalized;
  }
  return '';
}

function parseDateMs(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeWindowDays(value = DEFAULT_DEDUPE_WINDOW_DAYS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEDUPE_WINDOW_DAYS;
}

function extract1688OfferId(value = '') {
  const text = String(value || '');
  const match = text.match(/\/offer\/(\d+)\.html/i) || text.match(/[?&]offerId=(\d+)/i);
  return match ? match[1] : '';
}

function extractShopeeProductKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const pathText = url.pathname;
    const match = pathText.match(/-i\.(\d+)\.(\d+)/i) || pathText.match(/\/product\/(\d+)\/(\d+)/i);
    return match ? `${host}:${match[1]}:${match[2]}` : '';
  } catch (error) {
    return '';
  }
}

function sourceUrlForItem(item = {}, source = '') {
  if (!item || typeof item !== 'object') {
    return String(item || '');
  }
  if (source === 'amazon') {
    return item.amazonUrl || item.url || '';
  }
  if (source === 'shopee') {
    return item.shopeeUrl || item.url || '';
  }
  if (source === '1688') {
    return item.source1688Url || item.url || '';
  }
  return item.url || item.amazonUrl || item.shopeeUrl || item.source1688Url || '';
}

function buildCollectionDedupeKey(item = {}, source = '') {
  const collectSource = normalizeSource(source);
  const url = sourceUrlForItem(item, collectSource);

  if (collectSource === 'amazon') {
    const asin = extractAmazonAsin((item && item.asin) || url);
    return asin ? `amazon:${asin}` : '';
  }
  if (collectSource === '1688') {
    const offerId = extract1688OfferId(url);
    return offerId ? `1688:${offerId}` : '';
  }
  if (collectSource === 'shopee') {
    const productKey = extractShopeeProductKey(url);
    return productKey ? `shopee:${productKey}` : '';
  }
  return '';
}

function normalizeCollectionDedupeRecord(record = {}) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const key = String(record.key || '').trim();
  const source = normalizeSource(record.source);
  const collectedAt = record.collectedAt || '';
  if (!key || !source || !parseDateMs(collectedAt)) {
    return null;
  }
  return {
    key,
    source,
    url: String(record.url || ''),
    title: String(record.title || ''),
    collectedAt,
    runId: String(record.runId || ''),
    commonCollectBoxDetailId: record.commonCollectBoxDetailId || null,
    platformCollectBoxDetailId: record.platformCollectBoxDetailId || null,
  };
}

function isWithinDedupeWindow(record, { now = new Date().toISOString(), windowDays = DEFAULT_DEDUPE_WINDOW_DAYS } = {}) {
  const collectedAtMs = parseDateMs(record && record.collectedAt);
  if (!collectedAtMs) {
    return false;
  }
  const nowMs = parseDateMs(now) || Date.now();
  const cutoffMs = nowMs - normalizeWindowDays(windowDays) * MS_PER_DAY;
  return collectedAtMs >= cutoffMs && collectedAtMs <= nowMs + MS_PER_DAY;
}

function loadCollectionDedupeRecords(options = {}) {
  const filePath = options.filePath || DEFAULT_COLLECTION_DEDUPE_PATH;
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records)) {
      return [];
    }
    return records
      .map((record) => normalizeCollectionDedupeRecord(record))
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function saveCollectionDedupeRecords(records = [], options = {}) {
  const filePath = options.filePath || DEFAULT_COLLECTION_DEDUPE_PATH;
  const now = options.now || new Date().toISOString();
  const windowDays = normalizeWindowDays(options.windowDays);
  const seen = new Set();
  const normalizedRecords = (Array.isArray(records) ? records : [])
    .map((record) => normalizeCollectionDedupeRecord(record))
    .filter(Boolean)
    .filter((record) => isWithinDedupeWindow(record, { now, windowDays }))
    .filter((record) => {
      if (seen.has(record.key)) {
        return false;
      }
      seen.add(record.key);
      return true;
    });

  const payload = {
    version: 1,
    savedAt: now,
    windowDays,
    records: normalizedRecords,
  };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    return false;
  }
}

function filterRecentCollectionDuplicates(candidates = [], options = {}) {
  const source = normalizeSource(options.source);
  const now = options.now || new Date().toISOString();
  const windowDays = normalizeWindowDays(options.windowDays);
  const records = options.records || loadCollectionDedupeRecords(options);
  const recentByKey = new Map();

  for (const record of records) {
    if (isWithinDedupeWindow(record, { now, windowDays })) {
      recentByKey.set(record.key, record);
    }
  }

  const accepted = [];
  const duplicates = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = buildCollectionDedupeKey(candidate, source);
    const existing = key ? recentByKey.get(key) : null;
    if (!existing) {
      accepted.push(candidate);
      continue;
    }
    duplicates.push({
      ...candidate,
      dedupeKey: key,
      collectedAt: existing.collectedAt,
      reason: `最近 ${windowDays} 天已采集，采集时间：${existing.collectedAt}`,
    });
  }

  return { accepted, duplicates };
}

function buildCollectionDedupeRecord(item = {}, options = {}) {
  const source = normalizeSource(options.source);
  const key = buildCollectionDedupeKey(item, source);
  if (!key) {
    return null;
  }
  const url = source === 'amazon'
    ? normalizeAmazonProductUrl((item && item.asin) || sourceUrlForItem(item, source)) || sourceUrlForItem(item, source)
    : sourceUrlForItem(item, source);
  return {
    key,
    source,
    url,
    title: String((item && item.title) || ''),
    collectedAt: options.collectedAt || new Date().toISOString(),
    runId: String(options.runId || ''),
    commonCollectBoxDetailId: item.commonCollectBoxDetailId || null,
    platformCollectBoxDetailId: item.platformCollectBoxDetailId || null,
  };
}

function markCollectedItems(items = [], options = {}) {
  const source = normalizeSource(options.source);
  const existing = loadCollectionDedupeRecords(options);
  const saveOptions = {
    ...options,
    now: options.now || options.collectedAt,
  };
  const nextRecords = [];
  const newRecords = (Array.isArray(items) ? items : [])
    .filter((item) => item && !item.error)
    .map((item) => buildCollectionDedupeRecord(item, options))
    .filter(Boolean);
  const newKeys = new Set(newRecords.map((record) => record.key));

  for (const record of newRecords) {
    nextRecords.push(record);
  }
  for (const record of existing) {
    if (!newKeys.has(record.key)) {
      nextRecords.push(record);
    }
  }

  saveCollectionDedupeRecords(nextRecords, saveOptions);
  return newRecords.filter((record) => record.source === source);
}

module.exports = {
  DEFAULT_COLLECTION_DEDUPE_PATH,
  DEFAULT_DEDUPE_WINDOW_DAYS,
  buildCollectionDedupeKey,
  filterRecentCollectionDuplicates,
  loadCollectionDedupeRecords,
  markCollectedItems,
  saveCollectionDedupeRecords,
};
