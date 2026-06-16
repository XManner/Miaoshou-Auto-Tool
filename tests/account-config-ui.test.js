const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const configSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'project_config.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const combinedSource = `${appSource}\n${serverSource}\n${configSource}`;
const oldLookupKey = `ALI1688_${['COO', 'KIE'].join('')}`;
const oldLookupLabel = `168${'8'} ${['Cook', 'ie'].join('')}`;

assert.ok(
  appSource.includes("config: '账户配置'"),
  'Page titles should include 账户配置.',
);

assert.ok(
  /<a-menu-item key="home">首页<\/a-menu-item>[\s\S]*<a-menu-item key="collect">商品采集<\/a-menu-item>[\s\S]*<a-menu-item key="products">编辑商品<\/a-menu-item>[\s\S]*<a-menu-item key="flash">秒杀管理<\/a-menu-item>[\s\S]*<a-menu-item key="config">账户配置<\/a-menu-item>/.test(appSource),
  'Navigation order should be 首页 | 商品采集 | 编辑商品 | 秒杀管理 | 账户配置.',
);

assert.ok(
  appSource.includes('const configForm = reactive')
    && appSource.includes('const configStatus = ref')
    && appSource.includes('const useLocalEnv = ref(true)')
    && appSource.includes('loadConfig')
    && appSource.includes('saveConfig'),
  'The UI should manage account configuration form state and save actions.',
);

[
  '妙手 ERP',
  'AI 模型',
  'DeepSeek API Key',
  'Kimi API Key',
  'MiMo API Key',
  'MiMo Base URL',
  '商品标题优化模型',
  '文案翻译 / SKU 属性翻译模型',
  '图片审核模型',
  '重量识别和估算模型',
  '默认使用模型',
].forEach((text) => {
  assert.ok(combinedSource.includes(text), `Config page should include ${text}.`);
});
assert.ok(
  !combinedSource.includes("title: '功能模型配置'")
    && !appSource.includes('功能模型配置'),
  'Feature model configuration should no longer be a separate tab.',
);

assert.ok(
  appSource.includes('<a-select')
    && appSource.includes('field.type === \'select\'')
    && appSource.includes(':options="field.options"')
    && combinedSource.includes('默认 AI 服务'),
  'Default AI provider should render as a select field.',
);

assert.ok(
  appSource.includes('使用本地 .env')
    && appSource.includes('onUseLocalEnvChange')
    && appSource.includes('useLocalEnv.value ? \'1\' : \'0\'')
    && appSource.includes('configForm[field.key] = useLocalEnv.value ? (field.value || \'\') : \'\''),
  'Config form should load local .env by default and keep the switch available.',
);

assert.ok(
  !appSource.includes('selectedAccountId')
    && !appSource.includes('accountOptions')
    && !appSource.includes('class="account-select"')
    && !appSource.includes('miaoshou-account-id')
    && !appSource.includes('accountId:'),
  'The global account selector should be removed; task runs should use the configured default account.',
);

assert.ok(
  appSource.includes('aiUsageItems')
    && appSource.includes('AI 功能说明')
    && appSource.includes('ai-usage-panel'),
  'Config page should explain which AI service is used by each feature.',
);

assert.ok(
  combinedSource.includes('TEXT_FUNCTION_MODEL_OPTIONS')
    && combinedSource.includes('VISION_FUNCTION_MODEL_OPTIONS')
    && combinedSource.includes("key: 'IMAGE_AUDIT_MODEL'")
    && combinedSource.includes("key: 'WEIGHT_ESTIMATION_MODEL'"),
  'Config page should receive selectable per-feature AI model options from the server.',
);

assert.ok(
  appSource.includes('configRenderableGroups')
    && appSource.includes('section.groups')
    && appSource.includes('config-field-group')
    && configSource.includes("key: 'defaultModels'")
    && configSource.includes("title: '默认使用模型'"),
  'Per-feature AI model selectors should render as the first grouped area inside AI model service.',
);

assert.ok(
  appSource.includes('miaoshouAccountForm')
    && appSource.includes('selectedConfigAccountIndex')
    && appSource.includes('const configDirty = ref(false)')
    && appSource.includes('configAccountOptions')
    && appSource.includes('markConfigFieldTouched')
    && appSource.includes('addConfigAccount')
    && appSource.includes('removeConfigAccount')
    && appSource.includes('markConfigAccountsTouched'),
  'Config page should manage a dynamic Miaoshou account list.',
);

assert.ok(
  appSource.includes('confirmLeaveConfigIfNeeded')
    && appSource.includes('switchPage')
    && appSource.includes('window.confirm')
    && appSource.includes('await saveConfig()')
    && appSource.includes('configDirty.value = false')
    && appSource.includes('v-if="configDirty"')
    && appSource.includes('@change="markConfigFieldTouched"'),
  'Leaving the config page with unsaved changes should prompt whether to save first.',
);

