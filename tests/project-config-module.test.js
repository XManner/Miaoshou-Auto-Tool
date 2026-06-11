const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectConfig = require('../lib/project_config');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaoshou-config-'));
const envPath = path.join(tempDir, '.env');

fs.writeFileSync(envPath, [
  'MIAOSHOU_MS_URL=https://openapi-erp.91miaoshou.com/',
  'MIAOSHOU_ACTIVE_ACCOUNT_INDEX=2',
  'MIAOSHOU_ACCOUNT_1=13800138000',
  'MIAOSHOU_PASSWORD_1=first-password',
  'MIAOSHOU_APP_ID_1=ak_first',
  'MIAOSHOU_APP_SECRET_1=11112222333344445555666677778888',
  'MIAOSHOU_ACCOUNT_2=13900139000',
  'MIAOSHOU_PASSWORD_2=second-password',
  'MIAOSHOU_APP_ID_2=ak_second',
  'MIAOSHOU_APP_SECRET_2=99990000111122223333444455556666',
  'DEEPSEEK_API_KEY=sk-deepseek-secret',
  'TITLE_OPTIMIZE_MODEL=deepseek-v4-flash',
  '',
].join('\n'), 'utf8');

const manager = projectConfig.createProjectConfigManager({ envPath, env: {} });

assert.ok(
  Array.isArray(projectConfig.PROJECT_CONFIG_SCHEMA)
    && projectConfig.PROJECT_CONFIG_SCHEMA.length >= 3,
  'The project config schema should be exported from the config module.',
);

assert.strictEqual(
  projectConfig.maskSecret('sk-1234567890'),
  'sk-1...7890',
  'The config module should export the same secret masking behavior.',
);

const accounts = manager.readMiaoshouAccounts();
assert.strictEqual(accounts.length, 2, 'The manager should read indexed Miaoshou account slots.');
assert.strictEqual(accounts[1].active, true, 'The manager should mark the selected account active.');

const hiddenConfig = manager.getProjectConfig();
const secretField = hiddenConfig.sections
  .flatMap((section) => section.fields)
  .find((field) => field.key === 'DEEPSEEK_API_KEY');

assert.strictEqual(secretField.value, '', 'GET config defaults should not expose local secrets.');
assert.strictEqual(secretField.hasValue, true, 'Secret fields should still report that a value exists.');
assert.strictEqual(secretField.masked, 'sk-d...cret', 'Secret fields should expose only a masked preview.');

const visibleConfig = manager.getProjectConfig({ includeLocalEnv: true });
const visibleSecretField = visibleConfig.sections
  .flatMap((section) => section.fields)
  .find((field) => field.key === 'DEEPSEEK_API_KEY');
assert.strictEqual(visibleSecretField.value, 'sk-deepseek-secret', 'Local config values should be opt-in.');

const updates = manager.normalizeProjectConfig({
  values: {
    MIAOSHOU_MS_URL: 'https://example.com/openapi/',
    AI_PROVIDER: 'kimi',
  },
  manageMiaoshouAccounts: true,
  selectedMiaoshouAccountIndex: 0,
  miaoshouAccounts: [
    {
      loginPhone: '13700137000',
      loginPassword: 'new-password',
      appId: 'ak_new',
      appSecret: 'abcdefabcdefabcdefabcdefabcdefab',
    },
  ],
});

assert.strictEqual(updates.MIAOSHOU_MS_URL, 'https://example.com/openapi');
assert.strictEqual(updates.AI_PROVIDER, 'kimi');
assert.strictEqual(updates.MIAOSHOU_ACTIVE_ACCOUNT_INDEX, '1');
assert.strictEqual(updates.MIAOSHOU_ACCOUNT_1, '13700137000');
assert.strictEqual(updates.MIAOSHOU_APP_SECRET_2, '');

console.log('project config module checks passed');
