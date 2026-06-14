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
  serverSource.includes('function buildServerCapabilities()')
    && serverSource.includes('collectSources: [COLLECT_SOURCE_1688, COLLECT_SOURCE_AMAZON]')
    && serverSource.includes('amazonCollection: true')
    && serverSource.includes('capabilities: buildServerCapabilities()'),
  'Server status should expose collection source capabilities so the UI can detect stale servers.',
);
assert.ok(
  (serverSource.includes('collectSource: normalizeCollectSource')
    || serverSource.includes('const collectSource = normalizeCollectSource')
    || serverSource.includes('const normalizedCollectSource = normalizeCollectSource'))
    && serverSource.includes('collectShopeeSite: normalizeShopeeSite')
    && serverSource.includes('collectShopeeMaxPrice: normalizeCollectNumber'),
  'Server should validate Shopee automatic collection options.',
);
assert.ok(
  serverSource.includes("const COLLECT_SOURCE_AMAZON = 'amazon'")
    && /normalized === COLLECT_SOURCE_AMAZON/.test(serverSource),
  'Server should accept Amazon as a collection source.',
);
assert.ok(
  serverSource.includes('collectAmazonMode')
    && serverSource.includes('collectAmazonMaxPriceUsd')
    && serverSource.includes('collectAmazonMinRating')
    && serverSource.includes('collectAmazonMinReviewCount'),
  'Server should validate and serialize Amazon collection options.',
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
  'Collection command should pass optional direct product links to the script.',
);
assert.ok(
  serverSource.includes("const COLLECT_SOURCE_LINKS = 'links'")
    && /normalized === COLLECT_SOURCE_LINKS/.test(serverSource)
    && serverSource.includes('const collectSource = collectLinks ? COLLECT_SOURCE_LINKS : normalizedCollectSource')
    && serverSource.includes("collectSource === COLLECT_SOURCE_LINKS"),
  'Server should support a generic product-link collection source independent of 1688 or Amazon.',
);
assert.ok(
  serverSource.includes("'--source'")
    && serverSource.includes("'--shopee-site'")
    && serverSource.includes("'--shopee-max-price'")
    && serverSource.includes("'--shopee-max-moq'"),
  'Collection command should pass Shopee automatic collection parameters to the script.',
);
assert.ok(
  serverSource.includes("'--amazon-mode'")
    && serverSource.includes("'--amazon-max-price-usd'")
    && serverSource.includes("'--amazon-min-rating'")
    && serverSource.includes("'--amazon-min-review-count'"),
  'Collection command should pass Amazon browser collection parameters to the script.',
);
assert.ok(
  serverSource.includes('Amazon.com')
    && serverSource.includes('collectAmazonMode ===')
    && serverSource.includes('Amazon 最低评分'),
  'Collection logs should describe Amazon collection mode and filters.',
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
  serverSource.includes('function collectionSummaryReachedTarget(summary)')
    && /function summaryHasErrors\(summary\)\s*\{[\s\S]*collectionSummaryReachedTarget\(summary\)[\s\S]*return false[\s\S]*Number\(summary && summary\.errorCount\) > 0/.test(serverSource),
  'Collection summaries that reach the requested count should not fail only because earlier candidates failed.',
);
assert.ok(
  /function getSummaryErrorMessage\(summary\)\s*\{[\s\S]*collectionSummaryHasTargetShortfall\(summary\)[\s\S]*collectionSummaryReachedTarget\(summary\)[\s\S]*failedItems/.test(serverSource),
  'Collection target shortfalls should be reported before intermediate failed candidate errors.',
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
