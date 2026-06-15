const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const diagnosticsSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run_diagnostics.js'), 'utf8');

assert.ok(
  diagnosticsSource.includes('loadRunArtifacts')
    && diagnosticsSource.includes('artifacts: artifactState.artifacts'),
  'Run diagnostics should include captured page artifacts.',
);

assert.ok(
  serverSource.includes("require('./lib/automation_artifacts')")
    && serverSource.includes('artifactFilePath')
    && serverSource.includes('/api/diagnostics/')
    && serverSource.includes('artifacts')
    && serverSource.includes('contentTypeForAsset(filePath)'),
  'The web server should expose diagnostic artifact files.',
);

assert.ok(
  serverSource.includes("extension === '.html'")
    && serverSource.includes("extension === '.json'"),
  'Diagnostic HTML and JSON artifacts should be served with readable content types.',
);

assert.ok(
  serverSource.includes('function renderDiagnosticPage')
    && serverSource.includes('function buildDiagnosticViewModel')
    && serverSource.includes('诊断摘要')
    && serverSource.includes('关键日志')
    && serverSource.includes('页面截图')
    && serverSource.includes('原始诊断数据'),
  'Diagnostic route should render a readable summary page.',
);

assert.ok(
  serverSource.includes("url.searchParams.get('format') === 'json'")
    && serverSource.includes('sendHtml(response, renderDiagnosticPage(diagnostic));'),
  'Diagnostic route should render HTML by default while keeping raw JSON available.',
);

console.log('diagnostic artifact server checks passed');
