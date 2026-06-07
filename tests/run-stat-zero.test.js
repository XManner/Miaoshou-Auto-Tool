const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  /function normalizeMetricCount\(value\)/.test(appSource),
  'Run metrics should normalize display counts.',
);
assert.ok(
  /if \(!summary\) \{\s*return 0;\s*\}/.test(appSource),
  'Run success and failure metrics should show 0 before a summary exists.',
);
assert.ok(
  appSource.includes('Object.is(numeric, -0)'),
  'Run metrics should normalize negative zero to 0.',
);
assert.ok(
  /if \(!run\) \{\s*return \{\s*totalCount: 0,/.test(appSource),
  'Idle total metric should show 0 instead of a dash that Ant Design renders as -0.',
);
assert.ok(
  !appSource.includes("totalCount: '-'"),
  'Run metrics should never pass a dash to the numeric statistic total.',
);
assert.ok(
  /function runDurationMs\(run\)[\s\S]*run\.status === 'running'[\s\S]*Date\.now\(\) - startedAt/.test(appSource),
  'Running duration should be calculated from the run start time.',
);
assert.ok(
  /run\.durationMs !== null && run\.durationMs !== undefined/.test(appSource),
  'Running duration should not treat null durationMs as 0 before checking startedAt.',
);
assert.ok(
  appSource.indexOf('run.durationMs !== null && run.durationMs !== undefined') < appSource.indexOf('const finishedDuration = Number(run.durationMs);'),
  'Duration calculation should check null before converting durationMs to a number.',
);
assert.ok(
  /function buildRunMetrics\(run, summary\)[\s\S]*progress\.totalCount[\s\S]*progress\.completed/.test(appSource),
  'Running metrics should use real-time progress values before final summary exists.',
);
assert.ok(
  appSource.includes('const runMetrics = computed(() => buildRunMetrics(displayRun.value, runSummary.value));'),
  'Run metrics should be computed from the visible run and page summary.',
);
assert.ok(
  appSource.includes(':value="runMetrics.durationText"'),
  'Idle duration should show 0 seconds instead of a dash that renders as -0.',
);

console.log('run statistic zero checks passed');
