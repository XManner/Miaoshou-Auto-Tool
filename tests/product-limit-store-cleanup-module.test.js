const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cleanupRules = require('../lib/product_limit_store_cleanup.js');

const {
  DEFAULT_ZERO_SALES_RETAIN_COUNT,
  PRODUCT_LIMIT_REASON_PATTERNS,
  buildMatchedLimitStoreRecords,
  buildLimitStoreSummary,
  dedupeLimitStoreRecords,
  formatStoreLogName,
  parseProductPageSizeFromTexts,
  parseUnpublishOperationResultText,
  parseVisibleProductResultCountFromTexts,
  shouldSkipUnpublishByZeroSalesCount,
  looksLikeSelectedStoreText,
  matchesProductLimitFailureReason,
  normalizeStoreName,
  normalizeStoreOptionText,
  normalizeZeroSalesRetainCount,
  summarizeUnmatchedFailureRecords,
} = cleanupRules;

const matchingReason = '发布失败：商店试用期，最多只能使用1000个产品列表。';

assert.deepStrictEqual(
  PRODUCT_LIMIT_REASON_PATTERNS,
  ['商店试用期', '最多只能使用1000个产品列表'],
  'Product limit reason patterns should be stable for failure classification.',
);

assert.strictEqual(
  matchesProductLimitFailureReason(matchingReason),
  true,
  'Failure reason should match when both required phrases are present.',
);
assert.strictEqual(
  matchesProductLimitFailureReason('商 店 试 用 期，最 多 只 能 使 用 1000 个 产 品 列 表'),
  true,
  'Whitespace inside a matching reason should be ignored.',
);
assert.strictEqual(
  matchesProductLimitFailureReason('你目前处于商店试用期。根据您的试用级别，目前最多只能使用 1,000 个产品列表。'),
  true,
  'Commas in the product-limit number should be ignored.',
);
assert.strictEqual(
  matchesProductLimitFailureReason('发布失败：商店试用期'),
  false,
  'Failure reason should not match when only the trial-store phrase is present.',
);
assert.strictEqual(
  matchesProductLimitFailureReason('发布失败：最多只能使用1000个产品列表'),
  false,
  'Failure reason should not match when only the product-limit phrase is present.',
);
assert.strictEqual(
  matchesProductLimitFailureReason('发布失败：库存不足'),
  false,
  'Unrelated failure reasons should not match.',
);

assert.strictEqual(
  normalizeStoreName('  X SEVEN SHOP PH-菲律宾  '),
  'X SEVEN SHOP PH',
  'Store normalization should trim and remove supported country suffixes.',
);
assert.strictEqual(
  normalizeStoreName('  SEXY VOICE 菲律宾  '),
  'SEXY VOICE',
  'Store normalization should also remove publish-record country text without a dash.',
);
assert.strictEqual(
  normalizeStoreOptionText('SEXY VOICE 菲律宾'),
  'SEXY VOICE-菲律宾',
  'Publish-record store display text should normalize to the explicit store option text.',
);
assert.strictEqual(
  formatStoreLogName({ storeSearchText: 'SEXY VOICE 菲律宾', storeName: 'SEXY VOICE' }),
  'SEXY VOICE 菲律宾',
  'Store log text should prefer the original publish-record store text.',
);
assert.strictEqual(
  looksLikeSelectedStoreText('Buding lucky PH-菲律宾'),
  true,
  'Selected-store detection should accept real store option text with the country suffix.',
);
assert.strictEqual(
  looksLikeSelectedStoreText('X FOUR SHOP MY-马来'),
  true,
  'Selected-store detection should accept Malaysia store option text.',
);
assert.strictEqual(
  looksLikeSelectedStoreText('菲/PH'),
  false,
  'Selected-store detection should not count country/site chips such as 菲/PH as an extra store.',
);
assert.strictEqual(
  looksLikeSelectedStoreText('+ 1'),
  true,
  'Selected-store detection should still count collapsed selected-store chips such as +1.',
);

const cleanupSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'product_limit_store_cleanup.js'), 'utf8');
const sourceBetween = (startMarker, endMarker) => {
  const start = cleanupSource.indexOf(startMarker);
  const end = cleanupSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source section ${startMarker}`);
  return cleanupSource.slice(start, end);
};
const storeSelectionSource = [
  sourceBetween('async function getStoreSelectorControlBox', 'async function getShopProductsPageSnapshot'),
  sourceBetween('async function clearStoreSelectorAndFocusSearchInput', 'async function clickStoreDropdownOption'),
  sourceBetween('async function clickStoreDropdownOption', 'async function verifySelectedStoreTag'),
].join('\n');
assert.ok(
  cleanupSource.includes('clearStoreSelectorAndFocusSearchInput')
    && cleanupSource.includes('.ant-select-selection-item-remove')
    && cleanupSource.includes('.el-tag__close'),
  'Store selection should clear existing selected store tags before typing.',
);
assert.ok(
  cleanupSource.includes('removeExistingStoreSelections')
    && cleanupSource.indexOf('await removeExistingStoreSelections(page)') < cleanupSource.indexOf('await enterStoreSearchText(page, storeSearchText'),
  'Store selection should remove existing selected store tags before typing a new store.',
);
assert.ok(
  cleanupSource.includes('clickSelectedStoreDropdownOption')
    && cleanupSource.includes('.ant-select-item-option-selected')
    && cleanupSource.includes('.el-select-dropdown__item.is-selected')
    && cleanupSource.includes('[aria-selected="true"]'),
  'Store selection should also uncheck the selected store option in the dropdown when the selected tag close button is missed.',
);
assert.ok(
  cleanupSource.includes('selectedTagSelectors')
    && cleanupSource.includes('rect.right - 14')
    && cleanupSource.includes('click the selected tag right edge'),
  'Store selection should click the right edge of the selected store tag when the close icon has no stable DOM class.',
);
assert.ok(
  !storeSelectionSource.includes('scrollIntoView'),
  'Store selection and existing-tag removal should not scroll the shop-products page before the store is selected.',
);
assert.ok(
  !cleanupSource.includes('scrollIntoView'),
  'Product limit cleanup automation should not scroll the Miaoshou page for already-visible controls.',
);
assert.ok(
  cleanupSource.includes('clickExistingStoreSelectionClose')
    && cleanupSource.includes('dispatchMouseClick')
    && cleanupSource.includes("new MouseEvent('click'")
    && cleanupSource.includes('document.elementsFromPoint'),
  'Store selection should trigger the selected tag close control inside the page instead of only sending a mouse click to a guessed coordinate.',
);
assert.ok(
  cleanupSource.includes('selectedTextCandidates')
    && cleanupSource.includes('resolveSelectedTag')
    && cleanupSource.includes('.ant-select-selector span, .ant-select-selector div'),
  'Store selection should locate custom selected store text inside the shop selector when the selected tag has no standard class.',
);
assert.ok(
  cleanupSource.includes('assertNoExistingStoreSelection')
    && cleanupSource.includes('没有删除已有店铺选项')
    && cleanupSource.indexOf('await assertNoExistingStoreSelection(page)') < cleanupSource.indexOf('await enterStoreSearchText(page, storeSearchText'),
  'Store selection should stop before typing the next store if the existing selected store tag was not removed.',
);
assert.ok(
  cleanupSource.includes('readSelectedStoreSelectionState')
    && cleanupSource.includes('collapsedStoreSelectionCount')
    && cleanupSource.includes('looksLikeSelectedStoreText')
    && cleanupSource.includes('^\\+\\s*\\d+$'),
  'Store selection should treat collapsed tags such as +1 as existing selected stores instead of ignoring them.',
);
assert.ok(
  cleanupSource.includes('DEFAULT_NETWORK_SETTLE_TIMEOUT_MS = 4000')
    && sourceBetween('async function waitForNetworkQuiet', 'async function waitForVisibleText').includes('DEFAULT_NETWORK_SETTLE_TIMEOUT_MS')
    && sourceBetween('async function waitForNetworkQuiet', 'async function waitForVisibleText').includes('DEFAULT_NETWORK_IDLE_MS'),
  'Network settle waits should be bounded so background ERP requests do not add long random pauses.',
);
assert.ok(
  sourceBetween('async function readSelectedStoreSelectionState', 'async function waitForStoreSelectionCountBelow').includes('globalSelectedTagSelectors')
    && sourceBetween('async function readSelectedStoreSelectionState', 'async function waitForStoreSelectionCountBelow').includes('ant-select-dropdown')
    && sourceBetween('async function readSelectedStoreSelectionState', 'async function waitForStoreSelectionCountBelow').includes('ant-table-tbody'),
  'Store selection state should also scan visible selected tags globally while excluding dropdown options and table rows, so a wrong selector root cannot hide stale store tags.',
);
assert.ok(
  cleanupSource.includes('pressBackspaceToRemoveStoreSelection')
    && cleanupSource.includes("await page.keyboard.press('Backspace')"),
  'Store selection should use the focused store-search input Backspace fallback to remove selected stores when close icons are unreliable.',
);
assert.ok(
  cleanupSource.includes('waitForFailurePageRecordsSettled')
    && sourceBetween('async function scanProductLimitFailureStores', 'async function selectExactStore').includes('waitForFailurePageRecordsSettled(page)')
    && sourceBetween('async function waitForFailurePageRecordsSettled', 'async function clickCurrentPageSelectAllCheckbox').includes('stableRounds'),
  'Publish-failure scanning should wait until the failure list is populated and stable before counting rows.',
);
assert.ok(
  sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('[title], [aria-label], [data-title]')
    && sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('collectAttributeText'),
  'Publish-failure extraction should include tooltip/title text because Miaoshou may keep full failure reasons outside visible innerText.',
);
assert.ok(
  sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('storeDisplayCountryPattern')
    && sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('storeSearchText: storeCandidate')
    && sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('...cells, ...lines'),
  'Publish-failure extraction should preserve store-name cells such as "SEXY VOICE 菲律宾" for direct search instead of rebuilding the format.',
);
assert.ok(
  sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('normalizeStoreNameText(text)')
    && sourceBetween('async function extractFailurePageRecords', 'async function waitForFailurePageRecordsSettled').includes('storeNameText'),
  'Publish-failure store-name validation should validate the store body separately from the Chinese country suffix.',
);
assert.ok(
  sourceBetween('async function removeExistingStoreSelections', 'async function assertNoExistingStoreSelection').includes('existingCount <= 0')
    && sourceBetween('async function removeExistingStoreSelections', 'async function assertNoExistingStoreSelection').includes('clickExistingStoreSelectionClose(page)')
    && sourceBetween('async function removeExistingStoreSelections', 'async function assertNoExistingStoreSelection').includes('visible close button can still exist'),
  'Store selection should still try the visible selected-tag close button when selected-count detection misses an existing tag.',
);
assert.ok(
  sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await clearStoreSelectorAndFocusSearchInput(page);') >= 0
    && sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await removeExistingStoreSelections(page);') > sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await clearStoreSelectorAndFocusSearchInput(page);')
    && sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').lastIndexOf('await removeExistingStoreSelections(page);') > sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await assertNoExistingStoreSelection(page);')
    && sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').lastIndexOf('await assertNoExistingStoreSelection(page);') < sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await enterStoreSearchText(page, storeSearchText);'),
  'Store selection should clear and confirm again after focusing the store input, before typing the new store name.',
);
assert.ok(
  cleanupSource.includes('enterStoreSearchText')
    && cleanupSource.includes("Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')")
    && cleanupSource.includes('店铺名没有写入店铺搜索输入框')
    && cleanupSource.indexOf('await enterStoreSearchText(page, storeSearchText)') < cleanupSource.indexOf('await clickStoreDropdownOption(page, storeSearchText'),
  'Store selection should write the store name into the focused search input and verify the actual input value before reading dropdown options.',
);
assert.ok(
  cleanupSource.includes('collectStoreDropdownDebug')
    && cleanupSource.includes('下拉候选')
    && cleanupSource.includes('输入框实际值')
    && cleanupSource.includes('已选标签'),
  'Store dropdown failures should include the real input value and visible dropdown option texts instead of guessing why candidates did not appear.',
);
assert.ok(
  cleanupSource.includes('clickStoreDropdownOption')
    && cleanupSource.includes('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    && cleanupSource.includes('.ant-select-item-option')
    && cleanupSource.includes('.el-select-dropdown:not([style*="display: none"])')
    && cleanupSource.includes('.el-select-dropdown__item'),
  'Store selection should click the visible dropdown option instead of matching arbitrary page text.',
);
assert.ok(
  cleanupSource.includes('normalizeOptionMatchText')
    && cleanupSource.includes('.toLowerCase()')
    && cleanupSource.includes('value.includes(target)'),
  'Store dropdown matching should be case-insensitive so publish-record names like S Labubu MY can match options like S LABUBU MY-马来.',
);
assert.ok(
  cleanupSource.includes('findStoreDropdownOptionCandidates')
    && cleanupSource.includes('.custom-select-dropdown')
    && cleanupSource.includes('.ms-select-dropdown'),
  'Store selection should support Miaoshou custom dropdown text/container candidates recorded from the real page.',
);
assert.ok(
  cleanupSource.includes('verifySelectedStoreTag')
    && cleanupSource.indexOf('await verifySelectedStoreTag(page, target)') > cleanupSource.indexOf('await clickStoreDropdownOption(page, storeSearchText')
    && cleanupSource.indexOf('await verifySelectedStoreTag(page, target)') < cleanupSource.indexOf('phaseLabel: `已选择店铺'),
  'Store selection should verify the selected store tag before continuing to filters or scrolling.',
);
assert.ok(
  cleanupSource.includes('assertSingleSelectedStoreSelection')
    && cleanupSource.includes('选择了多个店铺')
    && cleanupSource.indexOf('await assertSingleSelectedStoreSelection(page, target)') > cleanupSource.indexOf('await verifySelectedStoreTag(page, target)')
    && cleanupSource.indexOf('await assertSingleSelectedStoreSelection(page, target)') < cleanupSource.indexOf('phaseLabel: `已选择店铺'),
  'Store selection should verify exactly one selected store after choosing the target so mixed-store searches cannot continue.',
);
assert.ok(
  sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await closeTransientMenus(page)') > sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await assertSingleSelectedStoreSelection(page, target)')
    && sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('await closeTransientMenus(page)') < sourceBetween('async function selectExactStore', 'async function setZeroSalesFilter').indexOf('phaseLabel: `已选择店铺'),
  'Store selection should close dropdowns after the single-store check so later filter clicks are not covered by stale menus.',
);
assert.ok(
  cleanupSource.includes('没有确认店铺已选中')
    && cleanupSource.indexOf('没有确认店铺已选中') > cleanupSource.indexOf('async function verifySelectedStoreTag')
    && cleanupSource.indexOf('没有确认店铺已选中') < cleanupSource.indexOf('async function getVisibleInputValuesNearText'),
  'Selected-store verification failures should include store dropdown diagnostics instead of raw waiting timeouts.',
);
assert.ok(
  cleanupSource.includes('fieldTypeSelectors')
    && cleanupSource.includes('isTypeSelectorText')
    && cleanupSource.includes('rect.left >= typeSelector.rect.right - 4')
    && cleanupSource.includes('score -= 200'),
  'Store selection should skip the left search-type selector and target the input selector to its right.',
);
assert.ok(
  !cleanupSource.includes("const selector = root.querySelector('.ant-select-selector"),
  'Store selection should not focus the first selector inside a composite search control.',
);
assert.ok(
  cleanupSource.includes('DEFAULT_ZERO_SALES_RETAIN_COUNT')
    && cleanupSource.includes('zeroSalesProductCount')
    && cleanupSource.includes('${storeLogName}：零销量商品不超过 ${zeroSalesRetainCount} 个'),
  'Cleanup should keep a configurable zero-sales retain count before down-shelving.',
);
assert.ok(
  cleanupSource.includes('async function openFilteredZeroSalesProducts')
    && cleanupSource.includes('MAX_ZERO_SALES_CLEANUP_ROUNDS')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('while (cleanupRound < MAX_ZERO_SALES_CLEANUP_ROUNDS)')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('openFilteredZeroSalesProducts(page, target)')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('previousZeroSalesProductCount')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('Number(zeroSalesProductCount) >= previousZeroSalesProductCount')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('cleanupRound += 1')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('不超过保留数量')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('下架后零销量商品数量没有减少'),
  'Cleanup should repeatedly down-shelve the last page until zero-sales count is no longer above the retain count, but fail the current store if the count does not decrease.',
);
assert.ok(
  sourceBetween('async function fillInputsNearText', 'async function fillFirstVisibleInputNearText').includes('page.keyboard.type')
    && sourceBetween('async function fillInputsNearText', 'async function fillFirstVisibleInputNearText').includes('page.mouse.click')
    && !sourceBetween('async function fillInputsNearText', 'async function fillFirstVisibleInputNearText').includes('input.value = value'),
  'Sales filter entry should use real click and keyboard input instead of only mutating DOM values.',
);
assert.ok(
  sourceBetween('async function fillInputsNearText', 'async function fillFirstVisibleInputNearText').includes('blurFocusedInput')
    && !sourceBetween('async function fillInputsNearText', 'async function fillFirstVisibleInputNearText').includes("keyboard.press('Tab')"),
  'Sales filter entry should commit the typed value without tabbing into the next filter field.',
);
assert.ok(
  sourceBetween('async function getVisibleInputValuesNearText', 'async function verifyZeroSalesFilterInputs').includes('score: (text === needle ? 0 : text.length)')
    && !sourceBetween('async function getVisibleInputValuesNearText', 'async function verifyZeroSalesFilterInputs').includes('const labelElement = textElements[0];'),
  'Sales filter verification should locate the nearest specific 销量 label instead of the first broad filter container.',
);
assert.ok(
  cleanupSource.includes('readVisibleProductResultCount')
    && cleanupSource.includes('在售中')
    && cleanupSource.includes('[role="tab"]'),
  'Zero-sales threshold should read the filtered on-sale tab count such as 在售中(963), not only pagination totals.',
);
assert.ok(
  !sourceBetween('async function readZeroSalesProductCount', 'async function clickLastNumericPage').includes('countVisibleProductRows'),
  'Zero-sales threshold should not treat currently rendered row count as the filtered product total.',
);
assert.strictEqual(
  typeof parseProductPageSizeFromTexts,
  'function',
  'Product cleanup should expose a parser for the current page-size selector.',
);
assert.strictEqual(
  parseProductPageSizeFromTexts(['20条/页']),
  20,
  'Product cleanup should parse the current 20-item page-size selector.',
);
assert.strictEqual(
  parseProductPageSizeFromTexts(['1 ... 46 47 48 49 前往 49 页 20条/页']),
  20,
  'Product cleanup should parse the current page size from the visible pagination bar.',
);
assert.strictEqual(
  parseProductPageSizeFromTexts(['100条/页']),
  100,
  'Product cleanup should parse the required 100-item page-size selector.',
);
assert.ok(
  cleanupSource.includes('assertProductPageSize100')
    && sourceBetween('async function goToLastProductPage', 'async function verifySafeProductPage').includes('await assertProductPageSize100(page'),
  'Product cleanup should assert the current page size is 100 before navigating to the last page.',
);
assert.ok(
  !sourceBetween('async function goToLastProductPage', 'async function verifySafeProductPage').includes("waitForVisibleText(page, '100条/页'"),
  'Last-page navigation must not treat any visible 100条/页 option as proof that the current page size is 100.',
);
assert.ok(
  !sourceBetween('async function verifySafeProductPage', 'async function unpublishCurrentPageProducts').includes("text.includes('100条/页')"),
  'Safe-page verification should read the current page-size selector instead of searching arbitrary page text.',
);
assert.ok(
  !sourceBetween('async function getProductPaginationState', 'async function readVisibleProductResultCount').includes("button, a, li"),
  'Last-page confirmation should not scan arbitrary buttons or floating toolbar links as enabled next-page controls.',
);
assert.ok(
  sourceBetween('async function getProductPaginationState', 'async function readVisibleProductResultCount').includes("classList.contains('active')")
    && sourceBetween('async function getProductPaginationState', 'async function readVisibleProductResultCount').includes('paginationStateDebug'),
  'Last-page confirmation should recognize common active page classes and expose pagination diagnostics.',
);
assert.ok(
  sourceBetween('async function goToLastProductPage', 'async function verifySafeProductPage').includes('formatPaginationStateForError'),
  'Last-page confirmation failures should include page-number and next-button diagnostics.',
);
assert.ok(
  sourceBetween('async function goToLastProductPage', 'async function verifySafeProductPage').includes('waitForLastProductPage'),
  'Last-page navigation should wait until the clicked last page becomes active before confirming.',
);
assert.ok(
  sourceBetween('async function verifySafeProductPage', 'async function unpublishCurrentPageProducts').includes('safeCheckDetails')
    && sourceBetween('async function verifySafeProductPage', 'async function unpublishCurrentPageProducts').includes('安全校验失败：'),
  'Safe-page verification failures should say which condition failed instead of only reporting a generic safety failure.',
);
assert.ok(
  !sourceBetween('async function verifySafeProductPage', 'async function unpublishCurrentPageProducts').includes('zeroVisibleProductSales')
    && !sourceBetween('async function verifySafeProductPage', 'async function unpublishCurrentPageProducts').includes('readVisibleProductRowSales'),
  'Safe-page verification should trust the confirmed 销量 0 到 0 filter and should not re-check table row sales before selecting the last page.',
);
assert.ok(
  sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes('clickCurrentPageSelectAllCheckbox')
    && !sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes('countVisibleProductRows'),
  'Unpublish should click the current-page header checkbox instead of requiring parsed product rows first.',
);
assert.ok(
  sourceBetween('async function clickCurrentPageSelectAllCheckbox', 'async function clickTopBulkMoreDropdown').includes('findProductInfoHeaderBox')
    && sourceBetween('async function clickCurrentPageSelectAllCheckbox', 'async function clickTopBulkMoreDropdown').includes('产品信息')
    && sourceBetween('async function clickCurrentPageSelectAllCheckbox', 'async function clickTopBulkMoreDropdown').includes('document.elementsFromPoint')
    && sourceBetween('async function clickCurrentPageSelectAllCheckbox', 'async function clickTopBulkMoreDropdown').includes('[class*="checkbox"'),
  'Current-page select-all should anchor on 产品信息 and support custom checkbox wrappers near the header.',
);
assert.ok(
  !sourceBetween('async function clickCurrentPageSelectAllCheckbox', 'async function clickTopBulkMoreDropdown').includes('没有确认商品已选中')
    && sourceBetween('async function clickCurrentPageSelectAllCheckbox', 'async function clickTopBulkMoreDropdown').includes('return selectedProductCount || 1'),
  'Current-page select-all should continue after clicking the header checkbox even when selected-row state is not parseable.',
);
assert.ok(
  sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes('clickTopBulkMoreDropdown')
    && sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes('clickVisibleDropdownAction')
    && sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes("['下架产品', '下架商品', '下架']")
    && !sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes("clickByText(page, '下架'"),
  'Unpublish should use the top bulk 更多 menu and prefer the 下架产品 dropdown action instead of row-level 下架 links.',
);
assert.ok(
  sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes('waitForUnpublishOperationResult')
    && sourceBetween('async function unpublishCurrentPageProducts', 'async function cleanupLimitStoreProducts').includes('failureCount'),
  'Unpublish should wait for the operation result and keep the failure count instead of treating any success text as completion.',
);
assert.ok(
  sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('unpublishResult')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('failureCount')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('会重新筛选当前店铺继续下架')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('continue'),
  'Store cleanup should retry the same store when the final down-shelve result still has failures.',
);
assert.ok(
  sourceBetween('async function clickTopBulkMoreDropdown', 'async function clickVisibleDropdownAction').includes('bulkToolbarLabels')
    && sourceBetween('async function clickTopBulkMoreDropdown', 'async function clickVisibleDropdownAction').includes('批量编辑')
    && sourceBetween('async function clickTopBulkMoreDropdown', 'async function clickVisibleDropdownAction').includes('复制产品')
    && sourceBetween('async function clickTopBulkMoreDropdown', 'async function clickVisibleDropdownAction').includes('达人建联')
    && sourceBetween('async function clickTopBulkMoreDropdown', 'async function clickVisibleDropdownAction').includes('分组')
    && sourceBetween('async function clickTopBulkMoreDropdown', 'async function clickVisibleDropdownAction').includes('sameToolbarRow'),
  'Top bulk 更多 should be anchored to the product bulk toolbar beside 分组, not the global navigation or row actions.',
);
assert.ok(
  sourceBetween('async function clickVisibleDropdownAction', 'async function clickNextFailurePage').includes('actionLabelIndex')
    && sourceBetween('async function clickVisibleDropdownAction', 'async function clickNextFailurePage').includes('labelIndex'),
  'Dropdown action matching should respect the requested label order so 下架产品 is preferred before broader fallbacks.',
);
assert.ok(
  !sourceBetween('async function clickVisibleDropdownAction', 'async function clickNextFailurePage').includes('roots = dropdownRoots.length > 0 ? dropdownRoots : [document.body]')
    && sourceBetween('async function clickVisibleDropdownAction', 'async function clickNextFailurePage').includes('waitForDropdownActionVisible')
    && sourceBetween('async function clickVisibleDropdownAction', 'async function clickNextFailurePage').includes('没有找到已打开下拉菜单里的操作'),
  'Bulk unpublish must only click 下架产品 inside an opened dropdown menu, never fall back to row-level 下架 links in the page body.',
);
assert.ok(
  cleanupSource.includes('openCleanShopProductsPage')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function runProductLimitStoreCleanup').includes('openCleanShopProductsPage(page)')
    && sourceBetween('async function openCleanShopProductsPage', 'async function selectExactStore').includes("page.goto('about:blank'")
    && sourceBetween('async function openCleanShopProductsPage', 'async function selectExactStore').includes('closeTransientMenus(page)'),
  'Each store cleanup should start from a clean shop-products page so stale selected stores, open menus, and old pagination state cannot leak into the next store.',
);
assert.ok(
  cleanupSource.includes('isNavigationContextError')
    && sourceBetween('async function runProductLimitStoreCleanup', 'module.exports').includes('recoverAfterStoreCleanupFailure(page)')
    && sourceBetween('async function recoverAfterStoreCleanupFailure', 'async function runProductLimitStoreCleanup').includes('openCleanShopProductsPage(page)'),
  'After a store fails or the page frame is replaced, the cleanup loop should recover the shop-products page before processing the next store.',
);
assert.ok(
  sourceBetween('async function runProductLimitStoreCleanup', 'module.exports').includes('当前店铺下架失败')
    && sourceBetween('async function runProductLimitStoreCleanup', 'module.exports').includes('failedItems.push')
    && sourceBetween('async function runProductLimitStoreCleanup', 'module.exports').includes('继续处理下一个店铺'),
  'A failed store cleanup should be recorded with a reason and the task should continue to later stores.',
);

