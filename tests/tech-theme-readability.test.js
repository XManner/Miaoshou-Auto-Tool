const assert = require('assert');
const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

[
  ':root[data-theme="tech"] .summary-box strong',
  ':root[data-theme="tech"] .summary-box p',
  ':root[data-theme="tech"] .progress-head',
  ':root[data-theme="tech"] .empty-log',
  ':root[data-theme="tech"] .ant-select-selection-item',
  ':root[data-theme="tech"] .ant-input-number-input',
  ':root[data-theme="tech"] .ant-switch-inner',
  ':root[data-theme="tech"] .ant-tag',
  ':root[data-theme="tech"] .top-actions .ant-tag',
  ':root[data-theme="tech"] .top-actions .ant-tag-success',
  ':root[data-theme="tech"] .top-actions .ant-tag-processing',
  ':root[data-theme="tech"] .top-actions .ant-tag-error',
  ':root[data-theme="tech"] .top-menu.ant-menu-horizontal > .ant-menu-item:hover',
  ':root[data-theme="tech"] .top-menu.ant-menu-horizontal > .ant-menu-item-active',
  ':root[data-theme="tech"] .top-menu.ant-menu-horizontal > .ant-menu-item-selected',
  ':root[data-theme="tech"] .mode-button-group .ant-btn-default',
  ':root[data-theme="tech"] .ant-btn-primary:disabled',
  ':root[data-theme="tech"] .brand-logo',
  ':root[data-theme="tech"] .config-toolbar',
  ':root[data-theme="tech"] .config-toolbar strong',
  ':root[data-theme="tech"] .config-toolbar span',
  ':root[data-theme="tech"] .miaoshou-account-card',
  ':root[data-theme="tech"] .config-field-status.ant-tag-success',
  ':root[data-theme="tech"] .ant-input-password',
  ':root[data-theme="tech"] .ant-radio-wrapper',
  ':root[data-theme="tech"] .ant-btn-background-ghost',
].forEach((selector) => {
  assert.ok(styles.includes(selector), `Tech theme should style readable text for ${selector}.`);
});

assert.ok(
  /:root\[data-theme="tech"\]\s+\.ant-btn-default:not\(:disabled\)/.test(styles),
  'Tech theme should keep clickable default buttons readable without using disabled colors.',
);
assert.ok(
  /:root\[data-theme="tech"\]\s+\.ant-btn-primary:disabled\s*\{[\s\S]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.64\)\s*!important/.test(styles),
  'Tech theme should keep disabled primary button text readable.',
);
assert.ok(
  /:root\[data-theme="tech"\]\s+\.top-menu\.ant-menu-horizontal\s*>\s*\.ant-menu-item:hover\s*\{[\s\S]*color:\s*#fff\s*!important/.test(styles)
    && /:root\[data-theme="tech"\]\s+\.top-menu\.ant-menu-horizontal\s*>\s*\.ant-menu-item-selected\s*\{[\s\S]*color:\s*#fff\s*!important/.test(styles),
  'Tech theme navigation hover and selected states should keep text readable.',
);
assert.ok(
  /:root\[data-theme="tech"\]\s+\.brand-logo\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/.test(styles)
    && /:root\[data-theme="tech"\]\s+\.brand-logo\s*\{[\s\S]*padding:\s*8px 10px/.test(styles),
  'Tech theme should put the TikTok Shop logo on a light contrast plate.',
);
assert.ok(
  /:root\[data-theme="tech"\]\s+\.config-toolbar\s*\{[\s\S]*background:\s*rgba\(255,\s*77,\s*79,\s*0\.08\)\s*!important/.test(styles)
    && /:root\[data-theme="tech"\]\s+\.miaoshou-account-card\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.04\)\s*!important/.test(styles),
  'Tech theme account config panels should stay dark instead of using light default fills.',
);
assert.ok(
  /:root\[data-theme="tech"\]\s+\.config-field-status\.ant-tag-success\s*\{[\s\S]*color:\s*#d9f99d\s*!important/.test(styles),
  'Tech theme configured tags should remain readable on dark backgrounds.',
);

console.log('tech theme readability checks passed');
