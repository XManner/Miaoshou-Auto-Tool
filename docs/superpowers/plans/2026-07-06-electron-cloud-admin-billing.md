# Electron 商业版云端计费 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前本地妙手自动化工作台升级为支持 Electron 客户端、云端账号、订阅授权、Token 计费、用户中心、运营管理后台和微信支付的商业版产品。

**Architecture:** 先保留现有本地自动化脚本和网页工作台，不重写核心业务流程。新增商业化核心模块、云端 API 服务、Electron 外壳和后台网页；客户端通过云端接口完成登录、设备激活、功能权限、Token 冻结和结算，本地仍负责打开浏览器执行自动化。

**Tech Stack:** Node.js CommonJS、Vue 3 全局构建、Ant Design Vue、Electron、PostgreSQL、微信支付 API、现有 `tests/run-all.js` 测试框架。

---

## 范围拆分

这个设计覆盖多个子系统，实施时必须分阶段完成。不要一次性把 Electron、云端、后台、支付全部做完。

推荐分支顺序：

1. `codex/commercial-contracts`: 先做套餐、功能权限、Token 计费规则和云端接口契约。
2. `codex/electron-shell`: 再做 Electron 客户端外壳，让现有工作台能在桌面软件里运行。
3. `codex/cloud-auth-billing`: 再做云端账号、设备绑定、订阅、Token 账本和任务记录。
4. `codex/admin-user-center`: 再做用户中心和运营管理后台。
5. `codex/wechat-pay-release`: 最后接微信支付、版本更新和安装包发布。

每个阶段都要能独立测试和提交。

## 文件结构

- 新建 `lib/commercial_plans.js`：定义 VIP/SVIP 套餐、Token 包、功能权限和扣费规则。
- 新建 `lib/commercial_entitlements.js`：根据订阅和功能开关判断用户是否能运行某个任务。
- 新建 `lib/cloud_api_client.js`：客户端调用云端 API 的轻量封装。
- 新建 `lib/billing_session.js`：封装 Token 预估、冻结、结算和释放流程。
- 修改 `web_server.js`：在运行付费任务前接入商业化授权和 Token 冻结；本地开发模式默认跳过云端校验。
- 新建 `electron/main.js`、`electron/preload.js`、`electron/window_config.js`：Electron 客户端外壳。
- 修改 `package.json`：增加 Electron 启动、打包脚本和必要依赖。
- 新建 `cloud/server.js`：云端 API 服务入口。
- 新建 `cloud/app.js`：云端 HTTP 路由。
- 新建 `cloud/db/schema.sql`：PostgreSQL 数据表结构。
- 新建 `cloud/lib/*.js`：账号、设备、订阅、Token 账本、任务记录、微信支付模块。
- 新建 `cloud/public/index.html`、`cloud/public/app.js`、`cloud/public/styles.css`：用户中心和运营管理后台共用前端项目。
- 新建测试：
  - `tests/commercial-plans-module.test.js`
  - `tests/commercial-entitlements-module.test.js`
  - `tests/cloud-api-client.test.js`
  - `tests/billing-session-module.test.js`
  - `tests/electron-shell-config.test.js`
  - `tests/cloud-auth-billing-api.test.js`
  - `tests/cloud-token-ledger.test.js`
  - `tests/cloud-admin-user-center-ui.test.js`
  - `tests/wechat-pay-module.test.js`

## Task 1: 商业套餐和 Token 规则

**Files:**
- Create: `lib/commercial_plans.js`
- Create: `tests/commercial-plans-module.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/commercial-plans-module.test.js`:

```js
const assert = require('assert');
const {
  PLANS,
  TOKEN_PACKS,
  FEATURE_KEYS,
  EDIT_MODE_TOKEN_COST,
  getPlanByCode,
  getTokenPackByCode,
  getEditTokenCost,
} = require('../lib/commercial_plans');

assert.deepStrictEqual(Object.keys(PLANS), ['vip', 'svip']);
assert.strictEqual(PLANS.vip.name, 'VIP');
assert.strictEqual(PLANS.vip.monthlyPriceCny, 69);
assert.strictEqual(PLANS.vip.monthlyTokens, 500);
assert.strictEqual(PLANS.svip.name, 'SVIP');
assert.strictEqual(PLANS.svip.monthlyPriceCny, 109);
assert.strictEqual(PLANS.svip.monthlyTokens, 1000);

assert.strictEqual(TOKEN_PACKS.standard.code, 'standard');
assert.strictEqual(TOKEN_PACKS.standard.tokens, 1000);
assert.strictEqual(TOKEN_PACKS.standard.priceCny, 100);

assert.strictEqual(FEATURE_KEYS.editProduct, 'editProduct');
assert.strictEqual(FEATURE_KEYS.flashSale, 'flashSale');
assert.strictEqual(FEATURE_KEYS.limitStoreUnpublish, 'limitStoreUnpublish');

assert.strictEqual(EDIT_MODE_TOKEN_COST.fast, 1);
assert.strictEqual(EDIT_MODE_TOKEN_COST.precise, 3);
assert.strictEqual(getEditTokenCost('fast'), 1);
assert.strictEqual(getEditTokenCost('precise'), 3);
assert.strictEqual(getEditTokenCost('unknown'), 1);

assert.strictEqual(getPlanByCode('vip').monthlyTokens, 500);
assert.strictEqual(getPlanByCode('SVIP').monthlyTokens, 1000);
assert.strictEqual(getPlanByCode('missing'), null);

assert.strictEqual(getTokenPackByCode('standard').priceCny, 100);
assert.strictEqual(getTokenPackByCode('missing'), null);

console.log('commercial plans checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/commercial-plans-module.test.js
```

