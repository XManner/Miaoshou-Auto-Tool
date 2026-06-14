const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const assetDir = path.join(__dirname, '..', 'public', 'assets');
const assetNames = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];

const removedTheme = ['pl', 'ush'].join('');
const removedLabel = String.fromCodePoint(0x8f7b, 0x7ed2, 0x73bb, 0x7483);
const removedTextureToken = ['fle', 'ece'].join('');
const removedSnippets = [
  removedTheme,
  removedLabel,
  `${removedTheme}-home`,
  `${removedTheme}-glow-button`,
  `${removedTheme}-brand`,
  `${removedTheme}-theme`,
  `app-${removedTheme}`,
  `app-${removedTextureToken}`,
  `data-theme="${removedTheme}"`,
];

[
  "value: 'commerce'",
  "value: 'tech'",
  "value: 'fresh'",
].forEach((themeValue) => {
  assert.ok(appSource.includes(themeValue), `Existing theme list should keep ${themeValue}.`);
});

removedSnippets.forEach((snippet) => {
  assert.ok(!appSource.includes(snippet), `App source should not keep removed theme snippet: ${snippet}`);
  assert.ok(!styles.includes(snippet), `Styles should not keep removed theme snippet: ${snippet}`);
  assert.ok(!serverSource.includes(snippet), `Server routes should not keep removed theme snippet: ${snippet}`);
});

assert.ok(
  !assetNames.some((name) => name.includes(removedTheme)),
  'Public assets should not keep removed theme images.',
);

assert.ok(
  appSource.includes('class="soft-card task-card collect-panel"')
    && appSource.includes('class="soft-card task-card product-panel"')
    && appSource.includes('class="soft-card task-card flash-panel"'),
  'Removing the old theme should preserve the functional task cards.',
);

console.log('removed theme checks passed');
