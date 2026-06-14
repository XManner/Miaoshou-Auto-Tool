const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

assert.ok(
  source.includes('const FLASH_SAFE_STEP_DELAY_MS = 500'),
  'Flash sale flow buffer delay should be 500ms.',
);

assert.ok(
  source.includes('function isFilteredProductListRefreshReady'),
  'Flash sale script should use a named readiness helper for filtered product lists.',
);

const helperSource = source.slice(
  source.indexOf('function isFilteredProductListRefreshReady'),
  source.indexOf('async function waitForFilteredProductListStable'),
);

assert.ok(
  helperSource.includes('loadingMaskCount'),
  'Filtered-list readiness should distinguish visible loading masks from stale loading text.',
);

assert.ok(
  /rows\.length\s*>\s*0/.test(helperSource) && /return true/.test(helperSource),
  'Visible stable product rows should be allowed to continue when no blocking loading mask is present.',
);

const refreshStateSource = source.slice(
  source.indexOf('async function getProductListRefreshState'),
  source.indexOf('async function waitForFilteredProductListStable'),
);

assert.ok(
  refreshStateSource.includes('loadingMaskCount') && refreshStateSource.includes('hasLoadingText'),
  'Filtered-list state should report loading masks separately from body loading text.',
);

const waitSource = source.slice(
  source.indexOf('async function waitForFilteredProductListStable'),
  source.indexOf('async function readProductRows'),
);

assert.ok(
  waitSource.includes('isFilteredProductListRefreshReady(lastState)'),
  'Filtered-list wait loop should use the readiness helper instead of blocking on any loading text.',
);

const waitDialogGoneSource = source.slice(
  source.indexOf('async function waitForDialogGone'),
  source.indexOf('async function getActivityProductListState'),
);

assert.ok(
  waitDialogGoneSource.includes('throw new Error')
    && waitDialogGoneSource.includes('弹窗没有关闭'),
  'Waiting for a dialog to close should throw on timeout so the flow cannot continue behind an open modal.',
);

assert.ok(
  !source.includes("waitForDialogGone(page, '添加产品', 10000).catch(() => {})"),
  'Add-product dialog cancellation should not swallow dialog-close failures.',
);

const pageSizeSource = source.slice(
  source.indexOf('async function selectPageSize1000'),
  source.indexOf('async function ensureUnpricedFilter'),
);
const unpricedFilterSource = source.slice(
  source.indexOf('async function ensureUnpricedFilter'),
  source.indexOf('async function waitForUnpricedFilterChecked'),
);

assert.ok(
  source.includes('async function waitForPageSize1000Selected'),
  'Flash sale script should explicitly wait until the product list page size shows 1000/page.',
);

assert.ok(
  pageSizeSource.includes('await waitForPageSize1000Selected(page')
    && pageSizeSource.includes('await waitForFilteredProductListStable(page'),
  'Changing product page size to 1000/page should wait for both the selected page-size control and the refreshed list.',
);

assert.ok(
  pageSizeSource.includes('getProductPageSizeTriggerPoint')
    && pageSizeSource.includes('getProductPageSizeOptionPoint')
    && pageSizeSource.includes('await page.mouse.click(triggerPoint.x, triggerPoint.y)')
    && pageSizeSource.includes('await page.mouse.click(optionPoint.x, optionPoint.y)')
    && pageSizeSource.includes('.jx-select-dropdown__item')
    && pageSizeSource.includes('[role=option]'),
  'Changing product page size to 1000/page should click the real select trigger and dropdown option instead of only clicking text nodes.',
);

const processActivitySource = source.slice(
  source.indexOf('async function processActivity'),
  source.indexOf('async function run'),
);

assert.ok(
  processActivitySource.includes('await selectPageSize1000(detailPage);')
    && processActivitySource.includes('await ensureUnpricedFilter(detailPage);')
    && processActivitySource.indexOf('await ensureUnpricedFilter(detailPage);') < processActivitySource.indexOf('await selectPageSize1000(detailPage);'),
  'Flash sale processing should enable and confirm the unpriced filter before switching the filtered list to 1000/page.',
);

assert.ok(
  processActivitySource.includes('await sleep(FLASH_SAFE_STEP_DELAY_MS);')
    && unpricedFilterSource.includes('await sleep(FLASH_SAFE_STEP_DELAY_MS);'),
  'Flash sale flow buffer waits should use the shared 500ms delay.',
);

const filterIndex = processActivitySource.indexOf('await ensureUnpricedFilter(detailPage);');
const filteredRowsIndex = processActivitySource.indexOf('waitForProductRowsOrEmpty(detailPage, 60000)', filterIndex);
const pageSizeIndex = processActivitySource.indexOf('await selectPageSize1000(detailPage);');
assert.ok(
  filterIndex >= 0
    && filteredRowsIndex > filterIndex
    && pageSizeIndex > filteredRowsIndex,
  'Flash sale processing should check whether the filtered list is empty before trying to switch it to 1000/page.',
);

assert.ok(
  !processActivitySource.includes('设置 1000 条/页失败，继续尝试后续步骤'),
  'Flash sale processing should stop instead of continuing when 1000/page cannot be confirmed.',
);

const selectAllSource = source.slice(
  source.indexOf('async function selectAllFilteredProducts'),
  source.indexOf('async function selectDiscountModeAndFill'),
);

assert.ok(
  selectAllSource.includes('await waitForUnpricedFilterChecked(page'),
  'Selecting all products should re-confirm that the unpriced-only filter is still checked.',
);

console.log('flash filtered list stability checks passed');
