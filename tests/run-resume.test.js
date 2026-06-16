const assert = require('assert');
const fs = require('fs');
const path = require('path');

const resume = require('../lib/run_resume');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

const editRun = {
  id: 'edit-run',
  status: 'error',
  tasks: { edit: true, flash: false },
  account: { id: 'account-1' },
  publish: true,
  processingMode: 'precise',
  itemSelectionMode: 'range',
  itemStartIndex: 2,
  itemEndIndex: 8,
  count: 7,
  sourcePriceExtraCny: 5,
  weightPaddingGrams: 30,
  buyOneTakeOne: true,
  progress: { phase: 'edit', completed: 3, total: 7 },
};

const editInput = resume.buildResumeRunInput(editRun);
assert.strictEqual(editInput.accountId, 'account-1');
assert.deepStrictEqual(editInput.tasks, { edit: true, flash: false });
assert.strictEqual(editInput.itemSelectionMode, 'range');
assert.strictEqual(editInput.itemStartIndex, 5);
assert.strictEqual(editInput.itemEndIndex, 8);
assert.strictEqual(editInput.count, 4);
assert.strictEqual(editInput.publish, true);
assert.strictEqual(editInput.processingMode, 'precise');
assert.strictEqual(editInput.buyOneTakeOne, true);

const flashRun = {
  id: 'flash-run',
  status: 'error',
  tasks: { edit: true, flash: true },
  account: { id: 'account-2' },
  flashSelectionMode: 'count',
  flashCount: 10,
  progress: { phase: 'flash', completed: 4, total: 10 },
};

const flashInput = resume.buildResumeRunInput(flashRun);
assert.deepStrictEqual(flashInput.tasks, { edit: false, flash: true });
assert.strictEqual(flashInput.flashSelectionMode, 'count');
assert.strictEqual(flashInput.flashCount, 6);

const flashAllRun = {
  id: 'flash-all-run',
  status: 'stopped',
  tasks: { edit: false, flash: true },
  account: { id: 'account-4' },
  flashSelectionMode: 'all',
  flashCount: 0,
  progress: { phase: 'flash', completed: 2, total: 67 },
  summary: {
    mode: 'flash-sale',
    results: [
      { activityId: 'A100', activityTitle: '夏季秒杀 50%' },
      { activityId: 'A101', activityTitle: '美妆秒杀 20%', failedCount: 1 },
    ],
  },
};

const flashAllInput = resume.buildResumeRunInput(flashAllRun);
assert.deepStrictEqual(flashAllInput.tasks, { edit: false, flash: true });
assert.strictEqual(flashAllInput.flashSelectionMode, 'all');
assert.strictEqual(flashAllInput.flashCount, 0);
assert.deepStrictEqual(flashAllInput.skipFlashActivityIds, ['A100', 'A101']);
assert.deepStrictEqual(flashAllInput.processedFlashActivities, [
  { activityId: 'A100', activityTitle: '夏季秒杀 50%' },
  { activityId: 'A101', activityTitle: '美妆秒杀 20%' },
]);

const flashLogRun = {
  id: 'flash-log-run',
  status: 'stopped',
  tasks: { edit: false, flash: true },
  account: { id: 'account-5' },
  flashSelectionMode: 'all',
  progress: { phase: 'flash', completed: 2, total: 67 },
  logs: [
    { text: '开始处理活动：夏季秒杀 50%（A100）。' },
    { text: '当前正在：秒杀活动，进度 1%，已完成 1/67，当前对象 A100。' },
    { text: '开始处理活动：美妆秒杀 20%（A101）。' },
    { text: '当前正在：秒杀活动，进度 3%，已完成 2/67，当前对象 A101。' },
    { text: '开始处理活动：被停止的活动（A102）。' },
  ],
};

const flashLogInput = resume.buildResumeRunInput(flashLogRun);
assert.deepStrictEqual(flashLogInput.skipFlashActivityIds, ['A100', 'A101']);
assert.deepStrictEqual(flashLogInput.processedFlashActivities, [
  { activityId: 'A100', activityTitle: '夏季秒杀 50%' },
  { activityId: 'A101', activityTitle: '美妆秒杀 20%' },
]);

const collectRun = {
  id: 'collect-run',
  status: 'stopped',
  tasks: { collect: true, edit: false, flash: false },
  account: { id: 'account-3' },
  collectCount: 12,
  collectSource: '1688',
  collectDedupeWindowDays: 14,
  collectKeywords: '防晒帽',
  collectMaxPriceCny: 30,
  collectPreferredTerms: '防晒',
  collectExcludedTerms: '喷雾',
  collectMinScore: 20,
  collectSafeMode: true,
  collectLinks: 'https://detail.1688.com/offer/1.html',
  progress: { phase: 'collect', completed: 5, total: 12 },
};

const collectInput = resume.buildResumeRunInput(collectRun);
assert.deepStrictEqual(collectInput.tasks, { collect: true, edit: false, flash: false });
assert.strictEqual(collectInput.collectCount, 7);
assert.strictEqual(collectInput.collectDedupeWindowDays, 14);
assert.strictEqual(collectInput.collectKeywords, '防晒帽');
assert.strictEqual(collectInput.collectSafeMode, true);

assert.strictEqual(resume.canResumeRun({ status: 'success' }), false);
assert.throws(
  () => resume.buildResumeRunInput({ id: 'ok', status: 'success' }),
  /不能续跑/,
);

assert.ok(
  serverSource.includes("require('./lib/run_resume')")
    && serverSource.includes('buildResumeRunInput')
    && serverSource.includes('/api/run/resume')
    && serverSource.includes('loadRunDiagnostic(runId)')
    && serverSource.includes('logs: diagnostic.logs'),
  'The web server should expose a resume-run API backed by the resume module and diagnostic logs.',
);

console.log('run resume checks passed');
