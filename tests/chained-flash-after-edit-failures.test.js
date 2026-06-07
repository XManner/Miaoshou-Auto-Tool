const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  source.includes('function collectFailedResultItems'),
  'Web summary should collect failed result items into a dedicated list.',
);
assert.ok(
  source.includes('failedItems: collectFailedResultItems(parsed.results)'),
  'Normalized summaries should expose failed items.',
);
assert.ok(
  source.includes('function isRecoverableEditSummaryForFlash'),
  'Web workflow should explicitly decide whether edit failures can continue to flash sale.',
);
assert.ok(
  source.includes('isRecoverableEditSummaryForFlash(run.summary)'),
  'Edit + flash workflow should continue when edit summary has recoverable partial failures.',
);
assert.ok(
  source.includes('appendFailedItemsLog(run,'),
  'Workflow should log failed item IDs separately.',
);
assert.ok(
  source.includes('编辑商品有部分失败，已记录失败商品，继续执行秒杀活动。'),
  'Workflow should explain that flash sale continues after partial edit failures.',
);

console.log('chained flash partial failure checks passed');
