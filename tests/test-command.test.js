const assert = require('assert');
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const runnerPath = path.join(__dirname, 'run-all.js');

assert.strictEqual(
  packageJson.scripts && packageJson.scripts.test,
  'node tests/run-all.js',
  'package.json should expose npm test through the shared test runner.',
);

assert.strictEqual(
  packageJson.scripts && packageJson.scripts['test:unit'],
  'node tests/run-all.js',
  'package.json should expose npm run test:unit for the current lightweight suite.',
);

assert.ok(fs.existsSync(runnerPath), 'tests/run-all.js should exist.');

const runnerSource = fs.readFileSync(runnerPath, 'utf8');

assert.ok(
  runnerSource.includes('readdirSync')
    && runnerSource.includes('.test.js')
    && runnerSource.includes('spawnSync'),
  'The shared runner should discover and execute all .test.js files.',
);

assert.ok(
  runnerSource.includes('test-command.test.js'),
  'The shared runner should protect against accidentally excluding its own command test.',
);

console.log('test command checks passed');
