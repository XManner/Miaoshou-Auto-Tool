const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');
const policySource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'image_policy.js'), 'utf8');
const match = source.match(/async function buildImageRelevanceMapWithMimo\([\s\S]*?\n}\n\nasync function/);

assert.ok(match, 'Missing buildImageRelevanceMapWithMimo function.');

const functionSource = match[0];
assert.match(
  functionSource,
  /try\s*{\s*const completion = await createVisionChatCompletion/,
  'Vision image audit should be isolated in a try block.',
);
assert.match(
  functionSource,
  /catch \(error\) {\s*return verdictMap;\s*}/,
  'Vision image audit failures should fall back to local image policy verdicts.',
);
assert.ok(
  policySource.includes('function decideImageRelevant'),
  'Image relevance fallback decision helper should live in lib/image_policy.js.',
);

console.log('image audit timeout fallback checks passed');
