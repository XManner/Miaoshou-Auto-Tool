const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  appSource.includes('const queue = ref([])')
    && appSource.includes('const queuePaused = ref(true)')
    && appSource.includes('enqueueCollectRun')
    && appSource.includes('enqueueProductRun')
    && appSource.includes('enqueueFlashRun')
    && appSource.includes("requestJson('/api/run/enqueue'")
    && appSource.includes('startQueueRun')
    && appSource.includes("requestJson('/api/queue/start'")
    && appSource.includes('toggleQueuePaused')
    && appSource.includes("requestJson('/api/queue/pause'")
    && appSource.includes('removeQueueItem')
    && appSource.includes("requestJson('/api/queue/remove'")
    && appSource.includes('moveQueueItem')
    && appSource.includes("requestJson('/api/queue/move'")
    && appSource.includes("requestJson('/api/queue/clear'"),
  'The UI should maintain task queue state and expose per-module enqueue actions.',
);
assert.ok(
  appSource.includes('queueStatusText')
    && appSource.includes("queuePaused.value ? '等待开始' : '执行中'")
    && appSource.includes('queueCountText')
    && appSource.includes('activeQueueItem')
    && appSource.includes('queueDisplayItems')
    && appSource.includes('队列状态')
    && appSource.includes('待执行'),
  'The queue card should show a compact status, pending-count summary, and the active queued task.',
);
assert.ok(
  !appSource.includes('startWorkflowChain')
    && !appSource.includes('buildWorkflowChainPayload')
    && !appSource.includes('buildWorkflowChainConfirmationDetails')
    && !appSource.includes("title: '确认加入任务链路'")
    && !appSource.includes('任务链路')
    && !appSource.includes('采集 → 编辑 → 秒杀')
    && !appSource.includes('/api/run/chain'),
  'The home page should not expose the workflow chain entry; use per-module task queue actions instead.',
);
const productConfirmationFunction = appSource.slice(
  appSource.indexOf('function productConfirmationDetails'),
  appSource.indexOf('function flashConfirmationDetails'),
);
assert.ok(
  productConfirmationFunction.includes('来源价格加价')
    && productConfirmationFunction.includes('sourcePriceExtraCny')
    && productConfirmationFunction.includes('SKU 重量额外加重')
    && productConfirmationFunction.includes('weightPaddingGrams')
    && productConfirmationFunction.includes('买一送一规格')
    && productConfirmationFunction.includes("productForm.buyOneTakeOne ? '添加' : '不添加'"),
  'Product confirmation details should include price markup, SKU weight padding, and buy-one-take-one setting.',
);
assert.ok(
  appSource.includes('任务队列')
    && appSource.includes('queueItems')
    && appSource.includes(':data-source="queueDisplayItems"')
    && appSource.includes('正在执行')
    && appSource.includes("item.status === 'running'")
    && appSource.includes('item.account')
    && appSource.includes('账号：{{ item.account.label }}')
    && appSource.includes('待执行任务会保留')
    && appSource.includes('开始队列')
    && appSource.includes('暂停队列')
    && appSource.includes('继续队列')
    && appSource.includes(':disabled="loading || (queuePaused && !queueItems.length)"')
    && appSource.includes('if (queuePaused.value && !queueItems.value.length)')
    && appSource.includes('上移')
    && appSource.includes('下移')
    && appSource.includes('取消')
    && appSource.includes('清空队列'),
  'The home page should render pending queued tasks and explain that the queue is retained.',
);
assert.ok(
  !serverSource.includes('/api/run/chain')
    && !serverSource.includes('enqueueWorkflowChain')
    && !serverSource.includes('workflowChainInputs'),
  'The server should not expose a workflow chain endpoint.',
);

console.log('workflow chain queue UI checks passed');
