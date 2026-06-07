const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const oldLookupKey = `ALI1688_${['COO', 'KIE'].join('')}`;
const oldLookupLabel = `168${'8'} ${['Cook', 'ie'].join('')}`;
const visionOptionsStart = serverSource.indexOf('const VISION_FUNCTION_MODEL_OPTIONS');
const visionOptionsEnd = serverSource.indexOf('const AI_USAGE_SUMMARY');
const visionOptionsBlock = visionOptionsStart >= 0 && visionOptionsEnd > visionOptionsStart
  ? serverSource.slice(visionOptionsStart, visionOptionsEnd)
  : '';

assert.ok(
  serverSource.includes('PROJECT_CONFIG_SCHEMA')
    && serverSource.includes('getProjectConfig')
    && serverSource.includes('normalizeProjectConfig'),
  'The server should define a reusable project configuration schema and helpers.',
);

assert.ok(
  serverSource.includes('AI_PROVIDER_OPTIONS')
    && serverSource.includes('DEEPSEEK_MODEL_OPTIONS')
    && serverSource.includes('KIMI_MODEL_OPTIONS')
    && serverSource.includes('TEXT_FUNCTION_MODEL_OPTIONS')
    && serverSource.includes('VISION_FUNCTION_MODEL_OPTIONS')
    && serverSource.includes('MIMO_MODEL_OPTIONS')
    && serverSource.includes('MIMO_IMAGE_MODEL_OPTIONS')
    && serverSource.includes("type: 'select'")
    && serverSource.includes("key: 'AI_PROVIDER'")
    && serverSource.includes("key: 'featureModels'")
    && serverSource.includes("title: '功能模型配置'"),
  'Account config should expose provider settings and a separate feature model section.',
);

[
  'TITLE_OPTIMIZE_MODEL',
  'SKU_TRANSLATION_MODEL',
  'IMAGE_AUDIT_MODEL',
  'WEIGHT_ESTIMATION_MODEL',
].forEach((key) => {
  assert.ok(serverSource.includes(`key: '${key}'`), `Project config should include function model field ${key}.`);
});

assert.ok(
  /key: 'TITLE_OPTIMIZE_MODEL'[\s\S]*options: TEXT_FUNCTION_MODEL_OPTIONS/.test(serverSource)
    && /key: 'SKU_TRANSLATION_MODEL'[\s\S]*options: TEXT_FUNCTION_MODEL_OPTIONS/.test(serverSource),
  'Text features should let users choose from DeepSeek, Kimi, or MiMo models.',
);

assert.ok(
  /key: 'IMAGE_AUDIT_MODEL'[\s\S]*options: VISION_FUNCTION_MODEL_OPTIONS/.test(serverSource)
    && /key: 'WEIGHT_ESTIMATION_MODEL'[\s\S]*options: VISION_FUNCTION_MODEL_OPTIONS/.test(serverSource),
  'Image-related features should only let users choose Kimi or MiMo image-capable models.',
);

assert.ok(
  /key: 'TITLE_OPTIMIZE_MODEL'[\s\S]*defaultValue: 'deepseek-v4-flash'/.test(serverSource)
    && /key: 'SKU_TRANSLATION_MODEL'[\s\S]*defaultValue: 'deepseek-v4-flash'/.test(serverSource)
    && /key: 'IMAGE_AUDIT_MODEL'[\s\S]*defaultValue: 'mimo-v2\.5'/.test(serverSource)
    && /key: 'WEIGHT_ESTIMATION_MODEL'[\s\S]*defaultValue: 'mimo-v2\.5'/.test(serverSource),
  'Function model selectors should provide the requested default selections.',
);

assert.ok(
  /TEXT_FUNCTION_MODEL_OPTIONS[\s\S]*DeepSeek[\s\S]*Kimi[\s\S]*MiMo/.test(serverSource)
    && /Kimi[\s\S]*MiMo/.test(visionOptionsBlock)
    && !visionOptionsBlock.includes('DeepSeek'),
  'Function model option groups should match text and image provider rules.',
);

assert.ok(
  serverSource.includes('includeLocalEnv')
    && serverSource.includes("url.searchParams.get('useLocalEnv')")
    && serverSource.includes('value: includeLocalEnv ? effectiveValue :'),
  'GET /api/config should return local .env values or schema defaults only when explicitly requested.',
);