assert.strictEqual(
  parseVisibleProductResultCountFromTexts(['在售中 (963)', '已下架 (418)']),
  963,
  'Filtered product count should parse Miaoshou status tabs such as 在售中 (963).',
);
assert.strictEqual(
  parseVisibleProductResultCountFromTexts(['共 1,234 条']),
  1234,
  'Filtered product count should still parse pagination total text.',
);
assert.strictEqual(
  parseVisibleProductResultCountFromTexts(['全选 反选 37条 1 前往页', '10条/页20条/页50条/页100条/页']),
  37,
  'Filtered product count should parse Miaoshou pagination totals such as 37条.',
);
assert.strictEqual(
  parseVisibleProductResultCountFromTexts(['10条/页20条/页50条/页100条/页']),
  null,
  'Page-size options such as 100条/页 should not be misread as product totals.',
);
assert.deepStrictEqual(
  parseUnpublishOperationResultText('总计 100 个，成功 98 个，失败 2 个'),
  {
    totalCount: 100,
    successCount: 98,
    failureCount: 2,
    unfinishedCount: null,
  },
  'Unpublish result parser should read total, success, and failure counts from the result dialog.',
);
assert.strictEqual(
  parseUnpublishOperationResultText('未完成：3，成功：97，失败：0').unfinishedCount,
  3,
  'Unpublish result parser should read unfinished counts so the caller can wait or retry.',
);
assert.ok(
  sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('无法确认零销量商品数，已跳过下架')
    && sourceBetween('async function cleanupLimitStoreProducts', 'async function recoverAfterStoreCleanupFailure').includes('!Number.isFinite(Number(zeroSalesProductCount))'),
  'Cleanup should skip destructive down-shelving when the zero-sales product count cannot be confirmed.',
);

