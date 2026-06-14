const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../lib/run_history_store');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaoshou-run-history-'));
const historyPath = path.join(tempDir, 'history.json');

const sourceHistory = [
  { id: 'run-1', status: 'success', command: 'node a.js', startedAt: '2026-06-10T00:00:00.000Z' },
  { id: 'run-2', status: 'error', command: 'node b.js', startedAt: '2026-06-10T00:01:00.000Z' },
  { id: 'run-3', status: 'stopped', command: 'node c.js', startedAt: '2026-06-10T00:02:00.000Z' },
];

assert.strictEqual(
  store.saveRunHistory(sourceHistory, { filePath: historyPath, limit: 2 }),
  true,
  'Saving run history should report success.',
);

const loaded = store.loadRunHistory({ filePath: historyPath, limit: 20 });
assert.deepStrictEqual(
  loaded.map((item) => item.id),
  ['run-1', 'run-2'],
  'Persisted run history should respect the configured limit.',
);

const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
assert.strictEqual(raw.version, 1, 'Persisted history should include a version.');
assert.ok(raw.savedAt, 'Persisted history should include a savedAt timestamp.');
assert.ok(Array.isArray(raw.history), 'Persisted history should use a history array.');

fs.writeFileSync(historyPath, '{not valid json', 'utf8');
assert.deepStrictEqual(
  store.loadRunHistory({ filePath: historyPath }),
  [],
  'Corrupt persisted history should not prevent the server from starting.',
);

fs.writeFileSync(historyPath, JSON.stringify({ version: 1, history: sourceHistory }), 'utf8');
assert.strictEqual(store.clearRunHistoryStore({ filePath: historyPath }), true);
assert.strictEqual(fs.existsSync(historyPath), false, 'Clearing history should remove the persisted file.');

assert.ok(
  serverSource.includes("require('./lib/run_history_store')")
    && serverSource.includes('loadRunHistory({ limit: MAX_HISTORY_ITEMS })')
    && serverSource.includes('saveRunHistory(history, { limit: MAX_HISTORY_ITEMS })')
    && serverSource.includes('clearRunHistoryStore()'),
  'The web server should load, save, and clear persisted run history.',
);

console.log('run history store checks passed');
