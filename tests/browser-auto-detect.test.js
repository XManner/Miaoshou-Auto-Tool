const assert = require('assert');
const fs = require('fs');
const path = require('path');

const collectSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_1688_collect.js'), 'utf8');
const flashSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');

for (const [name, source] of [
  ['1688 collection', collectSource],
  ['flash sale', flashSource],
]) {
  assert.ok(
    source.includes('PUPPETEER_EXECUTABLE_PATH')
      && source.includes('CHROME_EXECUTABLE_PATH'),
    `${name} should still allow advanced environment overrides.`,
  );
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].forEach((candidate) => {
    assert.ok(source.includes(candidate), `${name} should auto-detect ${candidate}.`);
  });
  assert.ok(
    source.includes('没有找到可用的 Chrome')
      && !source.includes('可以在 .env 设置 PUPPETEER_EXECUTABLE_PATH'),
    `${name} should report missing Chrome without asking users to configure the web page path.`,
  );
}

console.log('browser auto-detect checks passed');
