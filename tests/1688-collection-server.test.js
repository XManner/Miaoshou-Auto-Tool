const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

assert.ok(
  serverSource.includes("const COLLECT_SCRIPT_PATH = path.join(__dirname, 'miaoshou_1688_collect.js');"),
  'Server should define the 1688 collection script path.',
);
assert.ok(
  serverSource.includes('const COLLECT_TASK_DEFAULT_KEYWORDS'),
  'Server should define default collection keywords for the UI/API path.',
);
assert.ok(
  serverSource.includes("const COLLECT_TASK_DEFAULT_KEYWORDS = '';"),
  'Server default collection keywords should be empty.',
);
assert.ok(
  serverSource.includes("const COLLECT_TASK_DEFAULT_PREFERRED_TERMS = '';")
    && serverSource.includes("const COLLECT_TASK_DEFAULT_EXCLUDED_TERMS = '';"),
  'Server default preferred and excluded terms should be empty.',
);
assert.ok(
  serverSource.includes('collectSafeMode: normalizeCollectBoolean(input.collectSafeMode ?? input.safeMode, false)'),
  'Server default safe mode should be disabled.',
);
assert.ok(
  serverSource.includes("collectMinScore: normalizeCollectInteger(input.collectMinScore || input.minScore, 50, 0, 100, '最低评分')"),
  'Server default minimum score should be 50.',
);
assert.ok(
  serverSource.includes('function normalizeCollectOptions(input = {})'),
  'Server should validate collection task options.',
);
assert.ok(
  serverSource.includes('collectSource: normalizeCollectSource')
    && serverSource.includes('collectShopeeSite: normalizeShopeeSite')
    && serverSource.includes('collectShopeeMaxPrice: normalizeCollectNumber'),
  'Server should validate Shopee automatic collection options.',
);
assert.ok(
  serverSource.includes('function startCollectRun(options)'),
  'Server should have a dedicated collection run starter.',
);
assert.ok(
  /collect:\s*Boolean\(rawTasks\.collect\)/.test(serverSource),
  'Run task normalization should accept tasks.collect.',
);
assert.ok(
  serverSource.includes("tasks.collect && !tasks.edit && !tasks.flash"),
  'Collection-only runs should be routed independently of edit and flash runs.',
);
assert.ok(
  serverSource.includes("'--keywords'") && serverSource.includes("'--max-price'"),
  'Collection command should pass keywords and max price to the script.',
);
assert.ok(
  serverSource.includes('collectLinks') && serverSource.includes("'--links'"),
  'Collection command should pass optional direct 1688 detail links to the script.',
);
assert.ok(
  serverSource.includes("'--source'")
    && serverSource.includes("'--shopee-site'")
    && serverSource.includes("'--shopee-max-price'")
    && serverSource.includes("'--shopee-max-moq'"),
  'Collection command should pass Shopee automatic collection parameters to the script.',
);
assert.ok(
  serverSource.includes('collectKeywords') && serverSource.includes('collectMaxPriceCny'),
  'Serialized runs should include collection settings.',
);
assert.ok(
  serverSource.includes("collect: '商品采集'"),
  'Progress phase labels should include 商品采集.',
);
assert.ok(
  serverSource.includes('function collectionSummaryHasTargetShortfall(summary)'),
  'Collection summaries should detect when the requested collection count was not reached.',
);
assert.ok(
  serverSource.includes('collectionSummaryHasTargetShortfall(summary)'),
  'Summary error detection should treat collection target shortfalls as failures.',
);
assert.ok(
  serverSource.includes('商品采集未达到目标'),
  'Collection target shortfalls should produce a clear error message instead of a completion message.',
);
assert.ok(
  serverSource.includes('function extractProcessErrorMessage(stderrText = \'\')')
    && serverSource.includes('run.error = extractProcessErrorMessage(run.stderr) || `退出码：${code}`;'),
  'Collection process failures should show the meaningful stderr error before falling back to exit code.',
);

console.log('1688 collection server checks passed');
