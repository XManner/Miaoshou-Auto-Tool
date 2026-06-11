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

const collectRun = {
  id: 'collect-run',
  status: 'stopped',
  tasks: { collect: true, edit: false, flash: false },
  account: { id: 'account-3' },
  collectCount: 12,
  collectSource: '1688',
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
    && serverSource.includes('/api/run/resume'),
  'The web server should expose a resume-run API backed by the resume module.',
);

console.log('run resume checks passed');
