const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const flashSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

assert.ok(
  appSource.includes("flashSelectionMode: 'count'")
    && appSource.includes("productFlashSelectionMode: 'count'"),
  'Product and flash forms should default flash activity selection to count mode.',
);
assert.ok(
  appSource.includes('v-model:value="flashForm.flashSelectionMode"')
    && appSource.includes('<a-radio-button value="count">指定数量</a-radio-button>')
    && appSource.includes('<a-radio-button value="all">全部活动</a-radio-button>'),
  'Flash management should expose count/all radio mode choices.',
);
assert.ok(
  appSource.includes("v-if=\"flashForm.flashSelectionMode === 'count'\"")
    && appSource.includes("v-if=\"productForm.productFlashSelectionMode === 'count'\""),
  'Flash count input should only be shown in count mode.',
);
assert.ok(
  appSource.includes('flashSelectionMode: productForm.productFlashSelectionMode')
    && appSource.includes('flashSelectionMode: flashForm.flashSelectionMode'),
  'Run payloads should send the selected flash activity mode.',
);

assert.ok(
  serverSource.includes("const FLASH_SELECTION_MODE_COUNT = 'count';")
    && serverSource.includes("const FLASH_SELECTION_MODE_ALL = 'all';")
    && serverSource.includes('function normalizeFlashSelectionMode'),
  'Server should normalize flash selection mode.',
);
assert.ok(
  serverSource.includes("options.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? ['--all'] : ['--count', String(options.flashCount)]")
    && serverSource.includes("run.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? ['--all'] : ['--count', String(run.flashCount)]"),
  'Server should pass --all to the flash script when all activities are selected.',
);

assert.ok(
  flashSource.includes("const FLASH_SELECTION_MODE_COUNT = 'count';")
    && flashSource.includes("const FLASH_SELECTION_MODE_ALL = 'all';")
    && flashSource.includes("if (arg === '--all')"),
  'Flash script should parse --all mode.',
);
assert.ok(
  flashSource.includes('args.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? allRunningActivities : allRunningActivities.slice(0, args.count)')
    && flashSource.includes('flashSelectionMode: args.flashSelectionMode'),
  'Flash script should process all running activities and report the selected mode.',
);

console.log('flash selection mode checks passed');