[
  'MIAOSHOU_MS_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'KIMI_API_KEY',
  'MIMO_API_KEY',
  'MIMO_BASE_URL',
  'MIMO_MODEL',
].forEach((key) => {
  assert.ok(serverSource.includes(key), `Project config should include ${key}.`);
});

[
  'MIAOSHOU_ACCOUNT',
  'MIAOSHOU_PASSWORD',
  'Mimo_API_KEY',
  'Mimo_BASE_URL',
  'Mimo_MODEL',
  'Mimo_IMAGE_MODEL',
].forEach((key) => {
  assert.ok(serverSource.includes(key), `Project config should read legacy/env alias ${key}.`);
});

[
  'miaoshouAccounts',
  'selectedMiaoshouAccountIndex',
  'manageMiaoshouAccounts',
  'normalizeMiaoshouAccountRows',
  'serializeProjectMiaoshouAccount',
  'MIAOSHOU_ACTIVE_ACCOUNT_INDEX',
  'MIAOSHOU_ACCOUNT_${slot}',
  'MIAOSHOU_PASSWORD_${slot}',
  'MIAOSHOU_APP_ID_${slot}',
  'MIAOSHOU_APP_SECRET_${slot}',
].forEach((text) => {
  assert.ok(serverSource.includes(text), `Project config should support multi-account field ${text}.`);
});

assert.ok(
  serverSource.includes("assignment.key === 'MIAOSHOU_ACCOUNT'")
    && serverSource.includes("assignment.key === 'MIAOSHOU_PASSWORD'")
    && serverSource.includes('parseMiaoshouAccountEnvKey'),
  'Miaoshou account parsing should read commented account/password/app credential blocks.',
);

[
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'mimo-v2.5-pro',
  'mimo-v2.5',
  'mimo-v2-pro',
  'mimo-v2-omni',
].forEach((model) => {
  assert.ok(serverSource.includes(model), `Project config should include selectable model ${model}.`);
});

assert.ok(
  /key: 'DEEPSEEK_MODEL'[\s\S]*type: 'select'/.test(serverSource)
    && /key: 'MIMO_MODEL'[\s\S]*type: 'select'/.test(serverSource)
    && /key: 'MIMO_IMAGE_MODEL'[\s\S]*type: 'select'/.test(serverSource),
  'DeepSeek and MiMo model fields should be rendered as select inputs.',
);

assert.ok(
  !serverSource.includes(oldLookupKey)
    && !serverSource.includes(oldLookupLabel)
    && !serverSource.includes("key: 'collect'")
    && !serverSource.includes('CHROME_EXECUTABLE_PATH')
    && !serverSource.includes('PUPPETEER_EXECUTABLE_PATH'),
  'Account config should not include obsolete browser or lookup settings.',
);

assert.ok(
  !serverSource.includes("key: 'publish'")
    && !serverSource.includes("title: '店铺发布'")
    && !serverSource.includes("label: '菲律宾店铺 ID'"),
  'Account config should not include the store publishing section.',
);

assert.ok(
  serverSource.includes('config: getProjectConfig({ includeLocalEnv })')
    && serverSource.includes('config: getProjectConfig({ includeLocalEnv: Boolean(body && body.useLocalEnv) })')
    && serverSource.includes('const updates = normalizeProjectConfig(body)'),
  'GET/POST /api/config should use the full project config helpers.',
);

assert.ok(
  serverSource.includes('hasValue: Boolean(value)')
    && serverSource.includes('masked: maskSecret(value)')
    && serverSource.includes('secret: true'),
  'Sensitive config values should be summarized without returning raw secrets.',
);

assert.ok(
  serverSource.includes('allowEmptyUpdate: true')
    && serverSource.includes('if (!normalized)')
    && serverSource.includes('delete updates[field.key]'),
  'Blank config fields should not overwrite existing values when saving.',
);

assert.ok(
  serverSource.includes('nextEnv.MIAOSHOU_LOGIN_PHONE = account.loginPhone || account.label')
    && serverSource.includes('nextEnv.MIAOSHOU_LOGIN_PASSWORD = account.loginPassword'),
  'Child automation processes should prefer the selected Miaoshou account credentials.',
);

console.log('account config server checks passed');
