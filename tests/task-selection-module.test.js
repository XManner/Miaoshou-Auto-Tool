const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  serverSource.includes('/vendor/vue.global.prod.js'),
  'The page should load Vue from the local vendor route.',
);
assert.ok(
  serverSource.includes('/vendor/ant-design-vue/antd.min.js'),
  'The page should load Ant Design Vue from the local vendor route.',
);
assert.ok(
  serverSource.includes('/vendor/dayjs/dayjs.min.js'),
  'The page should load Day.js before Ant Design Vue.',
);
assert.ok(
  appSource.includes('mode="horizontal" class="top-menu"'),
  'The Vue app should use an Ant Design Vue top navigation layout.',
);
assert.ok(
  !appSource.includes('<a-layout-sider'),
  'The old left sidebar navigation should be removed.',
);
assert.ok(appSource.includes('首页'), 'Navigation should include 首页.');
assert.ok(appSource.includes('商品采集'), 'Navigation should include 商品采集.');
assert.ok(appSource.includes('编辑商品'), 'Navigation should include 编辑商品.');
assert.ok(appSource.includes('秒杀管理'), 'Navigation should include 秒杀管理.');
assert.ok(
  /<a-menu-item key="home">首页<\/a-menu-item>[\s\S]*<a-menu-item key="collect">商品采集<\/a-menu-item>[\s\S]*<a-menu-item key="products">编辑商品<\/a-menu-item>[\s\S]*<a-menu-item key="flash">秒杀管理<\/a-menu-item>/.test(appSource),
  'Navigation should be ordered as 首页 | 商品采集 | 编辑商品 | 秒杀管理.',
);
assert.ok(
  appSource.includes('src="/assets/tiktok-shop-logo.png"')
    && appSource.includes('alt="TikTok Shop"')
    && appSource.includes('妙手自动化工作台')
    && !appSource.includes('<h1>TikTok跨境电商</h1>')
    && !appSource.includes('<h1>千玺跨境TikTok</h1>')
    && !appSource.includes('<h1>千玺跨境TikTok自动化平台</h1>'),
  'The visible platform title should be replaced by the TikTok Shop logo.',
);
assert.ok(
  appSource.includes('src="/assets/tiktok-shop-logo.png"')
    && appSource.includes('alt="TikTok Shop"')
    && !appSource.includes('<div class="brand-mark">QX</div>'),
  'The brand mark should use the provided local TikTok Shop PNG logo asset instead of the QX text block.',
);
assert.ok(
  serverSource.includes("'/assets/tiktok-shop-logo.png'")
    && fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'tiktok-shop-logo.png')),
  'The web server should serve the local TikTok Shop logo asset.',
);
assert.ok(
  serverSource.includes('<link rel="icon" href="/assets/tiktok-seller-favicon.ico">')
    && serverSource.includes("'/assets/tiktok-seller-favicon.ico'")
    && fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'tiktok-seller-favicon.ico')),
  'The page should use the TikTok Seller favicon from a local asset.',
);
assert.ok(
  serverSource.includes("extension === '.png'")
    && serverSource.includes('image/png')
    && serverSource.includes("extension === '.ico'")
    && serverSource.includes('image/x-icon'),
  'The web server should return PNG and ICO assets with image content types.',
);
assert.ok(
  appSource.includes("v-if=\"currentPage !== 'home'\" class=\"page-hero\"")
    && !appSource.includes("currentPage === 'home'\" class=\"home-grid\""),
  'The home page should not show the task entry grid.',
);
assert.ok(
    appSource.includes('功能概览')
      && appSource.includes('选品到采集箱')
    && appSource.includes('采集 1688 商品')
      && appSource.includes('优化并发布商品信息')
      && appSource.includes('自动设置限时秒杀'),
  'The home page should explain the main automation functions.',
);
assert.ok(
  /@click="navigateToPage\('collect'\)"[\s\S]*@click="navigateToPage\('products'\)"[\s\S]*@click="navigateToPage\('flash'\)"/.test(appSource),
  'The home overview should provide entry buttons for collection, editing, and flash-sale pages.',
);
assert.ok(
  appSource.includes('class="soft-card task-card product-panel"'),
  'Product editing controls should live in the product management page panel.',
);
assert.ok(
  appSource.includes('class="soft-card task-card flash-panel"'),
  'Flash-sale controls should live in the flash management page panel.',
);
assert.ok(
  appSource.includes('form-section form-section-range')
    && appSource.includes('form-section form-section-summary'),
  'Product and flash task forms should expose horizontal layout sections.',
);
assert.ok(
  !appSource.includes('进入商品管理'),
  'The old product-management entry label should stay removed.',
);
assert.ok(
  appSource.includes("currentPage === 'products'")
    && appSource.includes('startProductRun')
    && appSource.includes("currentPage === 'flash'")
    && appSource.includes('startFlashRun'),
  'The hero action area should show page-specific start buttons.',
);
assert.ok(
  /tasks:\s*\{\s*edit:\s*true,\s*flash:\s*Boolean\(productForm\.runFlashAfterEdit\)/.test(appSource),
  'Starting a product task should send an edit-task payload.',
);
assert.ok(
  /<a-form-item label="发布开关">[\s\S]*<a-radio-group v-model:value="productForm\.publish"[\s\S]*<a-radio-button :value="false">不发布<\/a-radio-button>[\s\S]*<a-radio-button :value="true">发布<\/a-radio-button>[\s\S]*<\/a-radio-group>/.test(appSource),
  'The publish option should use radio buttons instead of a switch.',
);
assert.ok(
  /<a-form-item label="完成后继续秒杀">[\s\S]*<a-radio-group v-model:value="productForm\.runFlashAfterEdit"[\s\S]*<a-radio-button :value="false">不执行<\/a-radio-button>[\s\S]*<a-radio-button :value="true">执行<\/a-radio-button>[\s\S]*<\/a-radio-group>/.test(appSource),
  'The follow-up flash-sale option should use radio buttons instead of a switch.',
);
assert.ok(
  !appSource.includes('v-model:checked="productForm.publish"')
    && !appSource.includes('v-model:checked="productForm.runFlashAfterEdit"'),
  'Product publish and follow-up flash-sale options should no longer use switch bindings.',
);
assert.ok(
  /tasks:\s*\{\s*edit:\s*false,\s*flash:\s*true/.test(appSource),
  'Starting a flash task should send a flash-only payload.',
);

console.log('Vue task management page checks passed');
