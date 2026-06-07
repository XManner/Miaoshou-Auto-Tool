const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  appSource.includes("collect: '商品采集'"),
  'Page titles should include 商品采集.',
);
assert.ok(
  appSource.includes("products: '编辑商品'"),
  'The product editing page should be labeled 编辑商品.',
);
assert.ok(
  /<a-menu-item key="home">首页<\/a-menu-item>[\s\S]*<a-menu-item key="collect">商品采集<\/a-menu-item>[\s\S]*<a-menu-item key="products">编辑商品<\/a-menu-item>[\s\S]*<a-menu-item key="flash">秒杀管理<\/a-menu-item>/.test(appSource),
  'Navigation order should be 首页 | 商品采集 | 编辑商品 | 秒杀管理.',
);
assert.ok(
  appSource.includes('const collectForm = reactive({'),
  'The UI should define a collection form.',
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
  !appSource.includes('<a-radio-button value="shopee">')
    && !appSource.includes('label="Shopee 站点"')
    && !appSource.includes("collectForm.mode === 'auto' && collectForm.source === 'shopee'"),
  'Collection page should hide Shopee automatic collection settings until the workflow is implemented.',
);
assert.ok(
  appSource.includes('collectCount: 10') || appSource.includes('count: 10'),
  'Collection count should default to 10.',
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
  appSource.includes('links:') && appSource.includes('collectLinks'),
  'Collection form should support optional direct 1688 detail links.',
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
    && appSource.includes("collectSource: '1688'")
    && appSource.includes("collectShopeeSite: 'my'")
    && appSource.includes("collectKeywords: collectForm.mode === 'auto' ? collectForm.keywords : ''")
    && appSource.includes("collectLinks: collectForm.mode === 'links' ? collectForm.links : ''")
    && appSource.includes("collectSkipFilters: collectForm.mode === 'links'"),
  'Collection payload should submit active mode inputs, force 1688 as the visible source, and derive link-mode target count from pasted links.',
);
assert.ok(
  appSource.includes('<div v-if="collectForm.mode === \'auto\'" class="collect-auto-filter-panel"'),
  'Automatic selection filters should render only in automatic collection mode.',
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
    && appSource.includes('采购价')
    && appSource.includes('重量'),
  'The collection page should show product-level collection records with title, price, and weight.',
);
assert.ok(
  appSource.includes('<a-card v-if="currentPage !== \'config\' && currentPage !== \'collect\'" title="最近记录"'),
  'The shared recent task history panel should not replace product records on the collection page.',
);

console.log('1688 collection UI checks passed');