[
  '账号列表',
  '添加账号',
  '默认使用账号（保存后生效）',
  '配置尚未保存',
  '需要点击保存配置才会用于下一次采集、编辑和秒杀',
  '登录手机号/账号',
  '登录密码',
  'App ID',
  'App Secret',
].forEach((text) => {
  assert.ok(appSource.includes(text), `Config page should include multi-account UI text ${text}.`);
});

[
  'account.loginPhone',
  'account.loginPassword',
  'account.appId',
  'account.appSecret',
].forEach((modelName) => {
  assert.ok(
    new RegExp(`<a-input-password[\\s\\S]*v-model:value="${modelName}"`).test(appSource),
    `Miaoshou account field ${modelName} should render as a hideable password input.`,
  );
});

assert.ok(
  !combinedSource.includes('ALI1688_LOGIN_ACCOUNT')
    && !combinedSource.includes('ALI1688_LOGIN_PASSWORD')
    && !combinedSource.includes('1688 登录账号')
    && !combinedSource.includes('1688 登录密码'),
  'Config page should not show 1688 browser login settings.',
);

assert.ok(
  !appSource.includes(`<a-input
                                    v-model:value="account.loginPhone"`)
    && !appSource.includes(`<a-input
                                    v-model:value="account.appId"`),
  'Login phone and App ID should not render as plain text inputs.',
);

assert.ok(
  appSource.includes('manageMiaoshouAccounts')
    && appSource.includes('miaoshouAccounts:')
    && appSource.includes('selectedMiaoshouAccountIndex: selectedConfigAccountIndex.value'),
  'Saving config should submit the editable Miaoshou account list when it is managed.',
);

assert.ok(
  !combinedSource.includes(oldLookupKey)
    && !combinedSource.includes(oldLookupLabel)
    && !combinedSource.includes('Chrome 路径')
    && !combinedSource.includes('Puppeteer Chrome 路径')
    && !combinedSource.includes('CHROME_EXECUTABLE_PATH')
    && !combinedSource.includes('PUPPETEER_EXECUTABLE_PATH'),
  'Config page should not show obsolete browser or lookup settings.',
);

assert.ok(
  !combinedSource.includes('店铺发布')
    && !combinedSource.includes('菲律宾店铺 ID')
    && !appSource.includes('店铺发布默认值'),
  'Account config should not show the store publishing module.',
);

assert.ok(
  appSource.includes('表单留空不会修改原值。')
    && appSource.includes("return field.placeholder || '留空则不修改';"),
  'Sensitive fields should keep blank-save behavior explanation in the alert and placeholder.',
);

assert.ok(
  appSource.includes('<template #label>')
    && appSource.includes('class="config-field-label"')
    && appSource.includes('class="config-field-status"')
    && appSource.includes('{{ field.label }}')
    && appSource.includes("{{ field.hasValue ? '已配置' : '未配置' }}"),
  'Configured status should render next to each field label.',
);

assert.ok(
  !appSource.includes('class="secret-status"')
    && !appSource.includes('<span v-if="field.secret && field.hasValue">留空则不修改</span>'),
  'The config page should not render blank-save helper text below inputs.',
);

assert.ok(
  appSource.includes("requestJson('/api/config'")
    && appSource.includes("method: 'POST'")
    && appSource.includes("notify('success', '账户配置已保存。')")
    && appSource.includes('useLocalEnv: useLocalEnv.value')
    && appSource.includes('await loadAccounts()'),
  'Saving config should call /api/config and refresh available accounts.',
);

assert.ok(
  appSource.includes(`<a-card v-if="currentPage === 'config'" title="账户配置"`)
    && appSource.includes(':disabled="loading" @click="saveConfig"'),
  'The config page should render a dedicated card with a save button.',
);

assert.strictEqual(
  (appSource.match(/>保存配置<\/a-button>/g) || []).length,
  1,
  'The config page should show only one Save Config button.',
);

assert.ok(
  appSource.includes('<a-card v-if="currentPage !== \'home\' && currentPage !== \'config\' && currentPage !== \'collect\'" title="最近记录"'),
  'The config page should not show the shared recent task history panel.',
);

assert.ok(
  styles.includes('.config-panel')
    && styles.includes('.config-grid')
    && styles.includes('.config-field-label')
    && styles.includes('.config-field-status')
    && styles.includes('.config-toolbar')
    && styles.includes('.config-field-group')
    && styles.includes('.ai-usage-panel'),
  'The config page should have scoped layout styles.',
);

console.log('account config UI checks passed');
