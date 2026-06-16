const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_RUN_QUEUE_PATH = path.join(__dirname, '..', '.run-queue.json');

function normalizeAccountSnapshot(account = null) {
  if (!account || typeof account !== 'object') {
    return null;
  }
  const id = String(account.id || '').trim();
  const label = String(account.label || '').trim();
  if (!id && !label) {
    return null;
  }
  return {
    id,
    label,
    complete: Boolean(account.complete),
  };
}

function normalizeQueuedInput(input = {}, accountSnapshot = null) {
  const next = input && typeof input === 'object' ? { ...input } : {};
  const snapshot = normalizeAccountSnapshot(accountSnapshot || next.accountSnapshot || next.account);
  const accountId = String(next.accountId || (next.account && next.account.id) || (snapshot && snapshot.id) || '').trim();
  delete next.account;
  delete next.accountSnapshot;
  if (accountId) {
    next.accountId = accountId;
  }
  return { input: next, accountSnapshot: snapshot };
}

function normalizeQueuedRun(item = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const id = String(item.id || '').trim();
  const normalized = normalizeQueuedInput(item.input, item.accountSnapshot);
  if (!id) {
    return null;
  }

  return {
    id,
    status: 'queued',
    label: String(item.label || '待执行任务'),
    input: normalized.input,
    accountSnapshot: normalized.accountSnapshot,
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function createQueuedRun({ input = {}, label = '', accountSnapshot = null } = {}) {
  return normalizeQueuedRun({
    id: randomUUID(),
    status: 'queued',
    label: String(label || '待执行任务'),
    input,
    accountSnapshot,
    createdAt: new Date().toISOString(),
  });
}

function serializeQueuedRun(item = {}, index = 0) {
  const account = normalizeAccountSnapshot(item.accountSnapshot);
  return {
    id: item.id || '',
    status: item.status || 'queued',
    label: item.label || '待执行任务',
    createdAt: item.createdAt || '',
    position: index + 1,
    account,
  };
}

function serializeQueue(queue = []) {
  return (Array.isArray(queue) ? queue : []).map((item, index) => serializeQueuedRun(item, index));
}

function dequeueNext(queue = []) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const item = list.shift() || null;
  return { item, queue: list };
}

function removeQueuedRun(queue = [], id = '') {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const targetId = String(id || '').trim();
  const index = list.findIndex((item) => item && item.id === targetId);
  if (index < 0) {
    return { removed: null, queue: list };
  }
  const [removed] = list.splice(index, 1);
  return { removed, queue: list };
}

function moveQueuedRun(queue = [], id = '', direction = '') {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const targetId = String(id || '').trim();
  const normalizedDirection = String(direction || '').trim();
  const index = list.findIndex((item) => item && item.id === targetId);
  const offset = normalizedDirection === 'up' ? -1 : (normalizedDirection === 'down' ? 1 : 0);
  const nextIndex = index + offset;

  if (index < 0 || offset === 0 || nextIndex < 0 || nextIndex >= list.length) {
    return { moved: null, queue: list };
  }

  const current = list[index];
  list[index] = list[nextIndex];
  list[nextIndex] = current;
  return { moved: current, queue: list };
}

function normalizeQueueState(parsed) {
  const queue = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.queue) ? parsed.queue : []);
  return {
    paused: !(parsed && !Array.isArray(parsed) && parsed.paused === false),
    queue: queue
      .map((item) => normalizeQueuedRun(item))
      .filter(Boolean),
  };
}

function loadRunQueueState(options = {}) {
  const filePath = options.filePath || DEFAULT_RUN_QUEUE_PATH;
  if (!fs.existsSync(filePath)) {
    return { paused: true, queue: [] };
  }

  try {
    return normalizeQueueState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    return { paused: true, queue: [] };
  }
}

function loadRunQueue(options = {}) {
  return loadRunQueueState(options).queue;
}

function saveRunQueue(queue = [], options = {}) {
  const filePath = options.filePath || DEFAULT_RUN_QUEUE_PATH;
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    paused: options.paused === false ? false : true,
    queue: (Array.isArray(queue) ? queue : [])
      .map((item) => normalizeQueuedRun(item))
      .filter(Boolean),
  };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    return false;
  }
}

function clearRunQueueStore(options = {}) {
  const filePath = options.filePath || DEFAULT_RUN_QUEUE_PATH;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  DEFAULT_RUN_QUEUE_PATH,
  createQueuedRun,
  serializeQueuedRun,
  serializeQueue,
  dequeueNext,
  removeQueuedRun,
  moveQueuedRun,
  loadRunQueueState,
  loadRunQueue,
  saveRunQueue,
  clearRunQueueStore,
};
