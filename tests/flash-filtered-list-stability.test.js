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

console.log('flash filtered list stability checks passed');
