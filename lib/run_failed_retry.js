function uniqueTextList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

function summaryFailedItems(run = {}) {
  const summary = run.summary || {};
  const nested = [
    ...(Array.isArray(summary.failedItems) ? summary.failedItems : []),
    ...(summary.edit && Array.isArray(summary.edit.failedItems) ? summary.edit.failedItems : []),
    ...(summary.flash && Array.isArray(summary.flash.failedItems) ? summary.flash.failedItems : []),
    ...(summary.collect && Array.isArray(summary.collect.failedItems) ? summary.collect.failedItems : []),
  ];
  const resultFailures = (Array.isArray(summary.results) ? summary.results : []).filter((item) => (
    item
    && (item.error || Number(item.failedCount || 0) > 0 || Number(item.errorCount || 0) > 0)
  ));
  return [...nested, ...resultFailures];
}

function failedDetailIds(run = {}) {
  return uniqueTextList(summaryFailedItems(run).map((item) => item.detailId || item.productId || item.itemId));
}

function failedActivityIds(run = {}) {
  return uniqueTextList(summaryFailedItems(run).map((item) => item.activityId || item.detailId));
}

function failedCollectLinks(run = {}) {
  return uniqueTextList(summaryFailedItems(run).map((item) => (
    item.url || item.link || item.sourceUrl || item.productUrl || item.detailUrl
  )));
}

function canRetryFailedItems(run = {}) {
  if (!run || !run.id || !['error', 'stopped'].includes(String(run.status || ''))) {
    return false;
  }
  const tasks = run.tasks || {};
  if (tasks.flash && !tasks.edit) {
    return failedActivityIds(run).length > 0;
  }
  if (tasks.edit) {
    return failedDetailIds(run).length > 0;
  }
  if (tasks.collect) {
    return failedCollectLinks(run).length > 0;
  }
  return false;
}

function buildFailedItemRetryInput(run = {}) {
  if (!canRetryFailedItems(run)) {
    throw new Error('没有可重跑的失败项。');
  }
  const base = {
    accountId: run.account && run.account.id ? run.account.id : '',
    retrySourceRunId: run.id,
  };
  const tasks = run.tasks || {};
  if (tasks.flash && !tasks.edit) {
    const ids = failedActivityIds(run);
    return {
      ...base,
      tasks: { edit: false, flash: true },
      flashSelectionMode: 'ids',
      flashActivityIds: ids,
      flashCount: ids.length,
    };
  }
  if (tasks.collect) {
    const links = failedCollectLinks(run);
    return {
      ...base,
      tasks: { collect: true, edit: false, flash: false },
      collectSource: 'links',
      collectLinks: links.join('\n'),
      collectCount: links.length,
      count: links.length,
    };
  }
  const ids = failedDetailIds(run);
  return {
    ...base,
    tasks: { edit: true, flash: false },
    detailIds: ids,
    count: ids.length,
    itemSelectionMode: 'range',
    itemStartIndex: 1,
    itemEndIndex: ids.length,
    publish: Boolean(run.publish),
    sourcePriceExtraCny: run.sourcePriceExtraCny || 0,
    weightPaddingGrams: run.weightPaddingGrams,
    buyOneTakeOne: Boolean(run.buyOneTakeOne),
    buyOneTakeOnePriceMarkupPercent: run.buyOneTakeOnePriceMarkupPercent ?? 90,
    processingMode: run.processingMode || 'fast',
  };
}

module.exports = {
  canRetryFailedItems,
  buildFailedItemRetryInput,
  failedDetailIds,
  failedActivityIds,
  failedCollectLinks,
};
