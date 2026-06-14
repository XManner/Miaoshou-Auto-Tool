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
  return {
    ...baseResumeInput(run),
    tasks: { edit: false, flash: true },
    flashSelectionMode,
    flashCount: flashSelectionMode === 'all' ? 0 : remainingCount(run.flashCount || (run.progress && run.progress.total), completed),
  };
}

function buildCollectResumeInput(run = {}) {
  const completed = progressCompleted(run);
  return {
    ...baseResumeInput(run),
    tasks: { collect: true, edit: false, flash: false },
    collectSource: run.collectSource || '1688',
    collectCount: remainingCount(run.collectCount || (run.progress && run.progress.total), completed),
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
};
