const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("collect: '商品采集'"),
  'Page titles should include 商品采集.',
);
assert.ok(
  /label="采集模式"[\s\S]*<a-radio-group v-model:value="collectForm\.mode" button-style="solid" class="medium-radio-group equal-radio-group"[\s\S]*label="采集来源"[\s\S]*<a-radio-group v-model:value="collectForm\.source" button-style="solid" class="medium-radio-group equal-radio-group"/.test(appSource),
  'Collection source and mode should use the same fixed-width button group as product edit controls.',
);
assert.ok(
  /\.collect-panel \.task-form > \.form-section-choice\s*\{[^}]*grid-column:\s*span 3;/.test(styles),
  'Collection source and mode controls should fit side by side on the same row.',
);
assert.ok(
  /\.collect-panel \.equal-radio-group\s*\{[^}]*width:\s*240px;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/.test(styles)
    && /\.collect-panel \.equal-radio-group \.ant-radio-button-wrapper\s*\{[^}]*min-width:\s*0;/.test(styles),
  'Collection fixed-width button groups should be wider than the product edit controls.',
);
assert.ok(
  appSource.includes("products: '编辑商品'")
    && appSource.includes('<a-card v-if="currentPage === \'products\'" title="编辑商品"'),
  'The product editing workflow should live on the independent 编辑商品 page.',
);
assert.ok(
  /<a-menu-item key="home">首页<\/a-menu-item>[\s\S]*<a-menu-item key="collect">商品采集<\/a-menu-item>[\s\S]*<a-sub-menu key="product-management"[\s\S]*<template #title>商品管理<\/template>[\s\S]*<a-menu-item key="products">编辑商品<\/a-menu-item>[\s\S]*<a-menu-item key="products-limit-stores">下架商品<\/a-menu-item>[\s\S]*<\/a-sub-menu>[\s\S]*<a-menu-item key="flash">秒杀管理<\/a-menu-item>/.test(appSource),
  'Navigation order should be 首页 | 商品采集 | 商品管理 | 秒杀管理.',
);
assert.ok(
  appSource.includes('const collectForm = reactive({'),
  'The UI should define a collection form.',
);
assert.ok(
  !appSource.includes('use1688Login'),
  'Collection UI should not expose 1688 browser login because automated 1688 login is unreliable.',
);
assert.ok(
  appSource.includes("keywords: ''"),
  'Collection keywords should default to empty.',
);
assert.ok(
  appSource.includes("mode: 'auto'"),
  'Collection mode should default to automatic keyword collection.',
);
assert.ok(
  appSource.includes("source: '1688'"),
  'Automatic collection source should default to 1688.',
);
assert.ok(
  appSource.includes('<a-radio-button value="amazon" :disabled="!supportsAmazonCollection">Amazon.com</a-radio-button>'),
  'Collection page should expose Amazon.com as a collection source.',
);
assert.ok(
  !appSource.includes('<a-radio-button value="shopee">')
    && !appSource.includes('label="Shopee 站点"')
    && !appSource.includes("collectForm.mode === 'auto' && collectForm.source === 'shopee'"),
  'Collection page should hide Shopee automatic collection settings until the workflow is implemented.',
);
assert.ok(
  appSource.includes('count: 1'),
  'Collection count should default to 1.',
);
assert.ok(
  appSource.includes('dedupeWindowDays: 7'),
  'Collection dedupe window should default to 7 days.',
);
assert.ok(
  appSource.includes('maxPriceCny: 10'),
  'Collection max purchase price should default to 10 CNY.',
);
assert.ok(
  appSource.includes('minScore: 50'),
  'Collection minimum score should default to 50.',
);
assert.ok(
  appSource.includes("preferredTerms: ''") && appSource.includes("excludedTerms: ''"),
  'Collection preferred and excluded terms should default to empty.',
);
assert.ok(
  appSource.includes('safeMode: false'),
  'Collection safe mode should default to disabled.',
);
assert.ok(
  appSource.includes('amazonMaxPriceUsd: 10000')
    && appSource.includes('amazonMinRating: 0')
    && appSource.includes('amazonMinReviewCount: 0'),
  'Collection form should define Amazon.com filter defaults.',
);
assert.ok(
  appSource.includes('serverCapabilities')
    && appSource.includes('supportsAmazonCollection')
    && appSource.includes('payload.capabilities')
    && appSource.includes("当前后台服务还没有加载 Amazon 采集能力"),
  'Collection UI should block Amazon runs when a stale server process does not advertise Amazon support.',
);
assert.ok(
  appSource.includes('links:') && appSource.includes('collectLinks'),
  'Collection form should support optional direct source links.',
);
assert.ok(
  appSource.includes('自动采集')
    && appSource.includes('链接采集')
    && appSource.includes("collectForm.mode === 'auto'")
    && appSource.includes("collectForm.mode === 'links'"),
  'Collection page should expose separate automatic and direct-link collection modes.',
);
assert.ok(
  appSource.includes('const collectLinkList = computed')
    && appSource.includes("collectForm.mode === 'links' ? Math.max(1, collectLinkList.value.length)")
    && appSource.includes("collectSource: collectForm.mode === 'links' ? 'links' : collectForm.source")
    && appSource.includes("collectShopeeSite: 'my'")
    && appSource.includes("collectAmazonMode: collectForm.mode === 'links' ? 'links' : (collectForm.source === 'amazon'")
    && appSource.includes('collectAmazonMarketplace: \'us\'')
    && appSource.includes('collectAmazonMaxPriceUsd: Number(collectForm.amazonMaxPriceUsd || 0)')
    && appSource.includes('collectAmazonMinRating: Math.max(0, Number(collectForm.amazonMinRating || 0))')
    && appSource.includes('collectAmazonMinReviewCount: Math.max(0, Number(collectForm.amazonMinReviewCount || 0))')
    && appSource.includes("collectKeywords: collectForm.mode === 'auto' ? collectForm.keywords : ''")
    && appSource.includes("collectLinks: collectForm.mode === 'links' ? collectForm.links : ''")
    && appSource.includes('collectDedupeWindowDays: Math.max(1, Number(collectForm.dedupeWindowDays || 7))')
    && appSource.includes("collectSkipFilters: collectForm.mode === 'links'"),
  'Collection payload should submit active mode inputs, source-specific Amazon settings, dedupe days, and derive link-mode target count from pasted links.',
);
assert.ok(
  /label="采集来源" class="form-section form-section-choice" v-if="collectForm\.mode === 'auto'"/.test(appSource),
  'Collection source selector should only be shown for automatic collection.',
);
assert.ok(
  appSource.includes('label="商品链接"')
    && appSource.includes('每行一个商品链接；当前识别到')
    && !appSource.includes('Amazon 链接或 ASIN')
    && !appSource.includes('1688 详情链接'),
  'Direct-link collection should use generic product-link wording instead of platform-specific labels.',
);
assert.ok(
  appSource.includes('<div v-if="collectForm.mode === \'auto\'" class="collect-auto-filter-panel"'),
  'Automatic selection filters should render only in automatic collection mode.',
);
const autoFilterPanelSource = appSource.slice(
  appSource.indexOf('<div v-if="collectForm.mode === \'auto\'" class="collect-auto-filter-panel"'),
  appSource.indexOf('<div class="summary-box form-section form-section-summary">'),
);
assert.ok(
  autoFilterPanelSource.includes('v-model:value="collectForm.count"')
    && autoFilterPanelSource.includes('v-model:value="collectForm.dedupeWindowDays"')
    && autoFilterPanelSource.includes('v-model:value="collectForm.maxPriceCny"')
    && autoFilterPanelSource.includes('v-model:value="collectForm.minScore"')
    && !autoFilterPanelSource.includes('size="large"')
    && (autoFilterPanelSource.match(/size="middle"/g) || []).length >= 6,
  'Collection automatic filter numeric inputs should use middle size instead of large size.',
);
assert.ok(
  appSource.includes('Amazon.com 关键词采集')
    && appSource.includes('最高展示价')
    && appSource.includes('最低评论数'),
  'Collection page should present Amazon.com keyword fields.',
);
assert.ok(
  appSource.includes('妙手开放 API') && !appSource.includes('用妙手插件采集到采集箱'),
  'Collection page should explain API collection instead of Chrome extension collection.',
);
assert.ok(
  appSource.includes('安全模式会强制拦截防晒霜/喷雾/乳液、功效宣称、仿牌等高风险商品。'),
  'Collection safe mode should show a concise helper note.',
);
assert.ok(
  appSource.includes('function collectPayload()'),
  'The UI should build a collection payload.',
);
assert.ok(
  !appSource.includes('label="1688 登录"')
    && !appSource.includes('collectUse1688Login')
    && !appSource.includes('登录 1688')
    && !appSource.includes('登录后采集'),
  'Collection page should not expose or submit 1688 browser login settings.',
);
assert.ok(
  /tasks:\s*\{\s*collect:\s*true,\s*edit:\s*false,\s*flash:\s*false/.test(appSource),
  'Collection payload should start a collection-only task.',
);
assert.ok(
  appSource.includes('startCollectRun'),
  'The UI should have a start handler for collection runs.',
);
assert.ok(
  appSource.includes("currentPage === 'collect'"),
  'The collection page should have page-specific rendering.',
);
assert.ok(
  appSource.includes('run.tasks && run.tasks.collect'),
  'Run matching should understand collection tasks.',
);
assert.ok(
  appSource.includes('collectHistoryItems')
    && appSource.includes('<a-card v-if="currentPage === \'collect\'" title="最近采集记录"')
    && appSource.includes('商品标题')
    && appSource.includes('采购价'),
  'The collection page should show product-level collection records with title and price.',
);
const collectionHistoryPanelSource = appSource.slice(
  appSource.indexOf('<a-card v-if="currentPage === \'collect\'" title="最近采集记录"'),
  appSource.indexOf('<a-card v-if="currentPage !== \'home\' && currentPage !== \'config\' && currentPage !== \'collect\'" title="最近记录"'),
);
assert.ok(
  !collectionHistoryPanelSource.includes('title="重量"'),
  'The collection history table should not show a weight column.',
);
assert.ok(
  appSource.includes('<a-card v-if="currentPage !== \'home\' && currentPage !== \'config\' && currentPage !== \'collect\'" title="最近记录"'),
  'The shared recent task history panel should not replace product records on the collection page.',
);

console.log('1688 collection UI checks passed');
