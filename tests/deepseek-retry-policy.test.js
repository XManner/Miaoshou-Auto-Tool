const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.ok(
  /DEEPSEEK_MAX_RETRIES,\s*2\s*\)/.test(source),
  'DeepSeek should default to 2 retries, giving 3 total attempts.',
);
assert.ok(
  source.includes('function isRetryableDeepSeekError'),
  'DeepSeek retry policy should be centralized in a helper.',
);
assert.ok(
  source.includes("statusCode === 503"),
  'DeepSeek should retry 503 service-busy responses.',
);
assert.ok(
  source.includes("code === 'ETIMEDOUT'"),
  'DeepSeek should retry timeout errors.',
);
assert.ok(
  source.includes('!isRetryableDeepSeekError(lastError)'),
  'DeepSeek should not retry non-transient API errors.',
);

console.log('deepseek retry policy checks passed');
