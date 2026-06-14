const assert = require('assert');
const auto = require('../miaoshou_auto.js');

assert.strictEqual(
  typeof auto.formatWarehouseMappingValidationError,
  'function',
  'Warehouse mapping validation error formatter should be exported for regression tests.',
);

const message = auto.formatWarehouseMappingValidationError({
  site: 'PH',
  attempts: 3,
  selectedShopIds: ['101', '202'],
  missingShopIds: ['101'],
  unresolvedMissingShopIds: ['101'],
  replacementLogs: [
    {
      fromShopId: '101',
      toShopId: '303',
      toSite: 'MY',
    },
  ],
  reason: 'Cannot auto-replace claimed shops without warehouse mapping',
});

assert.ok(
  message.includes('Warehouse mapping validation failed after 3 retries'),
  'Message should keep the original failure context.',
);
assert.ok(
  message.includes('site PH'),
  'Message should include the affected site.',
);
assert.ok(
  message.includes('selected shops: 101,202'),
  'Message should include selected shop ids.',
);
assert.ok(
  message.includes('missing warehouse shops: 101'),
  'Message should include shops that lack warehouses.',
);
assert.ok(
  message.includes('unresolved missing shops: 101'),
  'Message should include shops that could not be replaced.',
);
assert.ok(
  message.includes('replacements tried: 101->303(MY)'),
  'Message should include attempted replacement shops.',
);

console.log('warehouse mapping error checks passed');
