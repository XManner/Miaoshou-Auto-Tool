const fs = require('fs');
const path = require('path');
const { maskPhoneText } = require('./project_config');
const { loadRunArtifacts } = require('./automation_artifacts');
const { classifyFailureText, classifyRunFailure } = require('./run_failure_classification');

const DEFAULT_DIAGNOSTIC_DIR = path.join(__dirname, '..', '.diagnostics');

function safeDiagnosticId(value = '') {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 160);
}

function diagnosticPath(id = '', options = {}) {
  const safeId = safeDiagnosticId(id);
  return safeId ? path.join(options.dir || DEFAULT_DIAGNOSTIC_DIR, `${safeId}.json`) : '';
}

function tailText(value = '', lineLimit = 80) {
  return String(value || '')
    .split(/\r?\n/)
    .slice(-lineLimit)
    .join('\n');
}

function sanitizeLogEntry(entry = {}) {
  return {
    time: entry.time || entry.createdAt || '',
    stream: entry.stream || 'system',
    text: maskPhoneText(entry.text || ''),
  };
}

function buildRunDiagnostic(run = {}, options = {}) {
  const logLimit = Number.isFinite(Number(options.logLimit)) ? Number(options.logLimit) : 80;
  const artifactState = run.id ? loadRunArtifacts(run.id, { dir: options.dir || DEFAULT_DIAGNOSTIC_DIR }) : { artifacts: [] };
  return {
    id: run.id || '',
    generatedAt: new Date().toISOString(),
    status: run.status || '',
    failureType: classifyRunFailure(run),
    command: run.command || '',
    startedAt: run.startedAt || '',
    endedAt: run.endedAt || '',
    durationMs: run.durationMs ?? null,
    error: maskPhoneText(run.error || ''),
    account: run.account || null,
    tasks: run.tasks || {},
    progress: run.progress || null,
    summary: run.summary || null,
    logs: (Array.isArray(run.logs) ? run.logs : [])
      .slice(-logLimit)
      .map((entry) => sanitizeLogEntry(entry)),
    stderrTail: maskPhoneText(tailText(run.stderr || '', options.stderrLineLimit || 80)),
    artifacts: artifactState.artifacts,
  };
}

function shouldPersistDiagnostic(run = {}) {
  return Boolean(run && run.id && (run.status === 'error' || run.status === 'stopped'));
}

function saveRunDiagnostic(run = {}, options = {}) {
  if (!shouldPersistDiagnostic(run)) {
    return null;
  }

  const filePath = diagnosticPath(run.id, options);
  if (!filePath) {
    return null;
  }

  const diagnostic = buildRunDiagnostic(run, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  return {
    id: diagnostic.id,
    filePath,
    failureType: diagnostic.failureType,
    generatedAt: diagnostic.generatedAt,
  };
}

function loadRunDiagnostic(id = '', options = {}) {
  const filePath = diagnosticPath(id, options);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

module.exports = {
  DEFAULT_DIAGNOSTIC_DIR,
  safeDiagnosticId,
  diagnosticPath,
  classifyFailureText,
  classifyRunFailure,
  buildRunDiagnostic,
  saveRunDiagnostic,
  loadRunDiagnostic,
};
