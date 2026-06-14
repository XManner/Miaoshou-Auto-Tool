const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const artifacts = require('../lib/automation_artifacts');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaoshou-artifacts-'));
  const fakePage = {
    url: () => 'https://erp.91miaoshou.com/tiktok/marketing/flashSale',
    title: async () => '限时秒杀',
    screenshot: async ({ path: filePath }) => {
      fs.writeFileSync(filePath, Buffer.from('png-bytes'));
    },
    content: async () => `<html><body>${'页面内容'.repeat(80)}</body></html>`,
  };

  const captured = await artifacts.capturePageArtifact(fakePage, {
    runId: 'run artifact 1',
    stage: 'flash list',
    label: '活动列表',
    dir: tempDir,
    htmlMaxChars: 80,
  });

  assert.strictEqual(captured.runId, 'run_artifact_1');
  assert.strictEqual(captured.stage, 'flash-list');
  assert.ok(captured.files.screenshot.name.endsWith('.png'));
  assert.ok(captured.files.html.name.endsWith('.html'));
  assert.ok(captured.files.metadata.name.endsWith('.json'));
  assert.ok(fs.existsSync(captured.files.screenshot.path), 'Screenshot artifact should be written.');
  assert.ok(fs.existsSync(captured.files.html.path), 'HTML artifact should be written.');
  assert.ok(fs.readFileSync(captured.files.html.path, 'utf8').includes('HTML truncated'), 'Large HTML should be truncated with a marker.');

  const browserCapture = await artifacts.captureBrowserArtifacts({
    pages: async () => [fakePage],
  }, {
    runId: 'run artifact 1',
    stage: 'flash failure',
    dir: tempDir,
    htmlMaxChars: 80,
  });

  assert.strictEqual(browserCapture.artifacts.length, 1);
  assert.ok(fs.existsSync(path.join(browserCapture.dir, 'index.json')), 'Browser capture should write an artifact index.');

  const loaded = artifacts.loadRunArtifacts('run artifact 1', { dir: tempDir });
  assert.ok(loaded.artifacts.length >= 1, 'Saved artifacts should be loadable by run id.');
  assert.ok(loaded.artifacts[0].files.html.url.includes('/api/diagnostics/run_artifact_1/artifacts/'));

  const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');
  assert.ok(
    source.includes("require('./lib/automation_artifacts')")
      && source.includes('saveFlashFailureArtifacts')
      && source.includes('captureBrowserArtifacts(browser'),
    'Flash-sale automation should capture page artifacts on failure.',
  );

  console.log('automation artifact checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