Expected: FAIL with `Cannot find module '../lib/commercial_plans'`.

- [ ] **Step 3: 实现套餐模块**

Create `lib/commercial_plans.js`:

```js
const FEATURE_KEYS = Object.freeze({
  editProduct: 'editProduct',
  collectProduct: 'collectProduct',
  flashSale: 'flashSale',
  limitStoreUnpublish: 'limitStoreUnpublish',
  dashboard: 'dashboard',
});

const PLANS = Object.freeze({
  vip: Object.freeze({
    code: 'vip',
    name: 'VIP',
    monthlyPriceCny: 69,
    monthlyTokens: 500,
    tokenRollover: false,
    features: Object.freeze([
      FEATURE_KEYS.editProduct,
      FEATURE_KEYS.collectProduct,
      FEATURE_KEYS.flashSale,
      FEATURE_KEYS.limitStoreUnpublish,
      FEATURE_KEYS.dashboard,
    ]),
  }),
  svip: Object.freeze({
    code: 'svip',
    name: 'SVIP',
    monthlyPriceCny: 109,
    monthlyTokens: 1000,
    tokenRollover: false,
    features: Object.freeze([
      FEATURE_KEYS.editProduct,
      FEATURE_KEYS.collectProduct,
      FEATURE_KEYS.flashSale,
      FEATURE_KEYS.limitStoreUnpublish,
      FEATURE_KEYS.dashboard,
    ]),
  }),
});

const TOKEN_PACKS = Object.freeze({
  standard: Object.freeze({
    code: 'standard',
    name: '1000 Token 加油包',
    tokens: 1000,
    priceCny: 100,
  }),
});

const EDIT_MODE_TOKEN_COST = Object.freeze({
  fast: 1,
  precise: 3,
});

function normalizeCode(value) {
  return String(value || '').trim().toLowerCase();
}

function getPlanByCode(code) {
  return PLANS[normalizeCode(code)] || null;
}

function getTokenPackByCode(code) {
  return TOKEN_PACKS[normalizeCode(code)] || null;
}

function getEditTokenCost(mode) {
  return EDIT_MODE_TOKEN_COST[normalizeCode(mode)] || EDIT_MODE_TOKEN_COST.fast;
}

module.exports = {
  PLANS,
  TOKEN_PACKS,
  FEATURE_KEYS,
  EDIT_MODE_TOKEN_COST,
  getPlanByCode,
  getTokenPackByCode,
  getEditTokenCost,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node tests/commercial-plans-module.test.js
```

Expected: PASS with `commercial plans checks passed`.

- [ ] **Step 5: 提交**

```bash
git add lib/commercial_plans.js tests/commercial-plans-module.test.js
git commit -m "feat: add commercial plan rules"
```

## Task 2: 功能权限判断

**Files:**
- Create: `lib/commercial_entitlements.js`
- Create: `tests/commercial-entitlements-module.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/commercial-entitlements-module.test.js`:

```js
const assert = require('assert');
const { FEATURE_KEYS } = require('../lib/commercial_plans');
const {
  isSubscriptionActive,
  canUseFeature,
  buildEntitlementSnapshot,
} = require('../lib/commercial_entitlements');

const now = new Date('2026-07-06T00:00:00.000Z');

assert.strictEqual(isSubscriptionActive({ status: 'active', expiresAt: '2026-07-07T00:00:00.000Z' }, now), true);
assert.strictEqual(isSubscriptionActive({ status: 'active', expiresAt: '2026-07-05T23:59:59.000Z' }, now), false);
assert.strictEqual(isSubscriptionActive({ status: 'disabled', expiresAt: '2026-07-07T00:00:00.000Z' }, now), false);

const vipSubscription = {
  status: 'active',
  planCode: 'vip',
  expiresAt: '2026-08-06T00:00:00.000Z',
};

assert.deepStrictEqual(
  canUseFeature({ subscription: vipSubscription, featureKey: FEATURE_KEYS.editProduct, now }),
  { allowed: true, reason: '' },
);

assert.deepStrictEqual(
  canUseFeature({
    subscription: vipSubscription,
    featureKey: FEATURE_KEYS.editProduct,
    userFeatureOverrides: { editProduct: false },
    now,
  }),
  { allowed: false, reason: '功能已被单独关闭' },
);

assert.deepStrictEqual(
  canUseFeature({
    subscription: { status: 'active', planCode: 'vip', expiresAt: '2026-07-05T00:00:00.000Z' },
    featureKey: FEATURE_KEYS.flashSale,
    now,
  }),
  { allowed: false, reason: '订阅已过期' },
);

assert.deepStrictEqual(
  buildEntitlementSnapshot({
    subscription: vipSubscription,
    tokenBalance: 88,
    now,
  }),
  {
    planCode: 'vip',
    planName: 'VIP',
    active: true,
    expiresAt: '2026-08-06T00:00:00.000Z',
    tokenBalance: 88,
    features: {
      editProduct: true,
      collectProduct: true,
      flashSale: true,
      limitStoreUnpublish: true,
      dashboard: true,
    },
  },
);

console.log('commercial entitlement checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/commercial-entitlements-module.test.js
```