assert.strictEqual(
  DEFAULT_ZERO_SALES_RETAIN_COUNT,
  900,
  'Default zero-sales retain count should remain 900.',
);
assert.strictEqual(
  normalizeZeroSalesRetainCount(undefined),
  900,
  'Undefined retain count should fall back to the default 900.',
);
assert.strictEqual(
  normalizeZeroSalesRetainCount(1200),
  1200,
  'Explicit retain count should be preserved.',
);
assert.throws(
  () => normalizeZeroSalesRetainCount(-1),
  /保留数量必须是大于等于 0 的整数/,
  'Negative retain counts should be rejected.',
);
assert.strictEqual(
  shouldSkipUnpublishByZeroSalesCount(900),
  true,
  'Stores with 900 or fewer zero-sales products should be skipped.',
);
assert.strictEqual(
  shouldSkipUnpublishByZeroSalesCount(901),
  false,
  'Stores with more than 900 zero-sales products can continue to the last-page down-shelve step.',
);
assert.strictEqual(
  shouldSkipUnpublishByZeroSalesCount(1000, 1200),
  true,
  'Custom retain counts should skip stores at or below the configured retain count.',
);
assert.strictEqual(
  shouldSkipUnpublishByZeroSalesCount(1201, 1200),
  false,
  'Custom retain counts should allow down-shelving only above the configured retain count.',
);
assert.strictEqual(
  shouldSkipUnpublishByZeroSalesCount(null),
  false,
  'Unknown zero-sales counts should not trigger the 900-item skip rule.',
);

