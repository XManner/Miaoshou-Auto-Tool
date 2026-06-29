const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(
  !source.includes('HEARTBEAT_LOG_INTERVAL_MS'),
  'Run logs should not use any time-based heartbeat interval.',
);
assert.ok(
  source.includes('function formatRunStatusLog'),
  'Run status feedback should be formatted in one place.',
);
assert.ok(
  /function formatRunStatusLog[\s\S]*当前正在/.test(source),
  'Status feedback should tell the user what is happening now.',
);
assert.ok(
  !/function formatRunStatusLog[\s\S]*已用时/.test(source),
  'Status log lines should not repeat elapsed-time-only changes.',
);
assert.ok(
  source.includes('function progressLogKey') && source.includes('run.lastProgressLogKey'),
  'Progress logs should be deduplicated when phase, progress, and current item do not change.',
);
assert.ok(
  !source.includes('startRunHeartbeat(run);') && !source.includes('setInterval(() =>'),
  'Runs should not start a timer that writes log lines without a real workflow update.',
);
assert.ok(
  !source.includes('stopRunHeartbeat(run);'),
  'Runs should not need heartbeat cleanup when logs are event-driven.',
);
assert.ok(
  /window\.setInterval\([\s\S]*fetchStatus\(\);[\s\S]*,\s*1000\);/.test(appSource),
  'The page may still refresh status every 1 second without writing log lines.',
);

console.log('run heartbeat feedback checks passed');
