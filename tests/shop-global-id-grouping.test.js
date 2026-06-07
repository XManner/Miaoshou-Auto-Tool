const assert = require('assert');
const auto = require('../miaoshou_auto.js');

assert.strictEqual(
  typeof auto.buildShopGroupKey,
  'function',
  'Shop grouping key helper should be exported for regression tests.',
);

const phShop = {
  shopId: '101',
  site: 'PH',
  shopNick: 'Alpha Philippines',
  globalShopId: '900001',
};
const myShop = {
  shopId: '202',
  site: 'MY',
  shopNick: 'Completely Different Malaysia Name',
  globalShopId: '900001',
};
const thShop = {
  shopId: '303',
  site: 'TH',
  shopNick: 'Alpha Thailand',
  globalShopId: '900002',
};

assert.strictEqual(
  auto.buildShopGroupKey(phShop),
  'global:900001',
  'Global shop id should be the primary grouping key.',
);
assert.strictEqual(
  auto.buildShopGroupKey(phShop),
  auto.buildShopGroupKey(myShop),
  'Shops with the same global shop id should be grouped together even when nicknames differ.',
);
assert.notStrictEqual(
  auto.buildShopGroupKey(phShop),
  auto.buildShopGroupKey(thShop),
  'Different global shop ids should not be grouped together.',
);
assert.strictEqual(
  auto.buildShopGroupKey({
    shopId: '404',
    site: 'PH',
    shopNick: 'Fallback PH',
  }),
  'nick:fallback',
  'Shops without a global shop id should keep the existing nickname-based fallback.',
);

console.log('shop global id grouping checks passed');
