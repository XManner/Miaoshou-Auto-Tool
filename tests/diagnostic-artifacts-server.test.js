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

console.log('diagnostic artifact server checks passed');
