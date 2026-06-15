const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');
const runSource = source.slice(
  source.indexOf('async function run()'),
  source.indexOf('run().catch'),
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
  /errorCount:\s*failedCount/.test(runSource)
    && /failedCount:\s*1/.test(source)
    && /error:\s*errorMessage/.test(source),
  'Per-activity failures should be included in summary error counts.',
);

console.log('flash activity continuation checks passed');
