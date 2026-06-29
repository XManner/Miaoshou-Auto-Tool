const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("products: '编辑商品'")
    && appSource.includes("['products-limit-stores']: '上限店铺商品下架'"),
  'Product edit and product-limit cleanup should have independent page titles.',
);

assert.ok(
  /<a-menu[\s\S]*trigger-sub-menu-action="hover"[\s\S]*<a-sub-menu key="product-management"[\s\S]*<template #title>商品管理<\/template>[\s\S]*<a-menu-item key="products">编辑商品<\/a-menu-item>[\s\S]*<a-menu-item key="products-limit-stores">下架商品<\/a-menu-item>[\s\S]*<\/a-sub-menu>/.test(appSource),
  'Top navigation should expose only product management as a hover submenu with edit and offline entries.',
);
assert.ok(
  appSource.includes('const currentNavKey = computed')
    && appSource.includes("const NAV_PRODUCT_LIMIT_KEY = 'products-limit-stores'")
    && appSource.includes("const NAV_PAGE_KEYS = new Set(['home', DASHBOARD_PAGE_KEY, 'collect', 'products', NAV_PRODUCT_LIMIT_KEY, 'flash', 'config'])")
    && !appSource.includes("await switchPage('products');\n          resetPageScroll();\n          return;"),
  'Product management submenu clicks should navigate to independent page keys instead of switching tabs.',
);
assert.ok(
  appSource.includes('function resetPageScroll()')
    && /async function goPage\(event\) \{[\s\S]*resetPageScroll\(\);[\s\S]*\}/.test(appSource),
  'Top navigation should reset viewport scroll after submenu navigation instead of leaving the page scrolled down.',
);

assert.ok(
  appSource.includes("const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores'"),
  'UI should define the product limit store cleanup action constant.',
);

assert.ok(
  appSource.includes('<a-card v-if="currentPage === \'products\'" title="编辑商品"')
    && appSource.includes('<a-card v-if="currentPage === NAV_PRODUCT_LIMIT_KEY" title="上限店铺商品下架"')
    && !appSource.includes('<a-tabs v-model:active-key="productManagementActiveTab"')
    && !appSource.includes('<a-tab-pane key="limitStores"'),
  'Product edit and product-limit cleanup should render as independent pages, not tabs in one page.',
);

for (const token of [
  'productLimitForm',
  'productLimitTaskSummary',
  'productLimitPreviewStores',
  'productLimitRealtimeStores',
  'startProductLimitCleanupRun',
]) {
  assert.ok(appSource.includes(token), `UI should include ${token}.`);
}

assert.ok(
  appSource.includes('const productLimitRealtimeStores = computed')
    && appSource.includes('runProgress.value')
    && appSource.includes('progress.matchedStores')
    && appSource.includes('productLimitRealtimeStores.value.length'),
  'Product limit preview should display matched stores from realtime progress before the final summary is available.',
);

assert.ok(
  /tasks:\s*\{\s*productManagement:\s*true,\s*edit:\s*false,\s*flash:\s*false,\s*collect:\s*false\s*\}/.test(appSource),
  'Product limit cleanup payload should enable only the productManagement task.',
);

for (const payloadField of [
  'productManagementAction: PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES',
  'productManagementMaxPages',
  'productManagementRetainCount',
  'productManagementDryRun',
  'productManagementStores',
]) {
  assert.ok(appSource.includes(payloadField), `Product limit cleanup payload should include ${payloadField}.`);
}

assert.ok(
  appSource.includes('productManagementDryRun: false')
    && !appSource.includes('productLimitForm.dryRun')
    && !appSource.includes('label="试运行"')
    && !appSource.includes('checked-children="只扫描"')
    && !appSource.includes('un-checked-children="会下架"'),
  'Product limit cleanup UI should remove the trial-run switch and always submit the real cleanup mode.',
);

