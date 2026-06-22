const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cleanupSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'product_limit_store_cleanup.js'), 'utf8');
const loginSource = fs.existsSync(path.join(__dirname, '..', 'lib', 'miaoshou_login.js'))
  ? fs.readFileSync(path.join(__dirname, '..', 'lib', 'miaoshou_login.js'), 'utf8')
  : '';

assert.ok(
  cleanupSource.includes("require('./miaoshou_login')")
    && cleanupSource.includes('openMiaoshouPageWithLogin'),
  'Product limit cleanup should use the shared Miaoshou login recovery before waiting for ERP page text.',
);

assert.ok(
  cleanupSource.includes('await openMiaoshouPageWithLogin(page, PUBLISH_HISTORY_URL')
    && cleanupSource.includes('await openMiaoshouPageWithLogin(page, SHOP_PRODUCTS_URL'),
  'Product limit cleanup should recover login on both publish-record and shop-products pages.',
);

assert.ok(
  cleanupSource.includes('waitForShopProductsPageReady')
    && cleanupSource.indexOf('await waitForShopProductsPageReady(page)') > cleanupSource.indexOf('await openMiaoshouPageWithLogin(page, SHOP_PRODUCTS_URL')
    && cleanupSource.indexOf('await waitForShopProductsPageReady(page)') < cleanupSource.indexOf('await selectExactStore(page, target)'),
  'Product limit cleanup should wait for the shop-products filter area, not just sidebar/menu text, before selecting a store.',
);

assert.ok(
  loginSource.includes('function hasLoginCueText')
    && loginSource.includes('MIAOSHOU_LOGIN_PHONE')
    && loginSource.includes('MIAOSHOU_LOGIN_PASSWORD')
    && loginSource.includes('captcha:')
    && loginSource.includes('等待登录'),
  'Shared Miaoshou login helper should detect login pages, use configured credentials, and surface captcha prompts to the web UI.',
);

assert.ok(
  loginSource.includes('const clip = await page.evaluate')
    && loginSource.includes('normalizedRect')
    && loginSource.includes('unionRects')
    && loginSource.includes('page.screenshot({ path: imagePath, clip })'),
  'Shared Miaoshou login helper should crop captcha screenshots around the captcha controls instead of showing the whole login page.',
);

console.log('product management login recovery checks passed');
