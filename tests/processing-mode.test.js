const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("processingMode: 'precise'"),
  'Processing mode should default to precise mode in the UI.',
);
assert.ok(
  /label="处理模式"[\s\S]*<a-radio-group v-model:value="productForm\.processingMode" button-style="solid" class="[^"]*\bmedium-radio-group\b[^"]*"[\s\S]*<a-radio-button value="fast"[^>]*>快速模式<\/a-radio-button>[\s\S]*<a-radio-button value="precise"[^>]*>精细模式<\/a-radio-button>/.test(appSource),
  'Processing mode should use the same medium radio button group style as other single-select settings.',
);
assert.ok(
  !appSource.includes('class="mode-button-group"'),
  'Processing mode should not use a custom button group after radio styles are standardized.',
);
assert.ok(
  !appSource.includes('@click="productForm.processingMode = \'fast\'"')
    && !appSource.includes('@click="productForm.processingMode = \'precise\'"'),
  'Processing mode should update through v-model instead of button click handlers.',
);
assert.ok(
  (appSource.match(/<a-radio-group\b/g) || []).length > 0
    && (appSource.match(/<a-radio-group\b[^>]*>/g) || []).every((tag) => (
      tag.includes('button-style="solid"') && /class="[^"]*\bmedium-radio-group\b[^"]*"/.test(tag)
    )),
  'Every radio group in the UI should use the standardized medium solid button group.',
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
  /label="商品选择"[\s\S]*class="medium-radio-group"/.test(appSource)
    && /label="处理模式"[\s\S]*class="medium-radio-group"/.test(appSource)
    && /label="发布开关"[\s\S]*class="medium-radio-group"/.test(appSource)
    && /label="完成后继续秒杀"[\s\S]*class="medium-radio-group"/.test(appSource)
    && /label="秒杀活动数量"[\s\S]*class="medium-radio-group"/.test(appSource),
  'Single-select settings should use the medium button group style.',
);
assert.ok(
  styles.includes('.medium-radio-group .ant-radio-button-wrapper')
    && styles.includes('height: 32px;')
    && styles.includes('line-height: 30px;')
    && styles.includes('font-size: 14px;')
    && styles.includes('padding: 0 16px;'),
  'Medium radio button groups should use medium button sizing.',
);
assert.ok(
  !appSource.includes('large-radio-group') && !styles.includes('.large-radio-group'),
  'Config radio groups should no longer use the large button class.',
);
assert.ok(
  /\.medium-radio-group\s*\{[\s\S]*?gap:\s*0;/.test(styles),
  'Medium radio button groups should be connected without spacing between buttons.',
);
assert.ok(
  /\.medium-radio-group \.ant-radio-button-wrapper\s*\{[\s\S]*?border-radius:\s*0;/.test(styles),
  'Medium radio button group middle buttons should not keep standalone rounded corners.',
);
assert.ok(
  /\.medium-radio-group \.ant-radio-button-wrapper:first-child\s*\{[\s\S]*?border-radius:\s*8px 0 0 8px;/.test(styles),
  'Medium radio button group should only round the left outside corners.',
);
assert.ok(
  /\.medium-radio-group \.ant-radio-button-wrapper:last-child\s*\{[\s\S]*?border-radius:\s*0 8px 8px 0;/.test(styles),
  'Medium radio button group should only round the right outside corners.',
);
assert.ok(
  !/@media \(max-width: 640px\)\s*\{[\s\S]*?\.medium-radio-group\s*\{\s*grid-template-columns:\s*1fr;\s*\}/.test(styles),
  'Medium radio button groups should stay side-by-side on narrow screens.',
);

console.log('processing mode checks passed');
