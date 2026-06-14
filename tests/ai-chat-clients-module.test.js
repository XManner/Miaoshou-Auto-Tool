const assert = require('assert');
const fs = require('fs');
const path = require('path');
const aiClients = require('../lib/ai_chat_clients.js');

function response({ ok = true, status = 200, statusText = 'OK', body = {} } = {}) {
  return {
    ok,
    status,
    statusText,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

(async () => {
  const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

  assert.deepStrictEqual(
    aiClients.buildDeepSeekChatCompletionRequestBody({ model: 'deepseek-v4-flash' }).thinking,
    { type: 'disabled' },
    'DeepSeek request builder should add disabled thinking by default.',
  );
  assert.deepStrictEqual(
    aiClients.buildDeepSeekChatCompletionRequestBody({ thinking: { type: 'enabled' } }).thinking,
    { type: 'enabled' },
    'DeepSeek request builder should preserve an explicit thinking option.',
  );
  assert.strictEqual(
    aiClients.isRetryableDeepSeekError({ statusCode: 503 }),
    true,
    'DeepSeek 503 errors should be retryable.',
  );
  assert.strictEqual(
    aiClients.isRetryableDeepSeekError({ code: 'ETIMEDOUT' }),
    true,
    'DeepSeek timeout errors should be retryable.',
  );
  assert.strictEqual(
    aiClients.isRetryableDeepSeekError({ statusCode: 400 }),
    false,
    'DeepSeek 400 errors should not be retried.',
  );

  const deepSeekRequests = [];
  const deepSeekSleeps = [];
  const deepSeekCompletion = await aiClients.createDeepSeekChatCompletion(
    { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] },
    {
      apiKey: 'deepseek-test-key',
      maxRetries: 1,
      timeoutMs: 1000,
      sleepImpl: async (ms) => deepSeekSleeps.push(ms),
      fetchImpl: async (url, options) => {
        deepSeekRequests.push({ url, options });
        if (deepSeekRequests.length === 1) {
          return response({
            ok: false,
            status: 503,
            statusText: 'Busy',
            body: { error: { message: 'Service is too busy' } },
          });
        }
        return response({
          body: { choices: [{ message: { content: '{"ok":true}' } }] },
        });
      },
    },
  );

  assert.strictEqual(deepSeekRequests.length, 2, 'DeepSeek client should retry one retryable failure.');
  assert.strictEqual(deepSeekSleeps[0], 500, 'DeepSeek retry delay should scale by attempt count.');
  assert.strictEqual(
    deepSeekRequests[0].url,
    'https://api.deepseek.com/chat/completions',
    'DeepSeek client should call the chat completions endpoint.',
  );
  assert.ok(
    deepSeekRequests[0].options.headers.Authorization.includes('deepseek-test-key'),
    'DeepSeek client should send bearer authentication.',
  );
  assert.deepStrictEqual(
    JSON.parse(deepSeekRequests[0].options.body).thinking,
    { type: 'disabled' },
    'DeepSeek client should use the request body normalizer.',
  );
  assert.deepStrictEqual(
    deepSeekCompletion.choices[0].message,
    { content: '{"ok":true}' },
    'DeepSeek client should return parsed completion payloads.',
  );

  const mimoRequests = [];
  const mimoLogs = [];
  const mimoCompletion = await aiClients.createMimoChatCompletion(
    { messages: [{ role: 'user', content: 'hi' }] },
    {
      apiKey: 'mimo-test-key',
      taskLabel: 'MiMo 测试',
      logMimoCallMetrics: (metrics) => mimoLogs.push(metrics),
      fetchImpl: async (url, options) => {
        mimoRequests.push({ url, options });
        return response({
          body: {
            model: 'mimo-v2.5-pro',
            usage: { prompt_tokens: 2, completion_tokens: 1 },
          },
        });
      },
    },
  );

  assert.strictEqual(mimoRequests.length, 1, 'MiMo client should send one request when the first attempt succeeds.');
  assert.strictEqual(
    mimoRequests[0].url,
    'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    'MiMo client should call the chat completions endpoint.',
  );
  assert.strictEqual(
    JSON.parse(mimoRequests[0].options.body).model,
    'mimo-v2.5-pro',
    'MiMo client should apply the default text model.',
  );
  assert.ok(
    mimoRequests[0].options.headers.Authorization.includes('mimo-test-key')
      && mimoRequests[0].options.headers['api-key'] === 'mimo-test-key',
    'MiMo client should send both supported authentication headers.',
  );
  assert.strictEqual(mimoLogs[0].taskLabel, 'MiMo 测试', 'MiMo client should report task labels to the logger.');
  assert.strictEqual(mimoCompletion.model, 'mimo-v2.5-pro', 'MiMo client should return parsed payloads.');

  await assert.rejects(
    () => aiClients.createMimoChatCompletion({}, { apiKey: '' }),
    /Missing Mimo_API_KEY/,
    'MiMo client should fail fast when no API key is available.',
  );

  assert.ok(
    autoSource.includes("require('./lib/ai_chat_clients')"),
    'miaoshou_auto.js should import AI chat clients from lib/ai_chat_clients.js.',
  );

  console.log('ai chat clients module checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
