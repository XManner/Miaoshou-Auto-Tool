const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const flashSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("flashSelectionMode: 'all'")
    && appSource.includes("productFlashSelectionMode: 'all'"),
  'Product and flash forms should default flash activity selection to all activities.',
);
assert.ok(
  appSource.includes('v-model:value="flashForm.flashSelectionMode"')
    && appSource.includes('<a-radio-button value="count">指定数量</a-radio-button>')
    && appSource.includes('<a-radio-button value="all">全部活动</a-radio-button>'),
  'Flash management should expose count/all radio mode choices.',
);
assert.ok(
  /v-model:value="productForm\.productFlashSelectionMode" button-style="solid" class="medium-radio-group"/.test(appSource)
    && /v-model:value="flashForm\.flashSelectionMode" button-style="solid" class="medium-radio-group"/.test(appSource),
  'Product follow-up flash and flash-only selection modes should both use the standardized radio button group.',
);
assert.ok(
  (appSource.match(/class="form-section form-section-small flash-selection-row"/g) || []).length === 2,
  'Product follow-up flash and flash-only quantity controls should use the compact one-row layout.',
);
assert.ok(
  /v-model:value="productForm\.productFlashSelectionMode"[\s\S]*<a-form-item[\s\S]*label="指定数量"[\s\S]*:class="\{ 'flash-count-placeholder': productForm\.productFlashSelectionMode !== 'count' \}"[\s\S]*:aria-hidden="productForm\.productFlashSelectionMode !== 'count'"/.test(appSource)
    && /v-model:value="flashForm\.flashSelectionMode"[\s\S]*<a-form-item[\s\S]*label="指定数量"[\s\S]*:class="\{ 'flash-count-placeholder': flashForm\.flashSelectionMode !== 'count' \}"[\s\S]*:aria-hidden="flashForm\.flashSelectionMode !== 'count'"/.test(appSource),
  'Flash quantity mode and count input should stay in the same row container without collapsing.',
);
assert.ok(
  !appSource.includes("v-if=\"flashForm.flashSelectionMode === 'count'\"")
    && !appSource.includes("v-if=\"productForm.productFlashSelectionMode === 'count'\"")
    && appSource.includes(':aria-hidden="flashForm.flashSelectionMode !== \'count\'"')
    && appSource.includes(':aria-hidden="productForm.productFlashSelectionMode !== \'count\'"'),
  'Flash count input should be hidden in all mode without removing its layout slot.',
);
assert.ok(
  /\.flash-selection-row \.flash-count-placeholder\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/.test(styles),
  'Hidden flash count inputs should be invisible without collapsing the row height.',
);
assert.ok(
  /v-model:value="productForm\.flashCount"[^>]*size="middle"/.test(appSource)
    && /v-model:value="flashForm\.flashCount"[^>]*size="middle"/.test(appSource),
  'Flash count inputs should use medium size controls.',
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
  flashSource.includes('args.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? candidateRunningActivities : candidateRunningActivities.slice(0, args.count)')
    && flashSource.includes('flashSelectionMode: args.flashSelectionMode'),
  'Flash script should process all remaining running activities and report the selected mode.',
);

console.log('flash selection mode checks passed');
