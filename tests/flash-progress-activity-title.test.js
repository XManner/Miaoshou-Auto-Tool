const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');

const flashProgressSource = appSource.slice(
  appSource.indexOf('const flashProgress = computed'),
  appSource.indexOf('const allRunLogs = computed'),
);

assert.ok(
  serverSource.includes('detailName: event.detailName ? String(event.detailName) : run.progress.detailName')
    && serverSource.includes('detailName: run.progress.detailName ||'),
  'Server run progress should keep the current flash activity name from progress events.',
);

assert.ok(
  flashProgressSource.includes('progress.detailName')
    && flashProgressSource.includes('activityName')
    && flashProgressSource.includes('activityName || (activityId'),
  'Flash progress UI should prefer the activity name and only fall back to the activity ID.',
);

assert.ok(
  appSource.includes('function flashProcessedActivitiesText')
    && appSource.includes('已处理活动')
    && appSource.includes('flashProcessedActivitiesText(item)'),
  'Recent flash-sale history should display the processed activity names used by continuation.',
);

assert.ok(
  appSource.includes("return `已处理活动：${names.join('、')}`;")
    && !appSource.includes('names.slice(0, 3)')
    && !appSource.includes('等 ${names.length} 个'),
  'Recent flash-sale history should show every processed activity without truncating the list.',
);

console.log('flash progress activity title checks passed');
