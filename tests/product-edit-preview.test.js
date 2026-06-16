const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  appSource.includes('const productEditPreviewItems = computed')
    && appSource.includes('变更预览')
    && appSource.includes('product-edit-preview'),
  'Product page should render a visible edit preview before the task summary.',
);
assert.ok(
  appSource.includes('标题开头')
    && appSource.includes('价格加价')
    && appSource.includes('重量加重')
    && appSource.includes('买一送一规格'),
  'Product edit preview should cover title, price, weight, and buy-one-take-one changes.',
);

console.log('product edit preview checks passed');
