const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const runnerFile = path.basename(__filename);
const testFiles = fs.readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.js'))
  .sort();

if (!testFiles.includes('test-command.test.js')) {
  throw new Error('Shared test runner did not discover test-command.test.js.');
}

for (const file of testFiles) {
  const testPath = path.join(testsDir, file);
  console.log(`RUN tests/${file}`);
  const result = spawnSync(process.execPath, [testPath], {
    cwd: path.join(testsDir, '..'),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  if (result.error) {
    throw result.error;
  }
}

console.log(`All ${testFiles.length} test files passed via ${runnerFile}.`);
