function normalizeSourceUrl(url = '') {
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

function extractImageUrlsFromNotes(notes = '') {
  return [...String(notes).matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1]);
}

function collectStringValues(value, output = [], maxCount = 5000) {
  if (output.length >= maxCount || value === null || value === undefined) {
    return output;
  }

  if (typeof value === 'string') {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, output, maxCount);
      if (output.length >= maxCount) {
        break;
      }
    }
    return output;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStringValues(item, output, maxCount);
      if (output.length >= maxCount) {
        break;
      }
    }
  }

  return output;
}

function extractUrlsFromText(text = '') {
  return [...String(text || '').matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => match[0]);
}

function uniqueUrlList(urls = []) {
  const seen = new Set();
  const unique = [];

  for (const rawUrl of Array.isArray(urls) ? urls : []) {
    const normalized = normalizeSourceUrl(rawUrl);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function dedupeImageUrls(imageUrls = []) {
  return uniqueUrlList(imageUrls);
}

function extractPrimaryProductImageUrl(item = {}, itemInfo = {}) {
  const noteImageUrls = extractImageUrlsFromNotes(itemInfo.notes || '');
  const candidateUrls = uniqueUrlList([
    ...(Array.isArray(itemInfo.imgUrls) ? itemInfo.imgUrls : []),
    ...noteImageUrls,
    item.thumbnail,
    item.imgUrl,
    item.mainImage,
  ]);
  return candidateUrls[0] || '';
}

function extractSourceProductUrl(item = {}, itemInfo = {}) {
  const directCandidates = [
    item.sourceUrl,
    item.sourceLink,
    item.originUrl,
    item.originLink,
    item.url,
    item.link,
    itemInfo.sourceUrl,
    itemInfo.sourceLink,
    itemInfo.originUrl,
    itemInfo.originLink,
    itemInfo.url,
    itemInfo.link,
  ];
  const notesHrefLinks = [...String(itemInfo.notes || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1]);
  const freeTextUrls = collectStringValues({ item, itemInfo })
    .flatMap((text) => extractUrlsFromText(text));
  const allCandidates = uniqueUrlList([
    ...directCandidates,
    ...notesHrefLinks,
    ...freeTextUrls,
  ]);
  const preferred = allCandidates.find((url) => /1688\.com|alibaba\.com|taobao\.com/i.test(url));

  return preferred || allCandidates[0] || '';
}

function collectSkuImageUrlsFromPropertyList(skuPropertyList = []) {
  const imageUrls = [];

  for (const property of Array.isArray(skuPropertyList) ? skuPropertyList : []) {
    for (const value of Array.isArray(property && property.attrValueList) ? property.attrValueList : []) {
      if (value && value.imgUrl) {
        imageUrls.push(value.imgUrl);
      }
      if (Array.isArray(value && value.supplementarySkuImageUrls)) {
        imageUrls.push(...value.supplementarySkuImageUrls);
      }
    }
  }

  return dedupeImageUrls(imageUrls);
}

module.exports = {
  collectSkuImageUrlsFromPropertyList,
  collectStringValues,
  dedupeImageUrls,
  extractImageUrlsFromNotes,
  extractPrimaryProductImageUrl,
  extractSourceProductUrl,
  extractUrlsFromText,
  normalizeSourceUrl,
  uniqueUrlList,
};
