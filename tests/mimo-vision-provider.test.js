const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'miaoshou_auto.js'), 'utf8');
const configSource = fs.readFileSync(path.join(rootDir, 'lib', 'ai_provider_config.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'ai_chat_clients.js'), 'utf8');
const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');

assert.ok(
  configSource.includes("const DEFAULT_MIMO_MODEL = 'mimo-v2.5-pro';"),
  'MiMo main model should default to mimo-v2.5-pro.',
);
assert.ok(
  configSource.includes("const DEFAULT_MIMO_IMAGE_MODEL = 'mimo-v2.5';"),
  'MiMo image calls should default to mimo-v2.5 because mimo-v2.5-pro does not support image input.',
);
assert.ok(
  configSource.includes('const DEFAULT_TITLE_OPTIMIZE_MODEL = DEFAULT_DEEPSEEK_MODEL;')
    && configSource.includes('const DEFAULT_SKU_TRANSLATION_MODEL = DEFAULT_DEEPSEEK_MODEL;')
    && configSource.includes('const DEFAULT_IMAGE_AUDIT_MODEL = DEFAULT_MIMO_IMAGE_MODEL;')
    && configSource.includes('const DEFAULT_WEIGHT_ESTIMATION_MODEL = DEFAULT_MIMO_IMAGE_MODEL;'),
  'Edit workflow function models should default text tasks to DeepSeek and vision tasks to MiMo.',
);
assert.ok(
  configSource.includes('process.env.Mimo_API_KEY || process.env.MIMO_API_KEY'),
  'MiMo should support the mixed-case Mimo_API_KEY already used in .env.',
);
assert.ok(
  configSource.includes('process.env.Mimo_BASE_URL || process.env.MIMO_BASE_URL'),
  'MiMo should support the mixed-case Mimo_BASE_URL already used in .env.',
);
assert.ok(
  clientSource.includes('async function createMimoChatCompletion'),
  'MiMo should have its own chat-completion caller.',
);
assert.ok(
  source.includes('formatMimoUsageForLog'),
  'MiMo calls should format token usage for logs.',
);
assert.match(
  source,
  /createVisionChatCompletion\([\s\S]*'Kimi 图片审核'[\s\S]*'MiMo 图片审核'/,
  'Image audit should route to Kimi or MiMo based on the selected vision model.',
);
assert.match(
  source,
  /createVisionChatCompletion\([\s\S]*'Kimi 重量识别'[\s\S]*'MiMo 重量识别'/,
  'Weight estimation should route to Kimi or MiMo based on the selected vision model.',
);
assert.ok(
  envExample.includes('MIMO_API_KEY=')
    && envExample.includes('MIMO_MODEL=mimo-v2.5-pro')
    && envExample.includes('MIMO_IMAGE_MODEL=mimo-v2.5'),
  '.env.example should document MiMo configuration and the image-capable model.',
);
[
  'TITLE_OPTIMIZE_MODEL',
  'SKU_TRANSLATION_MODEL',
  'IMAGE_AUDIT_MODEL',
  'WEIGHT_ESTIMATION_MODEL',
].forEach((key) => {
  assert.ok(configSource.includes(`process.env.${key}`), `Edit workflow should read ${key} from configuration.`);
  assert.ok(envExample.includes(`${key}=`), `.env.example should document ${key}.`);
});
assert.ok(
  /function isKimiModel[\s\S]*\^\(\?:kimi-\|moonshot-\)/.test(configSource)
    && /resolveAiProviderForRequest[\s\S]*isKimiModel\(model\)/.test(configSource),
  'Text AI routing should send Kimi/Moonshot models to Kimi even when the global default provider is DeepSeek.',
);
assert.ok(
  /resolveAiProviderForRequest[\s\S]*\^mimo-/.test(configSource)
    && /resolvedProvider === 'mimo'[\s\S]*createMimoChatCompletion/.test(source),
  'Text AI routing should send MiMo models to MiMo when a text feature selects MiMo.',
);
assert.ok(
  /async function createVisionChatCompletion/.test(source)
    && /isKimiVisionModel\(model\)[\s\S]*createKimiChatCompletion/.test(source)
    && /createMimoChatCompletion\(requestBody/.test(source),
  'Image audit and weight estimation should support Kimi and MiMo vision models.',
);
assert.ok(
  /function getTitleOptimizeModel[\s\S]*DEFAULT_TITLE_OPTIMIZE_MODEL/.test(configSource)
    && /function getSkuTranslationModel[\s\S]*DEFAULT_SKU_TRANSLATION_MODEL/.test(configSource)
    && /function getImageAuditModel[\s\S]*DEFAULT_IMAGE_AUDIT_MODEL/.test(configSource)
    && /function getWeightEstimationModel[\s\S]*DEFAULT_WEIGHT_ESTIMATION_MODEL/.test(configSource),
  'Runtime model helpers should use the same feature defaults as the account config page.',
);
assert.ok(
  source.includes("args.command === 'test-mimo-image'") && source.includes('--image-url'),
  'CLI should expose a test-mimo-image command that accepts --image-url for speed/cost checks.',
);

console.log('mimo vision provider checks passed');
