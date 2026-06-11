const fs = require('fs');
const path = require('path');

const DEFAULT_RUN_HISTORY_PATH = path.join(__dirname, '..', '.run-history.json');

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

function normalizeHistoryItem(item = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    ...item,
    id: String(item.id || ''),
    status: String(item.status || ''),
    command: String(item.command || ''),
    startedAt: item.startedAt || '',
    endedAt: item.endedAt || null,
    durationMs: item.durationMs ?? null,
    error: item.error || '',
  };
}

function loadRunHistory(options = {}) {
  const filePath = options.filePath || DEFAULT_RUN_HISTORY_PATH;
  const limit = normalizeLimit(options.limit);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const history = Array.isArray(parsed) ? parsed : parsed.history;
    if (!Array.isArray(history)) {
      return [];
    }
    return history
      .map((item) => normalizeHistoryItem(item))
      .filter((item) => item && item.id)
      .slice(0, limit);
  } catch (error) {
    return [];
  }
}

function saveRunHistory(history = [], options = {}) {
  const filePath = options.filePath || DEFAULT_RUN_HISTORY_PATH;
  const limit = normalizeLimit(options.limit);
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    history: (Array.isArray(history) ? history : [])
      .map((item) => normalizeHistoryItem(item))
      .filter((item) => item && item.id)
      .slice(0, limit),
  };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    return false;
  }
}

function clearRunHistoryStore(options = {}) {
  const filePath = options.filePath || DEFAULT_RUN_HISTORY_PATH;
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
  DEFAULT_RUN_HISTORY_PATH,
  loadRunHistory,
  saveRunHistory,
  clearRunHistoryStore,
};
