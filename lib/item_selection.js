function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_MAX_EDIT_ITEM_INDEX = parsePositiveInteger(process.env.MAX_EDIT_ITEM_INDEX, 500);
const DEFAULT_EDIT_ALL_PAGE_SIZE = 50;

function normalizeItemSelectionMode(value = 'range') {
  return String(value || '').trim().toLowerCase() === 'all' ? 'all' : 'range';
}

function hasItemRangeSelection(input = {}) {
  return [input.itemStartIndex, input.itemEndIndex, input.startIndex, input.endIndex]
    .some((value) => value !== undefined && value !== null && value !== '');
}

function normalizeItemRangeIndex(value, fieldLabel = '商品序号') {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > DEFAULT_MAX_EDIT_ITEM_INDEX) {
    throw new Error(`${fieldLabel}必须是 1 到 ${DEFAULT_MAX_EDIT_ITEM_INDEX} 之间的整数。`);
  }
  return numeric;
}

function normalizeItemRangeSelection({
  startIndex,
  endIndex,
  itemStartIndex,
  itemEndIndex,
  count = 1,
} = {}) {
  const rawStart = itemStartIndex !== undefined ? itemStartIndex : startIndex;
  const rawEnd = itemEndIndex !== undefined ? itemEndIndex : endIndex;
  const hasStart = rawStart !== undefined && rawStart !== null && rawStart !== '';
  const hasEnd = rawEnd !== undefined && rawEnd !== null && rawEnd !== '';

  if (!hasStart && !hasEnd) {
    const resolvedCount = Math.max(1, parsePositiveInteger(count, 1));
    return {
      startIndex: 1,
      endIndex: resolvedCount,
      count: resolvedCount,
      offset: 0,
    };
  }

  const resolvedStart = normalizeItemRangeIndex(hasStart ? rawStart : 1, '开始序号');
  const resolvedEnd = normalizeItemRangeIndex(hasEnd ? rawEnd : resolvedStart, '结束序号');

  if (resolvedEnd < resolvedStart) {
    throw new Error('结束序号不能小于开始序号。');
  }

  return {
    startIndex: resolvedStart,
    endIndex: resolvedEnd,
    count: resolvedEnd - resolvedStart + 1,
    offset: resolvedStart - 1,
  };
}

function selectItemsByItemRange(items = [], rangeInput = {}) {
  const range = normalizeItemRangeSelection(rangeInput);
  return (Array.isArray(items) ? items : []).slice(range.offset, range.endIndex);
}

function buildDefaultEditSearchParams({
  itemSelectionMode = 'range',
  itemStartIndex,
  itemEndIndex,
  count = 1,
} = {}) {
  const selectionMode = normalizeItemSelectionMode(itemSelectionMode);
  if (selectionMode === 'all') {
    return {
      pageNo: 0,
      pageSize: DEFAULT_EDIT_ALL_PAGE_SIZE,
      maxPages: Math.ceil(DEFAULT_MAX_EDIT_ITEM_INDEX / DEFAULT_EDIT_ALL_PAGE_SIZE),
      detailIds: [],
      itemSelectionMode: 'all',
    };
  }

  const itemRange = normalizeItemRangeSelection({ startIndex: itemStartIndex, endIndex: itemEndIndex, count });
  return {
    pageNo: 0,
    pageSize: itemRange.endIndex,
    maxPages: 1,
    detailIds: [],
    itemSelectionMode: 'range',
    itemStartIndex: itemRange.startIndex,
    itemEndIndex: itemRange.endIndex,
  };
}

module.exports = {
  buildDefaultEditSearchParams,
  hasItemRangeSelection,
  normalizeItemRangeIndex,
  normalizeItemRangeSelection,
  normalizeItemSelectionMode,
  selectItemsByItemRange,
};
