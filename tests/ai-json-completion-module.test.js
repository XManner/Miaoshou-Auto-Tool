const assert = require('assert');
const fs = require('fs');
const path = require('path');
const aiJson = require('../lib/ai_json_completion.js');

(async () => {
  const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

  assert.deepStrictEqual(
    aiJson.parseKimiJsonContent('```json\n{"title":"Brush"}\n```'),
    { title: 'Brush' },
    'AI JSON parser should handle fenced JSON blocks.',
  );
  assert.deepStrictEqual(
    aiJson.parseKimiJsonContent('Here is the result: {"a":"brace { inside string }","b":{"c":1}} thanks'),
    { a: 'brace { inside string }', b: { c: 1 } },
    'AI JSON parser should extract the first complete object from surrounding text.',
  );
  assert.deepStrictEqual(
    aiJson.parseKimiJsonContent('Portable Travel Brush'),
    { optimizedTitle: 'Portable Travel Brush' },
    'AI JSON parser should keep the historical plain-title fallback when allowed.',
  );
  assert.throws(
    () => aiJson.parseKimiJsonContent('Portable Travel Brush', {
      allowPlainTextFallback: false,
      allowJsonObjectExtraction: false,
    }),
    /standalone JSON object/,
    'Strict JSON parsing should reject plain text.',
  );

  const calls = [];
  const result = await aiJson.createAiJsonChatCompletion(
    {
      model: 'deepseek-v4-flash',
      temperature: 1,
      messages: [{ role: 'user', content: 'Return JSON.' }],
    },
    {
      retryCount: 1,
      retryTemperature: 0,
      createChatCompletion: async (body) => {
        calls.push(body);
        return calls.length === 1
          ? { choices: [{ message: { content: 'not-json' } }] }
          : { choices: [{ message: { content: '{"ok":true}' } }] };
      },
    },
  );

  assert.deepStrictEqual(
    result,
    { payload: { ok: true }, content: '{"ok":true}', retried: true },
    'DeepSeek JSON helper should retry once and return the parsed retry payload.',
  );
  assert.strictEqual(calls.length, 2, 'DeepSeek JSON helper should call the chat client twice after one invalid response.');
  assert.strictEqual(calls[1].temperature, 0, 'Retry calls should use the configured retry temperature.');
  assert.strictEqual(
    calls[1].messages[calls[1].messages.length - 1].role,
    'user',
    'Retry calls should append a corrective user message.',
  );
  assert.ok(
    calls[1].messages[calls[1].messages.length - 1].content.includes('JSON.parse'),
    'Retry corrective prompt should ask for directly parseable JSON.',
  );

  assert.ok(
    autoSource.includes("require('./lib/ai_json_completion')"),
    'miaoshou_auto.js should import AI JSON helpers from lib/ai_json_completion.js.',
  );

  console.log('ai json completion module checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