Expected: FAIL with `Cannot find module '../lib/commercial_entitlements'`.

- [ ] **Step 3: 实现权限模块**

Create `lib/commercial_entitlements.js`:

```js
const { FEATURE_KEYS, getPlanByCode } = require('./commercial_plans');

function toDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isSubscriptionActive(subscription, now = new Date()) {
  if (!subscription || subscription.status !== 'active') {
    return false;
  }
  const expiresAt = toDate(subscription.expiresAt);
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

function canUseFeature({
  subscription,
  featureKey,
  userFeatureOverrides = {},
  now = new Date(),
} = {}) {
  if (!isSubscriptionActive(subscription, now)) {
    return { allowed: false, reason: '订阅已过期' };
  }
  if (Object.prototype.hasOwnProperty.call(userFeatureOverrides, featureKey) && !userFeatureOverrides[featureKey]) {
    return { allowed: false, reason: '功能已被单独关闭' };
  }
  const plan = getPlanByCode(subscription.planCode);
  if (!plan) {
    return { allowed: false, reason: '套餐不存在' };
  }
  if (!plan.features.includes(featureKey)) {
    return { allowed: false, reason: '当前套餐不包含该功能' };
  }
  return { allowed: true, reason: '' };
}

function buildEntitlementSnapshot({
  subscription,
  tokenBalance = 0,
  userFeatureOverrides = {},
  now = new Date(),
} = {}) {
  const plan = getPlanByCode(subscription && subscription.planCode);
  const features = {};
  for (const featureKey of Object.values(FEATURE_KEYS)) {
    features[featureKey] = canUseFeature({
      subscription,
      featureKey,
      userFeatureOverrides,
      now,
    }).allowed;
  }
  return {
    planCode: plan ? plan.code : '',
    planName: plan ? plan.name : '',
    active: isSubscriptionActive(subscription, now),
    expiresAt: subscription && subscription.expiresAt ? String(subscription.expiresAt) : '',
    tokenBalance: Math.max(0, Number(tokenBalance) || 0),
    features,
  };
}

module.exports = {
  isSubscriptionActive,
  canUseFeature,
  buildEntitlementSnapshot,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node tests/commercial-entitlements-module.test.js
```

Expected: PASS with `commercial entitlement checks passed`.

- [ ] **Step 5: 提交**

```bash
git add lib/commercial_entitlements.js tests/commercial-entitlements-module.test.js
git commit -m "feat: add commercial entitlement checks"
```

## Task 3: 云端 API 客户端和计费会话

**Files:**
- Create: `lib/cloud_api_client.js`
- Create: `lib/billing_session.js`
- Create: `tests/cloud-api-client.test.js`
- Create: `tests/billing-session-module.test.js`

- [ ] **Step 1: 写云端 API 客户端测试**

Create `tests/cloud-api-client.test.js`:

```js
const assert = require('assert');
const http = require('http');
const { createCloudApiClient } = require('../lib/cloud_api_client');

(async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const client = createCloudApiClient({
    baseUrl: `http://127.0.0.1:${port}`,
    accessToken: 'access-token',
  });

  const result = await client.post('/billing/reserve', { taskType: 'editProduct' });
  assert.deepStrictEqual(result, { ok: true, path: '/billing/reserve' });
  assert.strictEqual(received[0].method, 'POST');
  assert.strictEqual(received[0].authorization, 'Bearer access-token');
  assert.strictEqual(received[0].body, JSON.stringify({ taskType: 'editProduct' }));

  await new Promise((resolve) => server.close(resolve));
  console.log('cloud api client checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 写计费会话测试**

Create `tests/billing-session-module.test.js`:

```js
const assert = require('assert');
const { createBillingSession } = require('../lib/billing_session');

(async () => {
  const calls = [];
  const client = {
    post: async (path, payload) => {
      calls.push({ path, payload });
      if (path === '/billing/reserve') {
        return { reservationId: 'r_1', reservedTokens: payload.estimatedTokens };
      }
      if (path === '/billing/settle') {
        return { settledTokens: payload.actualTokens };
      }
      if (path === '/billing/release') {
        return { released: true };
      }
      return {};
    },
  };

  const session = createBillingSession({
    cloudClient: client,
    taskType: 'editProduct',
    runId: 'run_1',
    estimatedTokens: 6,
  });

  const reservation = await session.reserve();
  assert.deepStrictEqual(reservation, { reservationId: 'r_1', reservedTokens: 6 });

  const settlement = await session.settle({ actualTokens: 3, successCount: 3 });
  assert.deepStrictEqual(settlement, { settledTokens: 3 });

  await session.release({ reason: 'task stopped' });

  assert.deepStrictEqual(calls.map((call) => call.path), [
    '/billing/reserve',
    '/billing/settle',
    '/billing/release',
  ]);
  assert.strictEqual(calls[0].payload.estimatedTokens, 6);
  assert.strictEqual(calls[1].payload.reservationId, 'r_1');
  assert.strictEqual(calls[2].payload.reason, 'task stopped');

  console.log('billing session checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
node tests/cloud-api-client.test.js
node tests/billing-session-module.test.js
```

Expected: both FAIL because the modules do not exist.

- [ ] **Step 4: 实现 `lib/cloud_api_client.js`**

Create `lib/cloud_api_client.js`:

```js
function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/u, '');
}

async function requestJson({ baseUrl, accessToken, method, path, payload }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data && data.error ? data.error : `云端请求失败：${response.status}`;
    throw new Error(message);
  }
  return data;
}

function createCloudApiClient({ baseUrl, accessToken }) {
  if (!baseUrl) {
    throw new Error('缺少云端 API 地址');
  }
  return {
    get(path) {
      return requestJson({ baseUrl, accessToken, method: 'GET', path });
    },
    post(path, payload) {
      return requestJson({ baseUrl, accessToken, method: 'POST', path, payload });
    },
    patch(path, payload) {
      return requestJson({ baseUrl, accessToken, method: 'PATCH', path, payload });
    },
  };
}

module.exports = {
  createCloudApiClient,
};
```

- [ ] **Step 5: 实现 `lib/billing_session.js`**

Create `lib/billing_session.js`:

```js
function createBillingSession({
  cloudClient,
  taskType,
  runId,
  estimatedTokens,
}) {
  let reservationId = '';

  return {
    async reserve() {
      const result = await cloudClient.post('/billing/reserve', {
        taskType,
        runId,
        estimatedTokens: Math.max(0, Number(estimatedTokens) || 0),
      });
      reservationId = String(result.reservationId || '');
      return result;
    },

    async settle({ actualTokens, successCount }) {
      return cloudClient.post('/billing/settle', {
        reservationId,
        taskType,
        runId,
        actualTokens: Math.max(0, Number(actualTokens) || 0),
        successCount: Math.max(0, Number(successCount) || 0),
      });
    },

    async release({ reason }) {
      return cloudClient.post('/billing/release', {
        reservationId,
        taskType,
        runId,
        reason: String(reason || ''),
      });
    },
  };
}

module.exports = {
  createBillingSession,
};
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node tests/cloud-api-client.test.js
node tests/billing-session-module.test.js
```

Expected: PASS with both success messages.

- [ ] **Step 7: 提交**

```bash
git add lib/cloud_api_client.js lib/billing_session.js tests/cloud-api-client.test.js tests/billing-session-module.test.js
git commit -m "feat: add cloud billing client"
```

## Task 4: Electron 客户端外壳

**Files:**
- Create: `electron/window_config.js`
- Create: `electron/main.js`
- Create: `electron/preload.js`
- Create: `tests/electron-shell-config.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写窗口配置测试**

Create `tests/electron-shell-config.test.js`:

```js
const assert = require('assert');
const {
  getElectronWindowOptions,
  getLocalWorkbenchUrl,
} = require('../electron/window_config');

const options = getElectronWindowOptions({ width: 1440, height: 900 });
assert.strictEqual(options.width, 1440);
assert.strictEqual(options.height, 900);
assert.strictEqual(options.minWidth, 1180);
assert.strictEqual(options.minHeight, 760);
assert.strictEqual(options.webPreferences.contextIsolation, true);
assert.strictEqual(options.webPreferences.nodeIntegration, false);

assert.strictEqual(getLocalWorkbenchUrl({ port: 3000 }), 'http://127.0.0.1:3000');
assert.strictEqual(getLocalWorkbenchUrl({ host: '0.0.0.0', port: 3000 }), 'http://127.0.0.1:3000');

console.log('electron shell config checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/electron-shell-config.test.js
```

Expected: FAIL with `Cannot find module '../electron/window_config'`.

- [ ] **Step 3: 实现 Electron 配置文件**

Create `electron/window_config.js`:

```js
const path = require('path');

function getLocalWorkbenchUrl({ host = '127.0.0.1', port = 3000 } = {}) {
  const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${browserHost}:${port}`;
}

function getElectronWindowOptions({ width = 1440, height = 900 } = {}) {
  return {
    width,
    height,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: '妙手自动化工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
}

module.exports = {
  getLocalWorkbenchUrl,
  getElectronWindowOptions,
};
```

- [ ] **Step 4: 增加 Electron 主进程**

Create `electron/main.js`:

```js
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { getElectronWindowOptions, getLocalWorkbenchUrl } = require('./window_config');

let serverProcess = null;
let mainWindow = null;

function startLocalWorkbench() {
  const env = {
    ...process.env,
    WEB_OPEN_BROWSER: '0',
    WEB_HOST: '127.0.0.1',
    WEB_PORT: process.env.WEB_PORT || '3000',
  };
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'web_server.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'inherit',
  });
  return Number(env.WEB_PORT);
}

async function createWindow() {
  const port = startLocalWorkbench();
  mainWindow = new BrowserWindow(getElectronWindowOptions());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(getLocalWorkbenchUrl({ port }));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
```

Create `electron/preload.js`:

```js
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('miaoshouDesktop', {
  platform: process.platform,
  version: process.env.npm_package_version || '1.0.0',
});
```

- [ ] **Step 5: 修改 `package.json`**

Modify scripts and dev dependencies:

```json
{
  "scripts": {
    "electron": "electron electron/main.js",
    "electron:pack": "electron-builder --dir",
    "electron:dist": "electron-builder"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  },
  "build": {
    "appId": "com.miaoshou.autotool",
    "productName": "妙手自动化工具",
    "files": [
      "electron/**/*",
      "public/**/*",
      "lib/**/*",
      "tools/**/*",
      "*.js",
      "package.json",
      "node_modules/**/*"
    ],
    "mac": {
      "target": ["dmg"]
    },
    "win": {
      "target": ["nsis"]
    }
  }
}
```

Keep existing scripts and dependencies. Add these keys without removing `web`, `test`, `check`, or current dependencies.

- [ ] **Step 6: 安装依赖并验证**

Run:

```bash
npm install
node tests/electron-shell-config.test.js
npm run check
```

Expected: Electron config test passes, `npm run check` passes.

- [ ] **Step 7: 提交**

```bash
git add electron package.json package-lock.json tests/electron-shell-config.test.js
git commit -m "feat: add electron shell"
```

## Task 5: 云端服务骨架和数据库结构

**Files:**
- Create: `cloud/app.js`
- Create: `cloud/server.js`
- Create: `cloud/db/schema.sql`
- Create: `cloud/lib/json_response.js`
- Create: `tests/cloud-auth-billing-api.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写云端健康检查测试**

Create `tests/cloud-auth-billing-api.test.js`:

```js
const assert = require('assert');
const { createCloudApp } = require('../cloud/app');

(async () => {
  const server = createCloudApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const data = await response.json();
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(data, { ok: true, service: 'miaoshou-cloud' });

  await new Promise((resolve) => server.close(resolve));
  console.log('cloud api checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/cloud-auth-billing-api.test.js
```

Expected: FAIL with `Cannot find module '../cloud/app'`.

- [ ] **Step 3: 实现云端 HTTP 骨架**

Create `cloud/lib/json_response.js`:

```js
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

module.exports = {
  sendJson,
};
```

Create `cloud/app.js`:

```js
const http = require('http');
const { sendJson } = require('./lib/json_response');

function createCloudApp() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, service: 'miaoshou-cloud' });
      return;
    }

    sendJson(res, 404, { ok: false, error: '接口不存在' });
  });
}