assert.ok(
  appSource.includes('class="form-section form-section-summary limit-store-number-row"')
    && appSource.includes('class="limit-store-scan-pages"')
    && appSource.includes('label="保留数量"')
    && appSource.includes('class="limit-store-retain-count"')
    && appSource.includes('productLimitForm.retainCount')
    && appSource.includes('从发布失败记录第一页开始向后扫描的页数')
    && !appSource.includes('页数越大，耗时越长')
    && appSource.includes('零销量商品数量不超过这个值时跳过')
    && styles.includes('.limit-store-panel .form-section-summary')
    && styles.includes('grid-column: 1 / -1')
    && styles.includes('.limit-store-number-row')
    && styles.includes('grid-template-columns: repeat(2, minmax(160px, 180px))')
    && styles.includes('.limit-store-scan-pages .ant-input-number')
    && styles.includes('.limit-store-retain-count .ant-input-number'),
  'Product limit cleanup fields should place scan pages and retain count on one row, while manual stores and task summary remain full-width rows.',
);

for (const copyText of [
  '扫描发布失败记录，找出商品数量达到上限的店铺',
  '商店试用期',
  '最多只能使用1000个产品列表',
  '保留数量',
  '销量 0 到 0',
  '100条/页',
  '最后一页',
  '直到不超过这个数量',
]) {
  assert.ok(appSource.includes(copyText), `UI should explain safety rule: ${copyText}.`);
}

assert.ok(
  appSource.includes('run.tasks && run.tasks.productManagement'),
  'Run page matching should detect product-management tasks.',
);
assert.ok(
  appSource.includes('if (page === NAV_PRODUCT_LIMIT_KEY)')
    && appSource.includes('return hasProductManagement && !hasCollect && !hasEdit && !hasFlash;')
    && appSource.includes("if (page === 'products')")
    && appSource.includes('return hasEdit && !hasProductManagement'),
  'Run page matching should keep edit-product records separate from product-limit cleanup records.',
);

const productManagementTaskTextBlock = appSource.slice(
  appSource.indexOf('if (tasks.productManagement)'),
  appSource.indexOf('const parts = [];', appSource.indexOf('if (tasks.productManagement)')),
);

assert.ok(
  productManagementTaskTextBlock.includes("return '上限店铺商品下架';"),
  'Product-management runs without a cleanup summary should still be labeled 上限店铺商品下架.',
);

assert.ok(
  !productManagementTaskTextBlock.includes("return '商品管理';"),
  'Product-management task-text fallback should not use the generic 商品管理 page title.',
);

assert.ok(
  styles.includes('.limit-store-panel')
    && !appSource.includes('class="limit-safety-list'),
  'Product limit cleanup UI should keep the standalone panel without the redundant safety tag list.',
);

assert.ok(
  appSource.includes('每行一个店铺名')
    && appSource.includes('placeholder="X SEVEN SHOP PH"')
    && !appSource.includes('必须带店铺-国家后缀'),
  'Manual store input copy should allow direct store-name search without requiring country suffixes.',
);

assert.ok(
  appSource.includes("currentLabel: isLimitStoreRun ? '当前处理店铺' : '当前正在编辑'")
    && appSource.includes("progressLabel: isLimitStoreRun ? '店铺进度' : '当前进度'"),
  'Product-management progress should use limit-store labels instead of edit-product labels.',
);

assert.ok(
  appSource.includes('const productLimitStarting = ref(false)')
    && appSource.includes('const productLimitBusy = computed(() => loading.value || productLimitStarting.value)')
    && appSource.includes('if (productLimitStarting.value || isRunning.value)')
    && appSource.includes(':disabled="isRunning || productLimitBusy"'),
  'Product limit cleanup start buttons should be guarded against duplicate precheck/confirm flows.',
);
assert.strictEqual(
  (appSource.match(/@click="startProductLimitCleanupRun"/g) || []).length,
  1,
  'Product limit cleanup page should show only one start button.',
);

assert.ok(
  appSource.includes('limit-store-preview-grid')
    && appSource.includes('limit-store-preview-item')
    && !appSource.includes('class="limit-store-preview-list form-section form-section-summary"'),
  'Product limit matched-store preview should use a compact grid instead of a tall one-column list.',
);
assert.ok(
  styles.includes('.limit-store-preview-grid')
    && /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/.test(styles)
    && styles.includes('.limit-store-preview-card')
    && styles.includes('grid-column: 1 / -1'),
  'Product limit matched-store preview styles should pack stores into a full-width responsive grid.',
);

assert.ok(
  !appSource.includes('function syncProductManagementTab()')
    && !appSource.includes('productManagementActiveTab'),
  'Product edit and limit-store cleanup should not share tab state.',
);

console.log('product management UI checks passed');
