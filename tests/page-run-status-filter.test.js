const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  appSource.includes('function runMatchesPage(run, page)'),
  'UI should decide whether a run belongs to the current page.',
);
assert.ok(
  appSource.includes('function pageSummary(run, page)'),
  'UI should derive page-specific summaries instead of always using the global run summary.',
);
assert.ok(
  appSource.includes('const displayRun = computed(() => runMatchesPage(currentRun.value, currentPage.value) ? currentRun.value : null)'),
  'Run panel should use a page-filtered run.',
);
assert.ok(
  appSource.includes('const isPageRunning = computed(() => displayRun.value && displayRun.value.status === \'running\')'),
  'Stop controls in a page panel should only follow that page run state.',
);
assert.ok(
  appSource.includes('run.tasks && run.tasks.flash'),
  'Flash management should only match runs that actually include flash-sale work.',
);
assert.ok(
  appSource.includes('run.tasks && run.tasks.collect'),
  'Collection management should only match runs that actually include collection work.',
);
assert.ok(
  appSource.includes('run.tasks && run.tasks.edit !== false'),
  'Product management should only match runs that actually include product editing work.',
);
assert.ok(
  appSource.includes('{{ buildTaskText(displayRun) }}'),
  'Run descriptions should render the page-filtered run content.',
);
assert.ok(
  !appSource.includes('{{ buildTaskText(currentRun) }}'),
  'Run descriptions must not render the global run on every page.',
);
assert.ok(
  appSource.includes('displayRun && displayRun.captcha && displayRun.captcha.status === \'waiting\''),
  'Captcha prompt should only appear on the page that owns the visible run.',
);
assert.ok(
  appSource.includes('pageLogs(displayRun.value, currentPage.value)'),
  'Logs should be derived from the page-filtered run.',
);

console.log('page run status filter checks passed');
