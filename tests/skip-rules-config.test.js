const assert = require('assert');
const fs = require('fs');
const path = require('path');

const configSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'project_config.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

for (const key of ['SKIP_KEYWORDS', 'SKIP_PRODUCT_IDS', 'SKIP_ACTIVITY_IDS']) {
  assert.ok(!configSource.includes(`key: '${key}'`), `Project config should not expose ${key}.`);
}
assert.ok(
  !configSource.includes("title: '任务规则'")
    && !appSource.includes('任务规则')
    && !appSource.includes('跳过关键词')
    && !appSource.includes('跳过商品 ID')
    && !appSource.includes('跳过秒杀活动 ID'),
  'Config UI should not expose task rules.',
);
assert.ok(
  !serverSource.includes("require('./lib/skip_rules')")
    && !serverSource.includes('getSkipRules')
    && !serverSource.includes('applySkipRulesToRunOptions'),
  'The server should not load or apply hidden task skip rules.',
);

console.log('removed task rules config checks passed');
