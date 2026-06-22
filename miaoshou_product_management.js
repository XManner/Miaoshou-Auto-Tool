const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const {
  DEFAULT_ZERO_SALES_RETAIN_COUNT,
  resolveManualStoreTargets,
  runProductLimitStoreCleanup,
} = require('./lib/product_limit_store_cleanup');

const PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES = 'unpublish-limit-stores';
const DEFAULT_BROWSER_WINDOW_WIDTH = 1600;
const DEFAULT_BROWSER_WINDOW_HEIGHT = 1100;

function splitStoreList(value = '') {
  return String(value || '')
    .split(/[,，、]+/)
    .map((storeName) => storeName.trim())
    .filter(Boolean);
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} 需要提供参数值。`);
  }
  return value;
}

function parseProductManagementArgs(argv = process.argv.slice(2)) {
  const options = {
    task: PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES,
    maxPages: 5,
    dryRun: false,
    retainCount: DEFAULT_ZERO_SALES_RETAIN_COUNT,
    stores: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--task') {
      options.task = readOptionValue(argv, index, '--task');
      index += 1;
      continue;
    }

    if (arg === '--max-pages') {
      options.maxPages = Number.parseInt(readOptionValue(argv, index, '--max-pages'), 10);
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--retain-count') {
      options.retainCount = Number.parseInt(readOptionValue(argv, index, '--retain-count'), 10);
      index += 1;
      continue;
    }

    if (arg === '--stores') {
      options.stores = splitStoreList(readOptionValue(argv, index, '--stores'));
      index += 1;
      continue;
    }

    throw new Error(`未知商品管理参数：${arg}`);
  }

  if (options.task !== PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES) {
    throw new Error(`不支持的商品管理任务：${options.task}`);
  }

  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error('--max-pages 必须是大于 0 的整数。');
  }

  if (!Number.isInteger(options.retainCount) || options.retainCount < 0) {
    throw new Error('--retain-count 必须是大于等于 0 的整数。');
  }

  if (options.stores.length > 0) {
    resolveManualStoreTargets(options.stores);
  }

  return options;
}

function chromeExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.CHROME_EXECUTABLE_PATH
    || process.env.CHROME_PATH;
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    fromEnv,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : '',
    `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    localAppData ? `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe` : '',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('没有找到可用的 Chrome。请确认已安装 Chrome 或 Edge。');
  }
  return found;
}

function safeProfileName(value = '') {
  return String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function getProfileDir() {
  const accountKey = process.env.MIAOSHOU_ACCOUNT_ID || process.env.MIAOSHOU_ACCOUNT_LABEL || 'default';
  return path.join(__dirname, '.miaoshou-browser', safeProfileName(accountKey));
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: chromeExecutablePath(),
    headless: false,
    defaultViewport: null,
    userDataDir: getProfileDir(),
    args: [
      '--start-maximized',
      '--window-size=1600,1100',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });
}

async function maximizeBrowserWindow(page) {
  if (!page || page.isClosed()) {
    return;
  }

  const session = await page.target().createCDPSession().catch(() => null);
  if (!session) {
    return;
  }

  try {
    const windowInfo = await session.send('Browser.getWindowForTarget').catch(() => null);
    const windowId = windowInfo && windowInfo.windowId;
    if (!Number.isFinite(windowId)) {
      return;
    }

    const maximized = await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        windowState: 'maximized',
      },
    }).then(() => true).catch(() => false);

    if (!maximized) {
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: 0,
          top: 0,
          width: DEFAULT_BROWSER_WINDOW_WIDTH,
          height: DEFAULT_BROWSER_WINDOW_HEIGHT,
        },
      }).catch(() => {});
    }
  } finally {
    await session.detach().catch(() => {});
  }
}

async function getBrowserWindowBounds(page) {
  if (!page || page.isClosed()) {
    return null;
  }

  const session = await page.target().createCDPSession().catch(() => null);
  if (!session) {
    return null;
  }

  try {
    const windowInfo = await session.send('Browser.getWindowForTarget').catch(() => null);
    const windowId = windowInfo && windowInfo.windowId;
    if (!Number.isFinite(windowId)) {
      return null;
    }

    return await session.send('Browser.getWindowBounds', { windowId }).catch(() => null);
  } finally {
    await session.detach().catch(() => {});
  }
}

function resolveBrowserViewportDimension({
  windowSize,
  currentSize,
  defaultSize,
  windowInset = 0,
}) {
  const resolvedWindowSize = Math.floor(Number(windowSize) || 0) - windowInset;
  if (resolvedWindowSize > 0) {
    return resolvedWindowSize;
  }

  const resolvedCurrentSize = Math.floor(Number(currentSize) || 0);
  if (resolvedCurrentSize > 0) {
    return resolvedCurrentSize;
  }

  return defaultSize;
}

async function ensureLargeBrowserViewport(page) {
  if (!page || page.isClosed()) {
    return;
  }

  await maximizeBrowserWindow(page);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const windowBounds = await getBrowserWindowBounds(page);
  const currentViewport = await page.evaluate(() => ({
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  })).catch(() => null);
  const viewportWidth = resolveBrowserViewportDimension({
    windowSize: windowBounds && windowBounds.width,
    currentSize: currentViewport && currentViewport.width,
    defaultSize: DEFAULT_BROWSER_WINDOW_WIDTH,
  });
  const viewportHeight = resolveBrowserViewportDimension({
    windowSize: windowBounds && windowBounds.height,
    currentSize: currentViewport && currentViewport.height,
    defaultSize: DEFAULT_BROWSER_WINDOW_HEIGHT,
    windowInset: 120,
  });

  await page.setViewport({
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
  }).catch(() => {});
  await page.evaluate(({ width, height }) => {
    window.moveTo(0, 0);
    window.resizeTo(width, height);
  }, {
    width: viewportWidth,
    height: viewportHeight,
  }).catch(() => {});
}

function emitCliProgress(event = {}) {
  process.stderr.write(`MIAOSHOU_PROGRESS ${JSON.stringify(event)}\n`);
}

async function runProductManagementTask(options) {
  return runProductLimitStoreCleanup(options);
}

async function main() {
  const options = parseProductManagementArgs();
  let browser = null;

  emitCliProgress({
    phase: 'prepare',
    phaseLabel: '准备商品管理任务',
    task: options.task,
    maxPages: options.maxPages,
    dryRun: options.dryRun,
    retainCount: options.retainCount,
    storeCount: options.stores.length,
  });

  try {
    browser = await launchBrowser();
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await ensureLargeBrowserViewport(page);
    const summary = await runProductManagementTask({ ...options, page });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
  });
}

module.exports = {
  PRODUCT_MANAGEMENT_TASK_UNPUBLISH_LIMIT_STORES,
  parseProductManagementArgs,
};
