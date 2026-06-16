const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const runPanelSource = appSource.match(/<a-card v-if="currentPage !== 'home' && currentPage !== 'config'" title="运行状态"[\s\S]*?<a-card v-if="currentPage === 'collect'"/)?.[0] || '';

assert.ok(
  appSource.includes('const productProgress = computed')
    && appSource.includes('runProgress.value.detailId')
    && appSource.includes('progress.totalCount')
    && appSource.includes('progress.completed'),
  'Product edit page should derive current item and count progress from run progress.',
);

assert.ok(
  runPanelSource.includes('v-if="currentPage === \'products\'" class="module-progress-panel product-progress-panel"')
    && runPanelSource.includes('当前正在编辑')
    && runPanelSource.includes('当前进度')
    && runPanelSource.includes('总进度'),
  'Product edit run status should show current product, current progress, and total progress.',
);

assert.ok(
  styles.includes('.product-progress-panel')
    && styles.includes('.product-progress-item')
    && /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(styles),
  'Product edit progress visualization should use a stable three-column layout.',
);

console.log('product progress visualization checks passed');
