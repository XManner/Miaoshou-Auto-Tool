const assert = require('assert');
const fs = require('fs');
const path = require('path');

const selectors = require('../lib/automation_selectors');
const flashSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

assert.ok(selectors.FLASH_SELECTORS, 'Automation selector module should export FLASH_SELECTORS.');

assert.strictEqual(
  selectors.FLASH_SELECTORS.activityRows,
  '.pro-virtual-table__row, .pro-virtual-scroll__row',
  'Flash activity rows should have a named selector contract.',
);

assert.strictEqual(
  selectors.FLASH_SELECTORS.dialogs,
  '[role=dialog], .jx-dialog, .el-dialog',
  'Flash dialogs should have a named selector contract.',
);

assert.ok(
  selectors.FLASH_SELECTORS.checkboxControls.includes('[role="checkbox"]')
    && selectors.FLASH_SELECTORS.checkboxControls.includes('.ant-checkbox'),
  'Checkbox selectors should cover native, ARIA, Element, Ant, and class-based controls.',
);

assert.strictEqual(
  selectors.normalizeUiText('  进行中\n(12)  '),
  '进行中 (12)',
  'Shared UI text normalization should collapse whitespace.',
);

assert.ok(
  flashSource.includes("require('./lib/automation_selectors')")
    && flashSource.includes('selectors.activityRows')
    && flashSource.includes('selectors.dialogs')
    && flashSource.includes('selectors.checkboxControls'),
  'Flash sale automation should use the selector adapter instead of local hard-coded core selectors.',
);

console.log('automation selector checks passed');
