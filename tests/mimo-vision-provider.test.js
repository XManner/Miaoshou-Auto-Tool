const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'miaoshou_auto.js'), 'utf8');
const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');

assert.ok(
  source.includes("const DEFAULT_MIMO_MODEL = 'mimo-v2.5-pro';"),
  'MiMo main model should default to mimo-v2.5-pro.',
);
assert.ok(
  source.includes("const DEFAULT_MIMO_IMAGE_MODEL = 'mimo-v2.5';"),
  'MiMo image calls should default to mimo-v2.5 because mimo-v2.5-pro does not support image input.',
);
assert.ok(
  source.includes('process.env.Mimo_API_KEY || process.env.MIMO_API_KEY'),
  'MiMo should support the mixed-case Mimo_API_KEY already used in .env.',
);
assert.ok(
  source.includes('process.env.Mimo_BASE_URL || process.env.MIMO_BASE_URL'),
  'MiMo should support the mixed-case Mimo_BASE_URL already used in .env.',
);
assert.ok(
  source.includes('async function createMimoChatCompletion'),
  'MiMo should have its own chat-completion caller.',
);
assert.ok(
  source.includes('formatMimoUsageForLog'),
  'MiMo calls should format token usage for logs.',
);
assert.match(
  source,
  /createMimoChatCompletion\([\s\S]*taskLabel:\s*'MiMo 图片审核'/,
  'Image audit should call MiMo and log the image-audit task label.',
);
assert.match(
  source,
  /createMimoChatCompletion\([\s\S]*taskLabel:\s*'MiMo 重量识别'/,
  'Weight estimation should call MiMo and log the weight task label.',
);
assert.ok(
  envExample.includes('MIMO_API_KEY=')
    && envExample.includes('MIMO_MODEL=mimo-v2.5-pro')
    && envExample.includes('MIMO_IMAGE_MODEL=mimo-v2.5'),
  '.env.example should document MiMo configuration and the image-capable model.',
);
assert.ok(
  source.includes("args.command === 'test-mimo-image'") && source.includes('--image-url'),
  'CLI should expose a test-mimo-image command that accepts --image-url for speed/cost checks.',
);

console.log('mimo vision provider checks passed');
