const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');
const runSource = source.slice(
  source.indexOf('async function run()'),
  source.indexOf('run().catch'),
);
const activityPageSizeSource = source.slice(
  source.indexOf('async function selectActivityListPageSize100'),
  source.indexOf('async function findFlashSaleListPage'),
);
const queueSource = source.slice(
  source.indexOf('async function collectRunningActivityQueue'),
  source.indexOf('async function findNextActivityCandidate'),
);

assert.ok(
  source.includes('function buildFailedActivityResult'),
  'Flash sale script should build a structured failed activity result.',
);

assert.ok(
  /try\s*\{[\s\S]*const result = await processActivity\(browser, listPage, target\.activity, runState\);[\s\S]*\}\s*catch \(activityError\)/.test(runSource),
  'A single activity failure should be caught inside the activity loop.',
);

assert.ok(
  runSource.includes('await saveFlashFailureArtifacts(browser, failureContext, activityError);')
    && runSource.includes('buildFailedActivityResult(target.activity, activityError)')
    && runSource.includes('秒杀活动处理失败，已记录失败并继续后续活动'),
  'Failed activity handling should save diagnostics, record the failure, and continue the queue.',
);

assert.ok(
  /results\.push\(result\);[\s\S]*runState\.completed \+= 1;/.test(runSource)
    && /results\.push\(failedResult\);[\s\S]*runState\.completed \+= 1;/.test(runSource),
  'Both successful and failed activities should advance progress.',
);

assert.ok(
  source.includes('--skip-activity-ids')
    && source.includes('args.skipActivityIds')
    && source.includes('processedActivityKeys.add(normalizeText(activityId))'),
  'Flash sale script should accept already-processed activity IDs and skip them on continuation.',
);

assert.ok(
  /detailName:\s*activity\.title/.test(source)
    && /detailName:\s*progressResult && progressResult\.activityTitle/.test(source),
  'Flash sale progress should send the activity title so the UI can show the human-readable activity name.',
);

assert.ok(
  /errorCount:\s*failedCount/.test(runSource)
    && /failedCount:\s*1/.test(source)
    && /error:\s*errorMessage/.test(source),
  'Per-activity failures should be included in summary error counts.',
);

assert.ok(
  activityPageSizeSource.includes('秒杀活动列表分页未切换到 100 条/页')
    && activityPageSizeSource.includes('return false;')
    && !activityPageSizeSource.includes('throw new Error(`没有确认活动列表分页已切换到 100 条/页'),
  'Activity list page-size fallback should warn instead of stopping the whole flash run.',
);

assert.ok(
  source.includes('async function clickNextActivityListPage')
    && queueSource.includes('allowPagination')
    && queueSource.includes('await clickNextActivityListPage(page)')
    && queueSource.includes('继续收集活动ID')
    && runSource.includes('const activityListPageSizeReady = await selectActivityListPageSize100(listPage);')
    && runSource.includes('collectRunningActivityQueue(listPage, runningState.count, { allowPagination: !activityListPageSizeReady })'),
  'When 100/page is not confirmed, flash activity ID collection should paginate through the 20/page list instead of only using visible rows.',
);

console.log('flash activity continuation checks passed');
