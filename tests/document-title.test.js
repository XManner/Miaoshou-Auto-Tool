const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  serverSource.includes('<title>TikTok Shop丨妙手自动化工作台丨首页</title>'),
  'The initial browser tab title should use the home page title.',
);

assert.ok(
  appSource.includes("const DOCUMENT_TITLE_PREFIX = 'TikTok Shop丨妙手自动化工作台'")
    && appSource.includes('function buildDocumentTitle(page)')
    && appSource.includes('function updateDocumentTitle(page = currentPage.value)'),
  'The Vue app should define reusable document title helpers.',
);

assert.ok(
  appSource.includes('return `${DOCUMENT_TITLE_PREFIX}丨${title}`;'),
  'Document titles should use the requested separator and current page title.',
);

assert.ok(
  appSource.includes('document.title = buildDocumentTitle(page);'),
  'The app should write the computed title to document.title.',
);

assert.ok(
  appSource.includes('watch(currentPage, updateDocumentTitle, { immediate: true });'),
  'The browser tab title should update immediately and whenever the page changes.',
);

[
  ['home', '首页'],
  ['collect', '商品采集'],
  ['products', '编辑商品'],
  ["['products-limit-stores']", '上限店铺商品下架'],
  ['flash', '秒杀管理'],
  ['config', '账户配置'],
].forEach(([page, title]) => {
  assert.ok(
    appSource.includes(`${page}: '${title}'`),
    `PAGE_TITLES should include ${page} => ${title}.`,
  );
});

console.log('document title checks passed');
