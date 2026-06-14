const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  appSource.includes('canResumeHistoryItem')
    && appSource.includes('resumeHistoryRun')
    && appSource.includes("requestJson('/api/run/resume'")
    && appSource.includes('openDiagnostic'),
  'The UI should expose recovery helpers for history items.',
);

assert.ok(
  appSource.includes('item.diagnosticId')
    && appSource.includes('诊断')
    && appSource.includes('继续')
    && appSource.includes('恢复执行'),
  'History records should show diagnostic and resume actions.',
);

assert.ok(
  appSource.includes("['error', 'stopped'].includes(item.status)")
    && appSource.includes('window.open(`/api/diagnostics/${encodeURIComponent(item.diagnosticId)}`'),
  'Resume should be limited to failed/stopped runs and diagnostics should open the persisted package.',
);

console.log('run recovery UI checks passed');
