const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("processingMode: 'fast'"),
  'Processing mode should default to fast mode in the UI.',
);
assert.ok(
  appSource.includes('class="mode-button-group"'),
  'Processing mode should use two button-style choices.',
);
assert.ok(
  appSource.includes(':type="productForm.processingMode === \'fast\' ? \'primary\' : \'default\'"'),
  'Fast mode button should show selected state.',
);
assert.ok(
  appSource.includes(':type="productForm.processingMode === \'precise\' ? \'primary\' : \'default\'"'),
  'Precise mode button should show selected state.',
);
assert.ok(
  appSource.includes('@click="productForm.processingMode = \'fast\'"'),
  'Fast mode button should update the selected mode.',
);
assert.ok(
  appSource.includes('@click="productForm.processingMode = \'precise\'"'),
  'Precise mode button should update the selected mode.',
);
assert.ok(
  appSource.includes('processingMode: productForm.processingMode'),
  'Run request should send the selected processing mode.',
);
assert.ok(
  source.includes('function normalizeProcessingMode'),
  'Server should normalize processing mode input.',
);
assert.ok(
  /ENABLE_MIMO_IMAGE_RELEVANCE_CHECK:\s*[\s\S]*PROCESSING_MODE_PRECISE[\s\S]*\?\s*'1'\s*:\s*'0'/.test(source),
  'Processing mode should only toggle MiMo image relevance checks between precise and fast mode.',
);
assert.ok(
  !source.includes('ENABLE_MIMO_WEIGHT_ESTIMATION:'),
  'Processing mode should not override MiMo weight estimation.',
);
assert.ok(
  !source.includes('ENABLE_MIMO_SPEC_TRANSLATION:'),
  'Processing mode should not override MiMo spec translation.',
);
assert.ok(
  appSource.includes('图片审核只用本地规则'),
  'Fast mode copy should explain that image audit uses local rules.',
);
assert.ok(
  appSource.includes('图片审核使用 MiMo'),
  'Precise mode copy should explain that image audit uses MiMo.',
);
assert.ok(
  appSource.includes('token 消耗很大'),
  'Precise mode copy should warn about high token usage.',
);
assert.ok(
  !appSource.includes('价格异常和重量异常始终按异常处理逻辑执行，不受模式影响'),
  'Mode helper copy should not show an extra note below the mode cards.',
);
assert.ok(
  !appSource.includes('class="mode-group"'),
  'Processing mode should no longer use long radio options.',
);
assert.ok(
  /label="商品选择"[\s\S]*class="large-radio-group"/.test(appSource)
    && /label="发布开关"[\s\S]*class="large-radio-group"/.test(appSource)
    && /label="完成后继续秒杀"[\s\S]*class="large-radio-group"/.test(appSource),
  'Product choice, publish, and follow-up flash-sale radios should use the large button group style.',
);
assert.ok(
  styles.includes('.large-radio-group .ant-radio-button-wrapper')
    && styles.includes('height: 40px;')
    && styles.includes('line-height: 38px;')
    && styles.includes('font-size: 16px;'),
  'Large radio button groups should match the processing mode button size.',
);

console.log('processing mode checks passed');
