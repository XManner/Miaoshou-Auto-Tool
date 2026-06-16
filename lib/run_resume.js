const RESUMABLE_STATUSES = new Set(['error', 'stopped']);

function numberOrDefault(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canResumeRun(run = {}) {
  return Boolean(run && run.id && RESUMABLE_STATUSES.has(String(run.status || '')));
}

function remainingCount(total, completed) {
  const totalNumber = Math.max(0, numberOrDefault(total, 0));
  const completedNumber = Math.max(0, numberOrDefault(completed, 0));
  return Math.max(1, totalNumber - completedNumber);
}

function progressCompleted(run = {}) {
  return Math.max(0, numberOrDefault(run.progress && run.progress.completed, 0));
}

function uniqueTextList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

function normalizeProcessedFlashActivity(item = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const activityId = String(item.activityId || item.detailId || item.id || '').trim();
  const activityTitle = String(item.activityTitle || item.title || item.name || '').trim();
  if (!activityId && !activityTitle) {
    return null;
  }
  return { activityId, activityTitle };
}

function parseFlashActivityFromLogText(text = '') {
  const value = String(text || '').trim();
  const match = value.match(/开始处理活动：(.+?)（([^）]+)）/)
    || value.match(/开始处理活动：(.+?)\(([^)]+)\)/);
  if (!match) {
    return null;
  }
  const activityTitle = String(match[1] || '').trim();
  const activityId = String(match[2] || '').trim();
  if (!activityId && !activityTitle) {
    return null;
  }
  return { activityId, activityTitle };
}

function processedFlashActivitiesFromLogs(run = {}) {
  const completed = progressCompleted(run);
  if (completed <= 0 || !Array.isArray(run.logs)) {
    return [];
  }
  return run.logs
    .map((entry) => parseFlashActivityFromLogText(entry && entry.text))
    .filter(Boolean)
    .slice(0, completed);
}

function processedFlashActivities(run = {}) {
  const summary = run.summary || {};
  const candidates = [
    ...(Array.isArray(run.processedFlashActivities) ? run.processedFlashActivities : []),
    ...(Array.isArray(summary.results) ? summary.results : []),
    ...(summary.flash && Array.isArray(summary.flash.results) ? summary.flash.results : []),
    ...processedFlashActivitiesFromLogs(run),
  ];
  const existingSkipIds = uniqueTextList(run.skipFlashActivityIds || []);
  const records = candidates
    .map((item) => normalizeProcessedFlashActivity(item))
    .filter(Boolean);
  for (const activityId of existingSkipIds) {
    records.push({ activityId, activityTitle: '' });
  }

  const seen = new Set();
  return records.filter((item) => {
    const key = item.activityId || item.activityTitle;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isFlashPhase(run = {}) {
  const progress = run.progress || {};
  const phase = String(progress.phase || '');
  const phaseLabel = String(progress.phaseLabel || '');
  return phase === 'flash' || phaseLabel.includes('秒杀');
}

function baseResumeInput(run = {}) {
  return {
    accountId: run.account && run.account.id ? run.account.id : '',
  };
}

function buildFlashResumeInput(run = {}) {
  const completed = progressCompleted(run);
  const flashSelectionMode = run.flashSelectionMode || 'count';
  const processedActivities = processedFlashActivities(run);
  const skipFlashActivityIds = uniqueTextList(processedActivities.map((item) => item.activityId));
  return {
    ...baseResumeInput(run),
    tasks: { edit: false, flash: true },
    flashSelectionMode,
    flashCount: flashSelectionMode === 'all' ? 0 : remainingCount(run.flashCount || (run.progress && run.progress.total), completed),
    skipFlashActivityIds,
    processedFlashActivities: processedActivities,
  };
}

function buildCollectResumeInput(run = {}) {
  const completed = progressCompleted(run);
  return {
    ...baseResumeInput(run),
    tasks: { collect: true, edit: false, flash: false },
    collectSource: run.collectSource || '1688',
    collectCount: remainingCount(run.collectCount || (run.progress && run.progress.total), completed),
    collectDedupeWindowDays: run.collectDedupeWindowDays || 7,
    collectKeywords: run.collectKeywords || '',
    collectMaxPriceCny: run.collectMaxPriceCny,
    collectPreferredTerms: run.collectPreferredTerms || '',
    collectExcludedTerms: run.collectExcludedTerms || '',
    collectMinScore: run.collectMinScore,
    collectSafeMode: Boolean(run.collectSafeMode),
    collectLinks: run.collectLinks || '',
    collectShopeeSite: run.collectShopeeSite,
    collectShopeeMaxPrice: run.collectShopeeMaxPrice,
    collectShopeeMaxMoq: run.collectShopeeMaxMoq,
  };
}

function buildEditResumeInput(run = {}) {
  const completed = progressCompleted(run);
  const itemSelectionMode = run.itemSelectionMode || 'range';
  const originalStart = Math.max(1, numberOrDefault(run.itemStartIndex, 1));
  const originalEnd = Math.max(originalStart, numberOrDefault(run.itemEndIndex, originalStart));
  const nextStart = itemSelectionMode === 'range'
    ? Math.min(originalEnd, originalStart + completed)
    : originalStart;
  const count = itemSelectionMode === 'range'
    ? Math.max(1, originalEnd - nextStart + 1)
    : Math.max(1, numberOrDefault(run.count, 1));

  return {
    ...baseResumeInput(run),
    tasks: {
      edit: true,
      flash: Boolean(run.tasks && run.tasks.flash),
    },
    count,
    itemSelectionMode,
    itemStartIndex: nextStart,
    itemEndIndex: originalEnd,
    publish: Boolean(run.publish),
    sourcePriceExtraCny: run.sourcePriceExtraCny || 0,
    weightPaddingGrams: run.weightPaddingGrams,
    buyOneTakeOne: Boolean(run.buyOneTakeOne),
    processingMode: run.processingMode || 'fast',
    flashSelectionMode: run.flashSelectionMode || 'count',
    flashCount: run.flashCount || 1,
  };
}

function buildResumeRunInput(run = {}) {
  if (!canResumeRun(run)) {
    throw new Error('这个任务不能续跑。');
  }

  const tasks = run.tasks || {};
  if (tasks.flash && isFlashPhase(run)) {
    return buildFlashResumeInput(run);
  }
  if (tasks.collect) {
    return buildCollectResumeInput(run);
  }
  if (tasks.edit) {
    return buildEditResumeInput(run);
  }
  if (tasks.flash) {
    return buildFlashResumeInput(run);
  }

  throw new Error('这个任务缺少可续跑的任务类型。');
}

module.exports = {
  canResumeRun,
  buildResumeRunInput,
  processedFlashActivities,
};
