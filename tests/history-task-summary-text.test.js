const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  /function buildHistoryResultText\(run, page\)/.test(appSource),
  'Recent history text should have a helper for result counts.',
);

assert.ok(
  /buildHistoryResultText\(run, 'products'\)/.test(appSource)
    && /buildHistoryResultText\(run, 'flash'\)/.test(appSource),
  'Recent history text should append page-specific edit and flash result counts.',
);

assert.ok(
  /page === 'flash'\s*\?\s*`处理 \$\{metrics\.totalCount\} 个秒杀活动`[\s\S]*:\s*`编辑 \$\{metrics\.totalCount\} 个商品`/.test(appSource)
    && /成功 \$\{metrics\.successCount\} 个，失败 \$\{metrics\.failureCount\} 个/.test(appSource),
  'Recent history text should show task-specific total, success, and failure counts for all-range runs.',
);

assert.ok(
  /run\.itemSelectionMode === 'all'[\s\S]*编辑优化 \$\{selection\}\$\{editResultText\}/.test(appSource),
  'All-products edit history should include the resolved edit result count.',
);

assert.ok(
  /run\.flashSelectionMode === 'all'[\s\S]*处理全部秒杀活动\$\{flashResultText\}/.test(appSource),
  'All-activities flash history should include the resolved flash result count.',
);

console.log('history task summary text checks passed');
