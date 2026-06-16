const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const queue = require('../lib/run_queue');

const first = queue.createQueuedRun({
  input: { tasks: { collect: true, edit: false, flash: false }, collectSource: '1688', collectCount: 3 },
  label: '采集 3 个商品',
});
const second = queue.createQueuedRun({
  input: { tasks: { edit: true, flash: false }, count: 2 },
  label: '编辑 2 个商品',
});
const third = queue.createQueuedRun({
  input: { tasks: { flash: true }, flashCount: 1 },
  label: '秒杀 1 个活动',
});
const accountBound = queue.createQueuedRun({
  input: {
    tasks: { edit: true, flash: false },
    count: 1,
    account: {
      id: 'account-a',
      label: '16688880000',
      appId: 'app-id-a',
      appSecret: 'secret-a',
      loginPassword: 'password-a',
      complete: true,
    },
  },
  accountSnapshot: {
    id: 'account-a',
    label: '166****0000',
    complete: true,
  },
  label: '编辑 1 个商品',
});

assert.ok(first.id && first.createdAt, 'Queued tasks should have stable metadata.');
assert.strictEqual(first.status, 'queued');
assert.strictEqual(first.label, '采集 3 个商品');
assert.deepStrictEqual(queue.serializeQueue([first, second]).map((item) => item.position), [1, 2]);
assert.strictEqual(accountBound.input.account, undefined, 'Queued input should not keep the full account object.');
assert.strictEqual(accountBound.input.accountId, 'account-a', 'Queued input should bind the selected account id.');
assert.strictEqual(accountBound.accountSnapshot.label, '166****0000', 'Queued item should keep a masked account snapshot for display.');
assert.strictEqual(accountBound.accountSnapshot.appSecret, undefined, 'Queued account snapshots should not keep App Secret.');
assert.strictEqual(accountBound.accountSnapshot.loginPassword, undefined, 'Queued account snapshots should not keep login password.');
assert.deepStrictEqual(
  queue.serializeQueue([accountBound])[0].account,
  { id: 'account-a', label: '166****0000', complete: true },
  'Serialized queue items should expose the bound account label for the UI.',
);
assert.deepStrictEqual(queue.dequeueNext([first, second]), {
  item: first,
  queue: [second],
});
assert.deepStrictEqual(
  queue.removeQueuedRun([first, second], second.id),
  { removed: second, queue: [first] },
  'Removing a queued task should keep the remaining order.',
);
assert.deepStrictEqual(
  queue.moveQueuedRun([first, second, third], third.id, 'up').queue.map((item) => item.id),
  [first.id, third.id, second.id],
  'Moving a queued task up should swap it with the previous task.',
);
assert.deepStrictEqual(
  queue.moveQueuedRun([first, second, third], first.id, 'down').queue.map((item) => item.id),
  [second.id, first.id, third.id],
  'Moving a queued task down should swap it with the next task.',
);
assert.deepStrictEqual(
  queue.moveQueuedRun([first, second, third], first.id, 'up'),
  { moved: null, queue: [first, second, third] },
  'Moving the first queued task up should be a no-op.',
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaoshou-run-queue-'));
const queuePath = path.join(tempDir, 'queue.json');
assert.strictEqual(queue.saveRunQueue([first, second], { filePath: queuePath }), true);
assert.deepStrictEqual(
  queue.loadRunQueue({ filePath: queuePath }).map((item) => item.label),
  ['采集 3 个商品', '编辑 2 个商品'],
  'Persisted queue should reload queued tasks in order.',
);
assert.deepStrictEqual(
  queue.loadRunQueueState({ filePath: queuePath }),
  { paused: true, queue: [first, second] },
  'Persisted queue state should include queue items and keep newly queued tasks waiting for an explicit start.',
);
assert.strictEqual(queue.saveRunQueue([first, second], { filePath: queuePath, paused: true }), true);
assert.strictEqual(
  queue.loadRunQueueState({ filePath: queuePath }).paused,
  true,
  'Persisted queue state should remember when the queue is paused.',
);
const rawQueue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
assert.strictEqual(rawQueue.version, 1, 'Persisted queue should include a version.');
assert.ok(rawQueue.savedAt, 'Persisted queue should include a savedAt timestamp.');
assert.strictEqual(rawQueue.paused, true, 'Persisted queue should include paused state.');
assert.ok(Array.isArray(rawQueue.queue), 'Persisted queue should use a queue array.');
assert.strictEqual(queue.saveRunQueue([accountBound], { filePath: queuePath }), true);
const persistedAccountQueue = fs.readFileSync(queuePath, 'utf8');
const parsedAccountQueue = JSON.parse(persistedAccountQueue);
assert.ok(!persistedAccountQueue.includes('secret-a'), 'Persisted queue should not store App Secret.');
assert.ok(!persistedAccountQueue.includes('password-a'), 'Persisted queue should not store login password.');
assert.strictEqual(parsedAccountQueue.queue[0].input.accountId, 'account-a', 'Persisted queue should keep the bound account id.');

fs.writeFileSync(queuePath, '{not valid json', 'utf8');
assert.deepStrictEqual(queue.loadRunQueue({ filePath: queuePath }), []);
assert.strictEqual(
  queue.loadRunQueueState({ filePath: queuePath }).paused,
  true,
  'Invalid queue state should fall back to waiting for an explicit start.',
);

fs.writeFileSync(queuePath, JSON.stringify({ version: 1, queue: [first, second] }), 'utf8');
assert.strictEqual(queue.clearRunQueueStore({ filePath: queuePath }), true);
assert.strictEqual(fs.existsSync(queuePath), false, 'Clearing the queue should remove the persisted queue file.');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const enqueueFunctionSource = serverSource.slice(
  serverSource.indexOf('function enqueueRunInput'),
  serverSource.indexOf('function startQueuedRun'),
);
assert.ok(
  serverSource.includes("require('./lib/run_queue')")
    && serverSource.includes('const queueState = loadRunQueueState()')
    && serverSource.includes('let taskQueuePaused = true')
    && serverSource.includes('enqueueRunInput')
    && serverSource.includes('runNextQueuedRunNow')
    && serverSource.includes('scheduleNextQueuedRun')
    && serverSource.includes('/api/run/enqueue')
    && serverSource.includes('/api/queue/start')
    && serverSource.includes('/api/queue/pause')
    && serverSource.includes('/api/queue/remove')
    && serverSource.includes('/api/queue/move')
    && serverSource.includes('/api/queue/clear'),
  'The web server should expose a persisted task queue with enqueue, pause, remove, move, and clear APIs.',
);
assert.ok(
  serverSource.includes('queue: serializeQueue(taskQueue)')
    && serverSource.includes('queuePaused: taskQueuePaused')
    && serverSource.includes('startQueuedRun')
    && serverSource.includes('run.queueLabel = item.label ||')
    && serverSource.includes('queueLabel: run.queueLabel ||')
    && serverSource.includes('buildQueuedRunInput')
    && serverSource.includes('accountSnapshot: serializeMiaoshouAccount(options.account)')
    && serverSource.includes('normalizeRunOptions(item.input)')
    && serverSource.includes('rememberQueuedRunStartFailure'),
  'Status responses should include pending queue details, and queued runs should bind an account id then resolve current account config when started.',
);
assert.ok(
  serverSource.includes('saveRunQueue(taskQueue, { paused: taskQueuePaused })')
    && serverSource.includes('removeQueuedRun(taskQueue')
    && serverSource.includes('moveQueuedRun(taskQueue')
    && serverSource.includes('clearRunQueueStore()'),
  'Queue mutations should be saved so pending tasks survive page or server restarts.',
);
assert.ok(
  !enqueueFunctionSource.includes('scheduleNextQueuedRun();'),
  'Adding a task to the queue should keep it visible in the queue until the user explicitly starts the queue.',
);

console.log('run queue checks passed');
