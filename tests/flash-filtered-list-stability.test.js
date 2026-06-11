const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

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

const pageSizeSource = source.slice(
  source.indexOf('async function selectPageSize1000'),
  source.indexOf('async function ensureUnpricedFilter'),
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

const processActivitySource = source.slice(
  source.indexOf('async function processActivity'),
  source.indexOf('async function run'),
);

assert.ok(
  processActivitySource.includes('await selectPageSize1000(detailPage);')
    && processActivitySource.includes('await ensureUnpricedFilter(detailPage);')
    && processActivitySource.indexOf('await selectPageSize1000(detailPage);') < processActivitySource.indexOf('await ensureUnpricedFilter(detailPage);'),
  'Flash sale processing should set and confirm 1000/page before enabling the unpriced filter.',
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
