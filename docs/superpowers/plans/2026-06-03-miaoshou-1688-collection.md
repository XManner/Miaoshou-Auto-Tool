# Miaoshou 1688 Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Puppeteer-powered 1688 product collection workflow and expose it as `商品采集` in the local web console.

**Architecture:** Create a focused collection script with exported filtering/scoring helpers for tests. Extend the existing web server run model with a `collect` task that starts the new script. Extend the Vue app with a collection form, navigation order, page matching, and run display support.

**Tech Stack:** Node.js CommonJS, `puppeteer-core`, existing local web server, Vue 3 + Ant Design Vue, Node `assert` tests.

---

### Task 1: Collection Filter And CLI Defaults

**Files:**
- Create: `miaoshou_1688_collect.js`
- Test: `tests/1688-collection-filter.test.js`

- [ ] **Step 1: Write failing test**

```js
const assert = require('assert');
const {
  DEFAULT_COLLECT_OPTIONS,
  parseArgs,
  evaluateCandidate,
} = require('../miaoshou_1688_collect');

assert.strictEqual(DEFAULT_COLLECT_OPTIONS.count, 10);
assert.strictEqual(DEFAULT_COLLECT_OPTIONS.maxPriceCny, 10);
assert.strictEqual(DEFAULT_COLLECT_OPTIONS.safeMode, true);

assert.deepStrictEqual(parseArgs([
  '--keywords', '防晒帽,防晒冰袖',
  '--count', '8',
  '--max-price', '9.5',
  '--preferred-terms', '防晒帽,冰袖',
  '--excluded-terms', '防晒霜,喷雾',
  '--min-score', '70',
]).keywords, ['防晒帽', '防晒冰袖']);

assert.strictEqual(
  evaluateCandidate({ title: '户外防晒帽女夏季遮阳帽', price: 6.8 }, DEFAULT_COLLECT_OPTIONS).decision,
  'collect',
);
assert.strictEqual(
  evaluateCandidate({ title: 'SPF50 防晒霜美白防晒乳', price: 8.8 }, DEFAULT_COLLECT_OPTIONS).decision,
  'reject',
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/1688-collection-filter.test.js`
Expected: fail because `miaoshou_1688_collect.js` does not exist.

- [ ] **Step 3: Implement minimal exported helpers**

Add defaults, CLI parsing, term splitting, hard reject rules, price validation, and deterministic scoring.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/1688-collection-filter.test.js`
Expected: pass.

### Task 2: Collection Browser Script

**Files:**
- Modify: `miaoshou_1688_collect.js`

- [ ] **Step 1: Add Puppeteer runtime**

Add Chrome executable lookup, profile directory, progress output, search URL generation, candidate extraction, detail-page collection, and JSON summary output.

- [ ] **Step 2: Run syntax check**

Run: `node --check miaoshou_1688_collect.js`
Expected: pass.

### Task 3: Web Server Collection Task

**Files:**
- Modify: `web_server.js`
- Test: `tests/1688-collection-server.test.js`

- [ ] **Step 1: Write failing source-level server test**

Check for `COLLECT_SCRIPT_PATH`, `normalizeCollectOptions`, `startCollectRun`, `tasks.collect`, `--max-price`, and collection run serialization fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/1688-collection-server.test.js`
Expected: fail before server support exists.

- [ ] **Step 3: Implement server support**

Add collect option validation, command construction, run metadata, progress phase label, summary parsing compatibility, and routing from `/api/run`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/1688-collection-server.test.js`
Expected: pass.

### Task 4: Frontend Collection Page

**Files:**
- Modify: `public/app.js`
- Test: `tests/1688-collection-ui.test.js`
- Modify: `tests/task-selection-module.test.js`
- Modify: `tests/page-run-status-filter.test.js`

- [ ] **Step 1: Write failing UI test**

Check navigation order `首页 | 商品采集 | 编辑商品 | 秒杀管理`, default collection form values, collection payload fields, and page-specific run matching.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/1688-collection-ui.test.js`
Expected: fail before UI support exists.

- [ ] **Step 3: Implement frontend support**

Add `collect` page title/subtitle, form state, payload builder, start action, navigation item, hero button, task card, run matching, summary text, and build task text.

- [ ] **Step 4: Update existing source tests**

Update old assertions from `商品管理` to `编辑商品` and add collection-aware page filtering checks.

- [ ] **Step 5: Run UI tests**

Run: `node tests/1688-collection-ui.test.js && node tests/task-selection-module.test.js && node tests/page-run-status-filter.test.js`
Expected: pass.

### Task 5: Final Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Include new script in syntax check**

Add `node --check miaoshou_1688_collect.js` to `npm run check`.

- [ ] **Step 2: Run all focused tests**

Run: `node tests/1688-collection-filter.test.js && node tests/1688-collection-server.test.js && node tests/1688-collection-ui.test.js`
Expected: pass.

- [ ] **Step 3: Run project check**

Run: `npm run check`
Expected: pass.

- [ ] **Step 4: Start local server and inspect page**

Run: `npm run web`
Expected: local console starts at `http://127.0.0.1:3000`; page shows the new navigation and collection form.