assert.deepStrictEqual(
  buildMatchedLimitStoreRecords([
    { storeName: 'X SEVEN SHOP PH', reason: matchingReason },
    { storeName: 'X FIVE SHOP PH', reason: matchingReason },
    { storeName: 'SEXY VOICE 菲律宾', storeSearchText: 'SEXY VOICE 菲律宾', reason: matchingReason },
    { storeName: 'BEAUTY LIFE MY', reason: '最多只能使用1000个产品列表，商店试用期' },
  ]),
  [
    {
      storeName: 'X SEVEN SHOP PH',
      storeOptionText: '',
      storeSearchText: 'X SEVEN SHOP PH',
      failureCount: 1,
    },
    {
      storeName: 'X FIVE SHOP PH',
      storeOptionText: '',
      storeSearchText: 'X FIVE SHOP PH',
      failureCount: 1,
    },
    {
      storeName: 'SEXY VOICE 菲律宾',
      storeOptionText: '',
      storeSearchText: 'SEXY VOICE 菲律宾',
      failureCount: 1,
    },
    {
      storeName: 'BEAUTY LIFE MY',
      storeOptionText: '',
      storeSearchText: 'BEAUTY LIFE MY',
      failureCount: 1,
    },
  ],
  'Matched publish-failure stores should keep the failed store text for direct search without inferring country suffixes.',
);