module.exports = {
  createCloudApp,
};
```

Create `cloud/server.js`:

```js
const { createCloudApp } = require('./app');

const host = process.env.CLOUD_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.CLOUD_PORT || '3100', 10);

const server = createCloudApp();
server.listen(port, host, () => {
  console.log(`Miaoshou cloud API listening on http://${host}:${port}`);
});
```

- [ ] **Step 4: 写 PostgreSQL 结构**

Create `cloud/db/schema.sql`:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  device_fingerprint TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  status TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_fingerprint)
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE token_ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE token_reservations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  task_id UUID,
  reserved_tokens INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 5: 修改 `package.json` 脚本**

Add:

```json
{
  "scripts": {
    "cloud": "node cloud/server.js"
  }
}
```

Keep all existing scripts.

- [ ] **Step 6: 验证**

Run:

```bash
node tests/cloud-auth-billing-api.test.js
npm run check
```

Expected: test passes and syntax check passes.

- [ ] **Step 7: 提交**

```bash
git add cloud package.json package-lock.json tests/cloud-auth-billing-api.test.js
git commit -m "feat: add cloud service skeleton"
```

## Task 6: Token 账本和冻结结算

**Files:**
- Create: `cloud/lib/token_ledger.js`
- Create: `tests/cloud-token-ledger.test.js`
- Modify: `cloud/app.js`

- [ ] **Step 1: 写 Token 账本测试**

Create `tests/cloud-token-ledger.test.js`:

```js
const assert = require('assert');
const {
  createInMemoryTokenLedger,
} = require('../cloud/lib/token_ledger');

const ledger = createInMemoryTokenLedger();
ledger.grant({ userId: 'u1', amount: 500, referenceId: 'sub_vip', note: 'VIP 月度 Token' });
assert.strictEqual(ledger.getBalance('u1'), 500);

const reservation = ledger.reserve({
  userId: 'u1',
  amount: 6,
  taskId: 'task_1',
  expiresAt: '2026-07-06T01:00:00.000Z',
});
assert.strictEqual(ledger.getBalance('u1'), 494);
assert.strictEqual(reservation.reservedTokens, 6);

