function formatItemScope(options = {}) {
  if (Array.isArray(options.detailIds) && options.detailIds.length > 0) {
    return `指定商品 ID ${options.detailIds.length} 个`;
  }
  if (options.itemSelectionMode === 'all') {
    return '全部商品';
  }
  const start = Number(options.itemStartIndex || 1);
  const end = Number(options.itemEndIndex || options.count || start);
  return start === end ? `第 ${start} 个商品` : `第 ${start}-${end} 个商品`;
}

function formatFlashScope(options = {}) {
  if (Array.isArray(options.flashActivityIds) && options.flashActivityIds.length > 0) {
    return `指定活动 ID ${options.flashActivityIds.length} 个`;
  }
  if (options.flashSelectionMode === 'all') {
    return '全部进行中活动';
  }
  return `${options.flashCount || 0} 个活动`;
}

function buildProductPreview(options = {}) {
  return [
    `处理范围：${formatItemScope(options)}`,
    `处理模式：${options.processingMode === 'precise' ? '精细模式' : '快速模式'}`,
    `发布开关：${options.publish ? '发布' : '不发布'}`,
    `价格加价 ${Number(options.sourcePriceExtraCny || 0)} 元`,
    `重量加重 ${Number(options.weightPaddingGrams || 0)} g`,
    `买一送一规格：${options.buyOneTakeOne ? '添加' : '不添加'}`,
    options.buyOneTakeOne ? '标题开头会加入 Buy 1 Take 1' : '标题按原编辑规则处理',
  ];
}

function buildRunPrecheck({ options = {}, account = null } = {}) {
  const blockers = [];
  const warnings = [];
  const tasks = options.tasks || {};

  if (!account) {
    blockers.push('没有找到可用账号，请先在账户配置里保存妙手账号。');
  } else if (account.complete === false) {
    blockers.push('当前账号缺少 App ID 或 App Secret。');
  }

  if (!tasks.collect && !tasks.edit && !tasks.flash) {
    blockers.push('没有选择要执行的任务。');
  }

  if (tasks.collect && !String(options.collectKeywords || options.collectLinks || '').trim()) {
    warnings.push('采集任务没有关键词或链接，可能无法开始。');
  }

  const lines = [];
  let title = '任务预检';
  if (tasks.collect) {
    title = '商品采集预检';
    lines.push(`采集来源：${options.collectSource || '1688'}`);
    lines.push(`计划采集：${options.collectCount || options.count || 0} 个`);
  }
  if (tasks.edit) {
    title = '编辑商品预检';
    lines.push(...buildProductPreview(options));
  }
  if (tasks.flash) {
    title = tasks.edit ? '编辑商品 + 秒杀预检' : '秒杀活动预检';
    lines.push(`秒杀范围：${formatFlashScope(options)}`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    preview: {
      title,
      lines,
    },
  };
}

module.exports = {
  buildRunPrecheck,
  buildProductPreview,
  formatItemScope,
  formatFlashScope,
};