assert.deepStrictEqual(
  dedupeLimitStoreRecords([
    { storeName: '  X SEVEN SHOP PH-菲律宾  ', reason: matchingReason },
    { shopName: 'X   SEVEN   SHOP   PH', failureReason: matchingReason },
    { storeName: 'BEAUTY LIFE-马来', reason: '最多只能使用1000个产品列表，商店试用期' },
    { storeName: 'IGNORED SHOP-菲律宾', reason: '商店试用期' },
    { storeName: '', reason: matchingReason },
  ]),
  [
    { storeName: 'X SEVEN SHOP PH-菲律宾', storeSearchText: 'X SEVEN SHOP PH-菲律宾', failureCount: 1 },
    { storeName: 'X SEVEN SHOP PH', storeSearchText: 'X SEVEN SHOP PH', failureCount: 1 },
    { storeName: 'BEAUTY LIFE-马来', storeSearchText: 'BEAUTY LIFE-马来', failureCount: 1 },
  ],
  'Limit store records should keep the source store text for direct search and return only matched stores.',
);

assert.deepStrictEqual(
  buildLimitStoreSummary({
    scannedFailureRecords: 5,
    matchedStores: [
      { storeName: 'X SEVEN SHOP PH', failureCount: 2 },
      { storeName: 'BEAUTY LIFE', failureCount: 1 },
      { storeName: 'QUIET STORE', failureCount: 1 },
    ],
    results: [
      { storeName: 'X SEVEN SHOP PH', unpublishedCount: 3 },
      { storeName: 'BEAUTY LIFE', skipped: true, reason: '无可下架商品' },
      { storeName: 'QUIET STORE', skipped: true },
      { storeName: 'BROKEN STORE', error: '页面加载失败', unpublishedCount: 4 },
    ],
    failedItems: [{ storeName: 'BROKEN STORE', reason: '页面加载失败' }],
    unmatchedFailureRecords: [
      { storeName: 'IGNORED SHOP PH', reasonPreview: '发布失败：库存不足' },
    ],
  }),
  {
    mode: 'product-limit-store-unpublish',
    retainCount: 900,
    scannedFailureRecords: 5,
    matchedStores: [
      { storeName: 'X SEVEN SHOP PH', failureCount: 2 },
      { storeName: 'BEAUTY LIFE', failureCount: 1 },
      { storeName: 'QUIET STORE', failureCount: 1 },
    ],
    unmatchedFailureRecords: [
      { storeName: 'IGNORED SHOP PH', reasonPreview: '发布失败：库存不足' },
    ],
    matchedStoreCount: 3,
    processedStoreCount: 1,
    unpublishedCount: 7,
    skippedStores: [
      { storeName: 'BEAUTY LIFE', reason: '无可下架商品' },
      { storeName: 'QUIET STORE', reason: '已跳过' },
    ],
    failedItems: [{ storeName: 'BROKEN STORE', reason: '页面加载失败' }],
    results: [
      { storeName: 'X SEVEN SHOP PH', unpublishedCount: 3 },
      { storeName: 'BEAUTY LIFE', skipped: true, reason: '无可下架商品' },
      { storeName: 'QUIET STORE', skipped: true },
      { storeName: 'BROKEN STORE', error: '页面加载失败', unpublishedCount: 4 },
    ],
  },
  'Limit store summary should preserve results and aggregate processed, skipped, and unpublished counts.',
);

assert.deepStrictEqual(
  summarizeUnmatchedFailureRecords([
    { storeName: 'X SEVEN SHOP PH', reason: matchingReason },
    { storeName: '', reason: matchingReason },
    { storeName: 'IGNORED SHOP PH', reason: '发布失败：库存不足，请稍后重试' },
    { storeName: 'ONLY TRIAL SHOP MY', reason: '发布失败：商店试用期' },
  ]),
  [
    {
      storeName: '',
      storeOptionText: '',
      storeSearchText: '',
      reasonPreview: `已匹配上限原因，但没有解析到店铺名：${matchingReason}`,
    },
    {
      storeName: 'IGNORED SHOP PH',
      storeOptionText: '',
      storeSearchText: 'IGNORED SHOP PH',
      reasonPreview: '发布失败：库存不足，请稍后重试',
    },
    {
      storeName: 'ONLY TRIAL SHOP MY',
      storeOptionText: '',
      storeSearchText: 'ONLY TRIAL SHOP MY',
      reasonPreview: '发布失败：商店试用期',
    },
  ],
  'Unmatched failure diagnostics should keep short reason previews for scanned rows that do not hit the product-limit rule.',
);

console.log('product limit store cleanup module checks passed');