ledger.settle({
  userId: 'u1',
  reservationId: reservation.id,
  actualTokens: 3,
});
assert.strictEqual(ledger.getBalance('u1'), 497);

const secondReservation = ledger.reserve({
  userId: 'u1',
  amount: 5,
  taskId: 'task_2',
  expiresAt: '2026-07-06T01:00:00.000Z',
});
ledger.release({
  userId: 'u1',
  reservationId: secondReservation.id,
  reason: '任务失败',
});
assert.strictEqual(ledger.getBalance('u1'), 497);

assert.throws(
  () => ledger.reserve({ userId: 'u1', amount: 9999, taskId: 'task_3', expiresAt: '2026-07-06T01:00:00.000Z' }),
  /Token 余额不足/,
);

console.log('cloud token ledger checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/cloud-token-ledger.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: 实现内存账本**

Create `cloud/lib/token_ledger.js`:

```js
const { randomUUID } = require('crypto');

function createInMemoryTokenLedger() {
  const balances = new Map();
  const reservations = new Map();
  const entries = [];

  function getBalance(userId) {
    return balances.get(userId) || 0;
  }

  function applyEntry({ userId, type, amount, referenceId, note }) {
    const nextBalance = getBalance(userId) + amount;
    if (nextBalance < 0) {
      throw new Error('Token 余额不足');
    }
    balances.set(userId, nextBalance);
    entries.push({
      id: randomUUID(),
      userId,
      type,
      amount,
      balanceAfter: nextBalance,
      referenceId,
      note: note || '',
      createdAt: new Date().toISOString(),
    });
    return nextBalance;
  }

  function grant({ userId, amount, referenceId, note }) {
    return applyEntry({
      userId,
      type: 'grant',
      amount: Math.max(0, Number(amount) || 0),
      referenceId,
      note,
    });
  }

  function reserve({ userId, amount, taskId, expiresAt }) {
    const reservedTokens = Math.max(0, Number(amount) || 0);
    applyEntry({
      userId,
      type: 'reserve',
      amount: -reservedTokens,
      referenceId: taskId,
      note: 'Token 冻结',
    });
    const reservation = {
      id: randomUUID(),
      userId,
      taskId,
      reservedTokens,
      status: 'reserved',
      expiresAt,
    };
    reservations.set(reservation.id, reservation);
    return reservation;
  }

  function settle({ userId, reservationId, actualTokens }) {
    const reservation = reservations.get(reservationId);
    if (!reservation || reservation.userId !== userId || reservation.status !== 'reserved') {
      throw new Error('Token 冻结记录不存在');
    }
    const used = Math.max(0, Number(actualTokens) || 0);
    const refund = Math.max(0, reservation.reservedTokens - used);
    reservation.status = 'settled';
    if (refund > 0) {
      applyEntry({
        userId,
        type: 'release',
        amount: refund,
        referenceId: reservationId,
        note: '结算后释放未使用 Token',
      });
    }
    entries.push({
      id: randomUUID(),
      userId,
      type: 'settle',
      amount: -used,
      balanceAfter: getBalance(userId),
      referenceId: reservationId,
      note: 'Token 正式结算',
      createdAt: new Date().toISOString(),
    });
    return { settledTokens: used, releasedTokens: refund };
  }

  function release({ userId, reservationId, reason }) {
    const reservation = reservations.get(reservationId);
    if (!reservation || reservation.userId !== userId || reservation.status !== 'reserved') {
      throw new Error('Token 冻结记录不存在');
    }
    reservation.status = 'released';
    applyEntry({
      userId,
      type: 'release',
      amount: reservation.reservedTokens,
      referenceId: reservationId,
      note: reason || '释放冻结 Token',
    });
    return { releasedTokens: reservation.reservedTokens };
  }

  return {
    getBalance,
    grant,
    reserve,
    settle,
    release,
    listEntries: () => entries.slice(),
  };
}

module.exports = {
  createInMemoryTokenLedger,
};
```

- [ ] **Step 4: 接入云端 `/billing/*` 路由**

Modify `cloud/app.js` so `POST /billing/reserve`, `POST /billing/settle`, and `POST /billing/release` call the ledger. Use a fixed development user id `dev-user` until auth is implemented.

- [ ] **Step 5: 验证**

Run:

```bash
node tests/cloud-token-ledger.test.js
node tests/cloud-auth-billing-api.test.js
npm run check
```

Expected: tests pass and syntax check passes.

- [ ] **Step 6: 提交**

```bash
git add cloud/lib/token_ledger.js cloud/app.js tests/cloud-token-ledger.test.js
git commit -m "feat: add token ledger"
```

## Task 7: 用户中心和运营管理后台前端

**Files:**
- Create: `cloud/public/index.html`
- Create: `cloud/public/app.js`
- Create: `cloud/public/styles.css`
- Create: `tests/cloud-admin-user-center-ui.test.js`
- Modify: `cloud/app.js`

- [ ] **Step 1: 写 UI 静态检查测试**

Create `tests/cloud-admin-user-center-ui.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'cloud/public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'cloud/public/index.html'), 'utf8');

assert(html.includes('妙手自动化商业后台'));
assert(appJs.includes('用户中心'));
assert(appJs.includes('运营管理后台'));
assert(appJs.includes('VIP'));
assert(appJs.includes('SVIP'));
assert(appJs.includes('1000 Token / 100 元'));
assert(appJs.includes('微信支付'));
assert(appJs.includes('公司主体'));

console.log('cloud admin user center ui checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/cloud-admin-user-center-ui.test.js
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: 创建后台网页**

Create `cloud/public/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>妙手自动化商业后台</title>
  <link rel="stylesheet" href="/admin/styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="/admin/app.js"></script>
</body>
</html>
```

Create `cloud/public/app.js` with a first-version static dashboard that includes two sections: `用户中心` and `运营管理后台`. Show VIP/SVIP plan cards, Token balance placeholder, Token package `1000 Token / 100 元`, device list placeholder, user management table placeholder, and model pricing placeholder.

Create `cloud/public/styles.css` with a compact admin layout, light background, readable tables, and responsive two-column cards.

- [ ] **Step 4: 接入静态资源路由**

Modify `cloud/app.js` so:

- `GET /admin` serves `cloud/public/index.html`
- `GET /admin/app.js` serves `cloud/public/app.js`
- `GET /admin/styles.css` serves `cloud/public/styles.css`

- [ ] **Step 5: 验证**

Run:

```bash
node tests/cloud-admin-user-center-ui.test.js
npm run check
```

Expected: UI static check passes and syntax check passes.

- [ ] **Step 6: 提交**

```bash
git add cloud/public cloud/app.js tests/cloud-admin-user-center-ui.test.js
git commit -m "feat: add cloud admin and user center shell"
```

## Task 8: 微信支付模块

**Files:**
- Create: `cloud/lib/wechat_pay.js`
- Create: `tests/wechat-pay-module.test.js`
- Modify: `cloud/app.js`

- [ ] **Step 1: 写微信支付参数测试**

Create `tests/wechat-pay-module.test.js`:

```js
const assert = require('assert');
const {
  buildWechatPayOrderPayload,
  validateWechatPayConfig,
} = require('../cloud/lib/wechat_pay');

assert.deepStrictEqual(
  validateWechatPayConfig({
    appId: 'wx_app',
    mchId: 'mch_1',
    privateKeyPath: '/secure/apiclient_key.pem',
    serialNo: 'serial_1',
    notifyUrl: 'https://example.com/pay/wechat/notify',
  }),
  { valid: true, missing: [] },
);

assert.deepStrictEqual(
  validateWechatPayConfig({ appId: 'wx_app' }),
  {
    valid: false,
    missing: ['mchId', 'privateKeyPath', 'serialNo', 'notifyUrl'],
  },
);

assert.deepStrictEqual(
  buildWechatPayOrderPayload({
    description: 'SVIP 月度订阅',
    outTradeNo: 'order_1',
    amountCny: 109,
    notifyUrl: 'https://example.com/pay/wechat/notify',
    payerOpenId: 'openid_1',
  }),
  {
    description: 'SVIP 月度订阅',
    out_trade_no: 'order_1',
    notify_url: 'https://example.com/pay/wechat/notify',
    amount: { total: 10900, currency: 'CNY' },
    payer: { openid: 'openid_1' },
  },
);

console.log('wechat pay module checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/wechat-pay-module.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: 实现微信支付参数模块**

Create `cloud/lib/wechat_pay.js`:

```js
function validateWechatPayConfig(config = {}) {
  const required = ['appId', 'mchId', 'privateKeyPath', 'serialNo', 'notifyUrl'];
  const missing = required.filter((key) => !config[key]);
  return { valid: missing.length === 0, missing };
}

function buildWechatPayOrderPayload({
  description,
  outTradeNo,
  amountCny,
  notifyUrl,
  payerOpenId,
}) {
  return {
    description: String(description || ''),
    out_trade_no: String(outTradeNo || ''),
    notify_url: String(notifyUrl || ''),
    amount: {
      total: Math.round((Number(amountCny) || 0) * 100),
      currency: 'CNY',
    },
    payer: {
      openid: String(payerOpenId || ''),
    },
  };
}

module.exports = {
  validateWechatPayConfig,
  buildWechatPayOrderPayload,
};
```

- [ ] **Step 4: 接入支付创建订单路由**

Modify `cloud/app.js` so `POST /payments/wechat/create` accepts:

```json
{
  "productType": "subscription",
  "planCode": "svip"
}
```

Return a development response:

```json
{
  "ok": true,
  "provider": "wechat",
  "subjectType": "company",
  "amountCny": 109,
  "description": "SVIP 月度订阅"
}
```

The real signed WeChat request can be implemented after merchant credentials are available.

- [ ] **Step 5: 验证**

Run:

```bash
node tests/wechat-pay-module.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 6: 提交**

```bash
git add cloud/lib/wechat_pay.js cloud/app.js tests/wechat-pay-module.test.js
git commit -m "feat: add wechat pay order contract"
```

## Task 9: 当前本地工作台接入云端授权开关

**Files:**
- Modify: `web_server.js`
- Modify: `public/app.js`
- Create: `tests/commercial-run-gating.test.js`

- [ ] **Step 1: 写运行授权测试**

Create `tests/commercial-run-gating.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');

assert(server.includes('CLOUD_API_BASE_URL'));
assert(server.includes('COMMERCIAL_MODE'));
assert(server.includes('createBillingSession'));
assert(server.includes('editProduct'));

assert(app.includes('Token 余额'));
assert(app.includes('订阅状态'));

console.log('commercial run gating checks passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node tests/commercial-run-gating.test.js
```

Expected: FAIL until the server and UI include commercial mode hooks.

- [ ] **Step 3: 修改 `web_server.js`**

Add:

```js
const { createCloudApiClient } = require('./lib/cloud_api_client');
const { createBillingSession } = require('./lib/billing_session');
const { getEditTokenCost } = require('./lib/commercial_plans');

const COMMERCIAL_MODE = process.env.COMMERCIAL_MODE === '1';
const CLOUD_API_BASE_URL = process.env.CLOUD_API_BASE_URL || '';
```

Before starting an edit-product child process, if `COMMERCIAL_MODE` is enabled:

- create a cloud client with the current access token
- estimate tokens as `count * getEditTokenCost(processingMode)`
- reserve tokens before launching the task
- settle tokens from successful product count when the run completes
- release reservation when the run is stopped or fails before completion

Keep local development behavior unchanged when `COMMERCIAL_MODE` is not enabled.

- [ ] **Step 4: 修改 `public/app.js`**

Add subscription and Token display fields near the current run/account area:

- `订阅状态`
- `Token 余额`
- `当前套餐`

If no cloud session exists, display local mode text:

```text
本地模式
```

- [ ] **Step 5: 验证**

Run:

```bash
node tests/commercial-run-gating.test.js
npm run check
npm test
```

Expected: targeted test, syntax check, and full test suite pass.

- [ ] **Step 6: 提交**

```bash
git add web_server.js public/app.js tests/commercial-run-gating.test.js
git commit -m "feat: gate paid runs with cloud billing"
```

## Task 10: 发布和验收

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Create: `docs/commercial-release-checklist.md`

- [ ] **Step 1: 更新配置模板**

Add to `.env.example`:

```bash
COMMERCIAL_MODE=0
CLOUD_API_BASE_URL=
CLOUD_ACCESS_TOKEN=
CLOUD_HOST=127.0.0.1
CLOUD_PORT=3100
WECHAT_PAY_APP_ID=
WECHAT_PAY_MCH_ID=
WECHAT_PAY_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY_PATH=
WECHAT_PAY_NOTIFY_URL=
```

- [ ] **Step 2: 写发布检查清单**

Create `docs/commercial-release-checklist.md`:

```markdown
# 商业版发布检查清单

- [ ] Mac 安装包可以启动。
- [ ] Windows 安装包可以启动。
- [ ] 本地模式不影响现有网页工作台。
- [ ] 云端账号可以登录。
- [ ] 设备可以激活和解绑。
- [ ] VIP 订阅显示 69 元/月和 500 Token。
- [ ] SVIP 订阅显示 109 元/月和 1000 Token。
- [ ] Token 包显示 1000 Token / 100 元。
- [ ] 月度 Token 不结转。
- [ ] 快速编辑商品成功 1 个扣 1 Token。
- [ ] 精细编辑商品成功 1 个扣 3 Token。
- [ ] 秒杀管理不扣 Token。
- [ ] 上限店铺商品下架不扣 Token。
- [ ] 微信支付使用公司主体商户号。
- [ ] 管理员所有余额调整都有审计日志。
```

- [ ] **Step 3: 更新 README**

Add a `商业版规划` section describing:

- Electron 客户端支持 Mac 和 Windows。
- 云端账号控制订阅和 Token。
- VIP 69 元/月含 500 Token。
- SVIP 109 元/月含 1000 Token。
- Token 包 1000 Token / 100 元。
- 微信支付使用公司主体。
- 妙手账号长期保存在本地，不上传云端。

- [ ] **Step 4: 全量验证**

Run:

```bash
npm run check
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: 提交**

```bash
git add .env.example README.md docs/commercial-release-checklist.md
git commit -m "docs: add commercial release checklist"
```

## 自查清单

- 设计文档中的所有已确认决策都有任务覆盖：VIP/SVIP、微信支付公司主体、Token 不结转、Token 包、同一前端项目、本地保存妙手账号。
- 付费商品编辑的扣费点在 Task 1、Task 3、Task 9 覆盖。
- 订阅和功能权限在 Task 2、Task 6、Task 9 覆盖。
- 用户中心和运营管理后台在 Task 7 覆盖。
- Electron 客户端在 Task 4 覆盖。
- 微信支付在 Task 8 覆盖。
- 发布检查和文档在 Task 10 覆盖。
