const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  /const visibleHistory = computed\(\(\) => \{[\s\S]*if \(currentPage\.value === 'home'\) \{[\s\S]*return history\.value;[\s\S]*\}[\s\S]*return history\.value\.filter\(\(run\) => historyPageForRun\(run\) === currentPage\.value\);[\s\S]*\}\);/.test(appSource),
  'Recent task history should show all records on home and page-specific records elsewhere.',
);

assert.ok(
  /const hasVisibleHistory = computed\(\(\) => visibleHistory\.value\.length > 0\);/.test(appSource),
  'The shared recent task history panel should use the filtered history for empty and clear states.',
);

assert.ok(
  appSource.includes('<a-list :data-source="visibleHistory" :locale="{ emptyText: \'暂无记录\' }"'),
  'The shared recent task history list should render the page-filtered history.',
);

assert.ok(
  appSource.includes('<a-button :disabled="!hasVisibleHistory" @click="clearHistory">清理记录</a-button>'),
  'The shared recent task history clear button should respect the filtered history state.',
);

assert.ok(
  appSource.includes('<a-table\n                  :data-source="collectHistoryItems"'),
  'The collection page should keep using collection-specific product records.',
);

console.log('page history filter checks passed');
