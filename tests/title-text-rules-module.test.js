const assert = require('assert');
const fs = require('fs');
const path = require('path');
const titleRules = require('../lib/title_text_rules.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

assert.strictEqual(
  typeof titleRules.normalizeOptimizedTitle,
  'function',
  'Title text rules should live in lib/title_text_rules.js.',
);
assert.strictEqual(
  titleRules.normalizeOptimizedTitle('  "Portable   Travel Brush"  ', 80),
  'Portable Travel Brush',
  'Optimized title normalization should trim quotes and collapse whitespace.',
);
assert.strictEqual(
  titleRules.normalizeOptimizedTitle('1234567890', 6),
  '123456',
  'Optimized title normalization should enforce max length.',
);

assert.strictEqual(
  titleRules.sanitizeSensitiveWordsFromText('Factory direct acne cream 厂家直销', 80),
  'direct cream',
  'Sensitive word sanitizer should remove built-in Chinese and English policy words.',
);
assert.strictEqual(
  titleRules.sanitizeSensitiveWordsFromText('skincare factory-made cream', 80),
  'skincare made cream',
  'English sensitive words should be removed at word boundaries inside punctuation-separated text.',
);

assert.strictEqual(
  titleRules.chooseSafeTitleSuffix('Lip Gloss', ''),
  'Cosmetic Product for Daily Use',
  'Safe suffix should match cosmetic title context.',
);

const paddedTitle = titleRules.ensureOptimizedTitleMinLength('Lip Gloss', {
  originalTitle: 'lip makeup cosmetic',
  maxLength: 80,
  minLength: 25,
});
assert.ok(
  paddedTitle.length >= 25 && /Cosmetic Product for Daily Use/.test(paddedTitle),
  'Short safe titles should be padded with a relevant safe suffix.',
);

assert.ok(
  Array.isArray(titleRules.SENSITIVE_WORDS) && titleRules.SENSITIVE_WORDS.includes('factory'),
  'Sensitive word list should be exported for AI prompt construction.',
);
assert.ok(
  autoSource.includes("require('./lib/title_text_rules')"),
  'miaoshou_auto.js should import title text helpers from lib/title_text_rules.js.',
);

console.log('title text rules module checks passed');
