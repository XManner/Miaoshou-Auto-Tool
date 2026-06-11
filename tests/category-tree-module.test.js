const assert = require('assert');
const fs = require('fs');
const path = require('path');
const categoryTree = require('../lib/category_tree.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

const tree = {
  nameChinese: '根类目',
  cid: 'root',
  children: [
    {
      categoryNameChinese: '美妆个护',
      categoryId: 'beauty',
      isLastLevel: '0',
      children: [
        {
          name: 'Hair Styling Tools',
          nameChinese: '不插电造型工具',
          cid: 'hair-tools',
          isLastLevel: '1',
        },
      ],
    },
    {
      label: 'Daily Accessory',
      value: 'accessory',
      disabled: true,
    },
  ],
};

const categories = categoryTree.flattenCategoryTree(tree);

assert.strictEqual(
  typeof categoryTree.findCategory,
  'function',
  'Category tree helpers should live in lib/category_tree.js.',
);
assert.deepStrictEqual(
  categories.map((category) => category.cid),
  ['root', 'beauty', 'hair-tools', 'accessory'],
  'Category tree flattening should support common id fields and preserve traversal order.',
);
assert.strictEqual(
  categories.find((category) => category.cid === 'hair-tools').breadcrumb,
  '根类目 > 美妆个护 > 不插电造型工具',
  'Flattened categories should include a readable breadcrumb.',
);
assert.strictEqual(
  categoryTree.findCategory(categories, '不插电造型工具').cid,
  'hair-tools',
  'Category search should prefer exact Chinese name matches.',
);
assert.strictEqual(
  categoryTree.findCategory(categories, 'hair styling').cid,
  'hair-tools',
  'Category search should fall back to case-insensitive English partial matches.',
);
assert.strictEqual(
  categories.find((category) => category.cid === 'accessory').disabled,
  true,
  'Flattened categories should preserve disabled state.',
);
assert.ok(
  autoSource.includes("require('./lib/category_tree')"),
  'miaoshou_auto.js should import category tree helpers from lib/category_tree.js.',
);

console.log('category tree module checks passed');
