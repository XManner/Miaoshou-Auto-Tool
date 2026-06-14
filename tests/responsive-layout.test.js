const assert = require('assert');
const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const productPanelSource = appSource.match(/<a-card v-if="currentPage === 'products'"[\s\S]*?<a-card v-if="currentPage === 'flash'"/)?.[0] || '';

assert.ok(
  styles.includes('.app-shell'),
  'The Vue page should define a full-page Ant Design layout shell.',
);
assert.ok(
  appSource.includes("label: '科技蓝'") && appSource.includes("primary: '#1677ff'")
    && !appSource.includes("label: '默认蓝'"),
  'The blue theme should be labeled 科技蓝 instead of 默认蓝.',
);
assert.ok(
  appSource.includes("label: '科技风'") && appSource.includes("primary: '#ff4d4f'"),
  'The tech theme should use a black-red palette instead of the previous teal palette.',
);
assert.ok(
  styles.includes('.dashboard-frame') && appSource.includes('<a-layout-header class="top-nav">'),
  'The page should use the new rounded dashboard frame with a top navigation bar.',
);
assert.ok(
  styles.includes('.app-shell {\n  min-height: 100vh;\n  padding: 0;')
    && styles.includes('.dashboard-frame {\n  width: 100%;')
    && styles.includes('border-radius: 0;'),
  'The outer app frame should fill the viewport without page-edge gutters.',
);
assert.ok(
  appSource.includes('class="top-menu"') && !appSource.includes('<a-layout-sider'),
  'The old left sidebar navigation should be removed in favor of top navigation.',
);
assert.ok(
  appSource.includes('src="/assets/tiktok-shop-logo.png"')
    && appSource.includes('alt="TikTok Shop"')
    && appSource.includes('妙手自动化工作台')
    && !appSource.includes('<h1>TikTok跨境电商</h1>')
    && !appSource.includes('<h1>千玺跨境TikTok</h1>')
    && !appSource.includes('<h1>千玺跨境TikTok自动化平台</h1>'),
  'The main brand title should use the TikTok Shop logo instead of title text.',
);
assert.ok(
  appSource.includes("v-if=\"currentPage !== 'home'\" class=\"page-hero\"")
    && appSource.includes("<a-card v-if=\"currentPage !== 'home' && currentPage !== 'config'\" title=\"运行状态\""),
  'The home and config pages should hide the run status panel.',
);
assert.ok(
  !appSource.includes("currentPage === 'home'\" class=\"home-grid\"")
    && appSource.includes('home-history-panel'),
  'The home page should only keep the recent history card.',
);
assert.ok(
  styles.includes('.work-grid') && styles.includes('grid-template-columns: 1fr;'),
  'Work pages should use the full available width instead of a narrow control column.',
);
assert.ok(
  styles.includes('.task-form') && styles.includes('grid-template-columns: repeat(12, minmax(0, 1fr));'),
  'Product and flash forms should use a horizontal 12-column grid on wide screens.',
);
assert.ok(
  styles.includes('.form-section-summary') && styles.includes('.form-section-actions'),
  'The horizontal task form should place summaries and actions in managed grid sections.',
);
assert.ok(
  /\.flash-panel \.form-section-summary\s*\{[^}]*grid-column:\s*1 \/ -1;/.test(styles),
  'The flash task summary should occupy its own full-width row below the controls.',
);
assert.ok(
  !/<a-input-number[^>]*size="large"/.test(productPanelSource)
    && (productPanelSource.match(/<a-input-number[^>]*size="middle"/g) || []).length >= 5,
  'Product edit numeric inputs should use medium size controls.',
);
assert.ok(
  /label="处理模式"[\s\S]*label="商品选择"[\s\S]*label="开始序号"[\s\S]*label="商品数量"/.test(productPanelSource),
  'Product edit controls should start with processing mode, then product selection and range inputs.',
);
assert.ok(
  /\.product-panel \.form-section-mode\s*\{[^}]*grid-column:\s*1 \/ span 2;[^}]*grid-row:\s*1;/.test(styles)
    && /\.product-panel \.form-section-pricing\s*\{[^}]*grid-column:\s*3 \/ span 4;[^}]*grid-row:\s*1;/.test(styles)
    && /\.product-panel \.form-section-offer\s*\{[^}]*grid-column:\s*7 \/ span 2;[^}]*grid-row:\s*1;/.test(styles),
  'Product edit first row should start with processing mode and keep pricing plus offer controls together.',
);
assert.ok(
  /\.product-panel \.form-section-choice\s*\{[^}]*grid-column:\s*1 \/ span 2;[^}]*grid-row:\s*2;/.test(styles)
    && /\.product-panel \.form-section-range\s*\{[^}]*grid-column:\s*3 \/ span 4;[^}]*grid-row:\s*2;/.test(styles),
  'Product edit product selection and shorter range controls should occupy the second row by themselves.',
);
assert.ok(
  !/<a-row[^>]*v-if="productForm\.itemSelectionMode === 'range'"[^>]*class="form-section form-section-range"/.test(productPanelSource)
    && /class="form-section form-section-range"[\s\S]*:class="\{ 'range-placeholder': productForm\.itemSelectionMode !== 'range' \}"/.test(productPanelSource)
    && /:aria-hidden="productForm\.itemSelectionMode !== 'range'"/.test(productPanelSource),
  'Product edit range controls should keep their layout slot when switching to all products.',
);
assert.ok(
  /\.product-panel \.form-section-range\.range-placeholder\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/.test(styles),
  'Product edit hidden range controls should be invisible without collapsing the second-row slot.',
);
assert.ok(
  /\.product-panel \.form-section-switches\s*\{[^}]*grid-column:\s*1 \/ span 4;[^}]*grid-row:\s*3;/.test(styles)
    && /\.product-panel \.flash-selection-row\s*\{[^}]*grid-column:\s*5 \/ span 4;[^}]*grid-row:\s*3;/.test(styles),
  'Product edit follow-up flash controls should sit to the right of the publish and follow-up switches.',
);
assert.ok(
  (productPanelSource.match(/class="medium-radio-group equal-radio-group"/g) || []).length >= 3
    && /\.product-panel \.equal-radio-group\s*\{[^}]*width:\s*168px;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/.test(styles)
    && /\.product-panel \.equal-radio-group \.ant-radio-button-wrapper\s*\{[^}]*min-width:\s*0;/.test(styles),
  'Product edit primary radio button groups should share the same fixed width.',
);
assert.ok(
  /\.product-panel \.form-section-mode,\s*\.product-panel \.form-section-choice,\s*\.product-panel \.form-section-range,\s*\.product-panel \.form-section-pricing,\s*\.product-panel \.form-section-offer,\s*\.product-panel \.form-section-switches,\s*\.product-panel \.flash-selection-row\s*\{[^}]*grid-row:\s*auto;/.test(styles),
  'Product edit explicit desktop rows should be reset on small screens.',
);
assert.ok(
  /\.product-panel \.medium-radio-group\s*\{[^}]*width:\s*max-content;[^}]*grid-template-columns:\s*repeat\(2, max-content\);/.test(styles)
    && /\.product-panel \.medium-radio-group \.ant-radio-button-wrapper\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*76px;[^}]*padding:\s*0 12px;/.test(styles),
  'Product edit radio button groups should use compact content width instead of stretching.',
);
assert.ok(
  /\.flash-selection-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content 112px;[^}]*gap:\s*12px;/.test(styles),
  'Flash quantity controls should sit in one compact row.',
);
assert.ok(
  /\.flash-selection-row \.medium-radio-group\s*\{[^}]*width:\s*max-content;[^}]*grid-template-columns:\s*repeat\(2, max-content\);/.test(styles)
    && /\.flash-selection-row \.medium-radio-group \.ant-radio-button-wrapper\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*88px;/.test(styles),
  'Flash quantity radio buttons should use compact content width instead of stretching.',
);
assert.ok(
  styles.includes('.collect-auto-filter-panel')
    && styles.includes('.collect-auto-filter-panel {\n  grid-column: 1 / -1;')
    && styles.includes('.collect-auto-filter-panel > .form-section {\n  grid-column: 1 / -1;'),
  'The automatic collection filter panel should span the full form grid width.',
);
assert.ok(
  styles.includes('@media (max-width: 1180px)'),
  'The page should switch to a single-column layout on narrow screens.',
);
assert.ok(
  styles.includes('.top-actions')
    && styles.includes('.theme-select')
    && styles.includes('.theme-select,'),
  'Header actions should stay compact after removing the global account selector.',
);
assert.ok(
  styles.includes('.log-box') && styles.includes('flex: 1 1 420px;'),
  'Run logs should grow inside the run status panel.',
);
assert.ok(
  styles.includes(':root[data-theme="tech"] .ant-select-selector')
    && styles.includes(':root[data-theme="tech"] .ant-alert-info'),
  'The black-red tech theme should cover Ant Design form controls and alert panels.',
);
assert.ok(
  !styles.includes('width: min(1120px, calc(100vw - 32px));'),
  'The new page should not keep the old 1120px wrapper cap.',
);
assert.ok(
  appSource.includes('@scroll="onLogScroll"'),
  'The log panel should detect manual scrolling before auto-pinning new output.',
);

console.log('responsive Vue layout checks passed');
