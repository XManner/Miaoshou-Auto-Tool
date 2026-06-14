const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../miaoshou_auto.js');

assert.strictEqual(
  typeof auto.groupSelectedShopIdsBySite,
  'function',
  'Warehouse validation should expose site-aware shop grouping for regression tests.',
);

const grouped = auto.groupSelectedShopIdsBySite({
  site: 'PH',
  selectedShopIds: ['ph-shop', 'my-shop', 'unknown-shop'],
  selectedShops: [
    { shopId: 'ph-shop', site: 'PH' },
    { shopId: 'my-shop', site: 'MY' },
  ],
});

assert.deepStrictEqual(
  grouped,
  {
    PH: ['ph-shop', 'unknown-shop'],
    MY: ['my-shop'],
  },
  'Warehouse validation should query each known shop from its own site and only use the source site as fallback.',
);

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');
const ensureStart = source.indexOf('async function ensurePrePublishShopsForDetailV2');
const ensureEnd = source.indexOf('async function ensurePrePublishShopsForDetail(', ensureStart + 1);
const ensureSource = source.slice(ensureStart, ensureEnd > ensureStart ? ensureEnd : undefined);

assert.ok(
  ensureSource.includes('buildWarehouseBlueprintFromShopWarehouseApiByShopSite'),
  'Pre-publish warehouse validation should use the site-aware warehouse blueprint builder.',
);

assert.strictEqual(
  typeof auto.buildClaimShopIdsAvoidingMissingSourceShops,
  'function',
  'Warehouse fallback should expose reclaim planning for regression tests.',
);

const reclaimPlan = auto.buildClaimShopIdsAvoidingMissingSourceShops({
  currentClaimShopIds: ['my-shop'],
  missingSourceShopIds: ['my-shop'],
  sourceSite: 'PH',
  groupSites: ['PH', 'MY'],
  shopGroupIndex: {
    groups: [
      {
        groupKey: 'global-shop',
        shops: [
          { shopId: 'ph-shop', site: 'PH' },
          { shopId: 'my-shop', site: 'MY' },
        ],
      },
    ],
    shopIdToGroupKey: new Map([
      ['ph-shop', 'global-shop'],
      ['my-shop', 'global-shop'],
    ]),
  },
  preferredShopIdSet: new Set(['ph-shop']),
});

assert.deepStrictEqual(
  reclaimPlan.claimShopIds,
  ['ph-shop'],
  'Warehouse fallback should never replace a missing shop with the same missing shop.',
);
assert.deepStrictEqual(
  reclaimPlan.replacementLogs.map((entry) => `${entry.fromShopId}->${entry.toShopId}(${entry.toSite})`),
  ['my-shop->ph-shop(PH)'],
  'Warehouse fallback should record the effective replacement shop.',
);

assert.strictEqual(
  typeof auto.buildRequiredShopGroupKeysForWarehouseCapability,
  'function',
  'Pre-publish claim coverage should expose warehouse-capable group filtering for regression tests.',
);
assert.strictEqual(
  typeof auto.filterClaimShopIdsToGroupKeys,
  'function',
  'Pre-publish claim coverage should expose claim filtering for regression tests.',
);

const warehouseAwareShopGroupIndex = {
  groups: [
    {
      groupKey: 'warehouse-ready',
      shops: [
        { shopId: 'ready-ph', site: 'PH' },
        { shopId: 'ready-my', site: 'MY' },
      ],
    },
    {
      groupKey: 'no-warehouse',
      shops: [
        { shopId: 'empty-ph', site: 'PH' },
        { shopId: 'empty-my', site: 'MY' },
      ],
    },
  ],
  shopIdToGroupKey: new Map([
    ['ready-ph', 'warehouse-ready'],
    ['ready-my', 'warehouse-ready'],
    ['empty-ph', 'no-warehouse'],
    ['empty-my', 'no-warehouse'],
  ]),
};

const requiredWarehouseGroupKeys = auto.buildRequiredShopGroupKeysForWarehouseCapability({
  groups: warehouseAwareShopGroupIndex.groups,
  preferredWarehouseShopIdSet: new Set(['ready-ph', 'ready-my']),
});

assert.deepStrictEqual(
  requiredWarehouseGroupKeys,
  ['warehouse-ready'],
  'Groups with no warehouse-capable shop should not block the edit workflow.',
);

assert.deepStrictEqual(
  auto.filterClaimShopIdsToGroupKeys({
    shopIds: ['ready-ph', 'empty-ph'],
    shopGroupIndex: warehouseAwareShopGroupIndex,
    requiredGroupKeys: requiredWarehouseGroupKeys,
  }),
  ['ready-ph'],
  'Existing claims from no-warehouse groups should be removed before warehouse validation.',
);

assert.ok(
  ensureSource.includes('buildRequiredShopGroupKeysForWarehouseCapability'),
  'Pre-publish shop coverage should filter required groups by warehouse capability.',
);
const requiredGroupAssignmentIndex = ensureSource.indexOf('const requiredGroupKeys =');
const requiredGroupAssignmentSource = ensureSource.slice(
  requiredGroupAssignmentIndex,
  requiredGroupAssignmentIndex + 260,
);
assert.ok(
  requiredGroupAssignmentSource.includes('buildRequiredShopGroupKeysForWarehouseCapability'),
  'Pre-publish required group assignment should be directly based on warehouse capability.',
);
assert.ok(
  ensureSource.includes('filterClaimShopIdsToGroupKeys'),
  'Pre-publish shop coverage should drop selected shops from skipped no-warehouse groups.',
);
assert.ok(
  ensureSource.includes('|| claimSelectionChanged'),
  'Pre-publish claim should be sent when local claim selection was compacted or filtered.',
);

console.log('warehouse site grouping checks passed');
