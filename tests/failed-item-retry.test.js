const assert = require('assert');
const fs = require('fs');
const path = require('path');

const retry = require('../lib/run_failed_retry');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const flashSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

const editRun = {
  id: 'edit-failed',
  status: 'error',
  tasks: { edit: true, flash: false },
  account: { id: 'account-1' },
  publish: true,
  processingMode: 'precise',
  sourcePriceExtraCny: 4,
  weightPaddingGrams: 30,
  buyOneTakeOne: true,
  summary: {
    failedItems: [
      { detailId: '101', error: '标题优化失败' },
      { detailId: '102', error: '发布失败' },
    ],
  },
};

const editInput = retry.buildFailedItemRetryInput(editRun);
assert.strictEqual(retry.canRetryFailedItems(editRun), true);
assert.deepStrictEqual(editInput.tasks, { edit: true, flash: false });
assert.deepStrictEqual(editInput.detailIds, ['101', '102']);
assert.strictEqual(editInput.count, 2);
assert.strictEqual(editInput.publish, true);
assert.strictEqual(editInput.processingMode, 'precise');
assert.strictEqual(editInput.buyOneTakeOne, true);
assert.strictEqual(editInput.retrySourceRunId, 'edit-failed');

const flashRun = {
  id: 'flash-failed',
  status: 'error',
  tasks: { edit: false, flash: true },
  account: { id: 'account-2' },
  summary: {
    mode: 'flash-sale',
    results: [
      { activityId: 'A100', failedCount: 1, error: '活动保存失败' },
      { activityId: 'A101', failedCount: 0 },
      { activityId: 'A102', errorCount: 1, error: '找不到产品' },
    ],
  },
};

const flashInput = retry.buildFailedItemRetryInput(flashRun);
assert.deepStrictEqual(flashInput.tasks, { edit: false, flash: true });
assert.strictEqual(flashInput.flashSelectionMode, 'ids');
assert.deepStrictEqual(flashInput.flashActivityIds, ['A100', 'A102']);
assert.strictEqual(flashInput.flashCount, 2);

assert.throws(
  () => retry.buildFailedItemRetryInput({ id: 'ok', status: 'success', summary: { failedItems: [] } }),
  /没有可重跑的失败项/,
);

assert.ok(
  serverSource.includes('/api/run/retry-failed')
    && serverSource.includes('buildFailedItemRetryInput')
    && serverSource.includes('detailIds'),
  'The web server should expose failed-item retry and pass precise detail IDs into edit runs.',
);
assert.ok(
  appSource.includes('retryFailedHistoryRun')
    && appSource.includes('canRetryFailedHistoryItem')
    && appSource.includes('重跑失败项'),
  'Recent records should expose a retry-failed-items action.',
);
assert.ok(
  flashSource.includes('--activity-ids')
    && flashSource.includes('FLASH_SELECTION_MODE_IDS')
    && flashSource.includes('searchActivityById'),
  'Flash sale script should support retrying an explicit activity ID list.',
);

console.log('failed item retry checks passed');
