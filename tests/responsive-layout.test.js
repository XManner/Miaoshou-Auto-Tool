const assert = require('assert');
const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

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
