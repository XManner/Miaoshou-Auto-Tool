const assert = require('assert');
const fs = require('fs');
const path = require('path');
const aiConfig = require('../lib/ai_provider_config.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  aiConfig.DEFAULT_MIMO_MODEL,
  'mimo-v2.5-pro',
  'MiMo text model should default to mimo-v2.5-pro.',
);
assert.strictEqual(
  aiConfig.DEFAULT_MIMO_IMAGE_MODEL,
  'mimo-v2.5',
  'MiMo vision model should default to the image-capable mimo-v2.5 model.',
);
assert.strictEqual(
  aiConfig.getDefaultAiModel('deepseek'),
  'deepseek-v4-flash',
  'DeepSeek should remain the default text model for DeepSeek provider.',
);
assert.strictEqual(
  aiConfig.resolveAiProviderForRequest({ model: 'moonshot-v1-8k' }, 'deepseek'),
  'kimi',
  'Kimi/Moonshot model names should route to Kimi even when global provider is DeepSeek.',
);
assert.strictEqual(
  aiConfig.resolveAiProviderForRequest({ model: 'mimo-v2.5-pro' }, 'deepseek'),
  'mimo',
  'MiMo model names should route to MiMo.',
);
assert.strictEqual(
  aiConfig.getImageAuditModel('deepseek-v4-flash'),
  'mimo-v2.5',
  'Vision features should fall back to a MiMo image-capable model when a text-only DeepSeek model is passed.',
);
assert.strictEqual(
  aiConfig.getWeightEstimationModel('kimi-k2.6'),
  'kimi-k2.6',
  'Vision features should keep explicitly selected Kimi vision-compatible models.',
);
assert.strictEqual(
  aiConfig.buildDeepSeekApiUrl('/chat/completions'),
  'https://api.deepseek.com/chat/completions',
  'DeepSeek URL builder should normalize slash boundaries.',
);
assert.strictEqual(
  aiConfig.formatMimoUsageForLog({
    prompt_tokens: 12,
    completion_tokens: 3,
    prompt_tokens_details: { image_tokens: 99 },
  }),
  '输入 12 / 输出 3 / 合计 15 / 图片 99',
  'MiMo usage formatter should include image token details when present.',
);
assert.ok(
  autoSource.includes("require('./lib/ai_provider_config')"),
  'miaoshou_auto.js should import AI provider helpers from lib/ai_provider_config.js.',
);

console.log('ai provider config module checks passed');
