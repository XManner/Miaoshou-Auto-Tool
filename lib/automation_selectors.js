const FLASH_SELECTORS = Object.freeze({
  runningTabCandidates: '[role=tab], label, button, li, span, div',
  globalTextControls: 'button, span, div, input',
  optionItems: '[role=option], li, span, div',
  activityRows: '.pro-virtual-table__row, .pro-virtual-scroll__row',
  productRows: '.pro-virtual-table__row, .pro-virtual-scroll__row, tr',
  dialogs: '[role=dialog], .jx-dialog, .el-dialog',
  modalDialogs: '[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal',
  labelTextNodes: 'label, span, div',
  buttonTextNodes: 'button, span, div',
  checkboxControls: 'input[type="checkbox"], [role="checkbox"], .el-checkbox__input, .ant-checkbox, .jx-checkbox, [class*="checkbox"]',
  checkedControls: 'input[type="checkbox"]:checked, [aria-checked="true"], .is-checked',
  loadingMasks: '.el-loading-mask, .jx-spin, .ant-spin, [class*=loading], [class*=Loading]',
});

function normalizeUiText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  FLASH_SELECTORS,
  normalizeUiText,
};
