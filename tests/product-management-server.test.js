const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  serverSource.includes("const PRODUCT_MANAGEMENT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_product_management.js');"),
  'Server should define the product-management script path.',
);

assert.ok(
  serverSource.includes("const PRODUCT_MANAGEMENT_ACTION_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';"),
  'Server should define the supported product-management action.',
);

assert.ok(
  serverSource.includes('function normalizeProductManagementOptions(input = {})'),
  'Server should normalize product-management options.',
);

assert.ok(
  !serverSource.includes('input.productManagementMaxPages || input.maxPages'),
  'Product-management max-pages should not use || because explicit 0 must be validated.',
);

assert.ok(
  serverSource.includes('input.productManagementMaxPages ?? input.maxPages'),
  'Product-management max-pages should use nullish fallback semantics.',
);

assert.ok(
  /productManagement:\s*Boolean\(rawTasks\.productManagement\)/.test(serverSource),
  'Run task normalization should accept tasks.productManagement.',
);

assert.ok(
  serverSource.includes('if (tasks.productManagement)')
    && serverSource.includes('...normalizeProductManagementOptions(input)'),
  'Product-management tasks should route through the dedicated option normalizer.',
);

assert.ok(
  serverSource.includes('function startProductManagementRun(options)'),
  'Server should have a dedicated product-management run starter.',
);

assert.ok(
  serverSource.includes('node miaoshou_product_management.js --task unpublish-limit-stores'),
  'Product-management command text should invoke the CLI task.',
);

assert.ok(
  serverSource.includes("'--max-pages'")
    && serverSource.includes("'--retain-count'")
    && serverSource.includes("'--dry-run'")
    && serverSource.includes("'--stores'"),
  'Product-management command should pass max-pages, retain-count, dry-run, and stores options.',
);

assert.ok(
  serverSource.includes("productManagement: '商品管理'"),
  'Progress phase labels should include 商品管理.',
);

assert.ok(
  serverSource.includes('phaseLabel: event.phaseLabel || getPhaseLabel(phase)'),
  'Progress updates should preserve phaseLabel emitted by product-management CLI.',
);

assert.ok(
  serverSource.includes('matchedStores: Array.isArray(event.matchedStores)')
    && serverSource.includes('run.progress.matchedStores'),
  'Product-management progress should persist matchedStores from scan events for realtime UI display.',
);

assert.ok(
  serverSource.includes('unmatchedFailureRecords: Array.isArray(event.unmatchedFailureRecords)')
    && serverSource.includes('parsed.unmatchedFailureRecords'),
  'Product-management progress and summaries should preserve unmatched publish-failure diagnostics.',
);

for (const fieldName of [
  'productManagementAction',
  'productManagementMaxPages',
  'productManagementRetainCount',
  'productManagementDryRun',
  'productManagementStores',
]) {
  assert.ok(
    serverSource.includes(fieldName),
    `Serialized/history runs should include ${fieldName}.`,
  );
}

assert.ok(
  serverSource.includes("summary.mode === 'product-limit-store-unpublish'")
    && serverSource.includes('unpublishedCount'),
  'Product-management summaries should keep the CLI mode and unpublished count handling visible.',
);

console.log('product management server checks passed');
