const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const puppeteer = require('puppeteer-core');
const { FLASH_SELECTORS } = require('./lib/automation_selectors');
const { captureBrowserArtifacts } = require('./lib/automation_artifacts');

const FLASH_SALE_URL = 'https://erp.91miaoshou.com/tiktok/marketing/flashSale';
const DEFAULT_TIMEOUT = 30000;
const LOGIN_TIMEOUT = 10 * 60 * 1000;
const MAX_FAILURE_RETRY_ROUNDS = 5;
const MAX_ADD_PRODUCT_SEARCH_RESULT_COUNT = 1000;
const FLASH_SAFE_STEP_DELAY_MS = 500;
const DEFAULT_BROWSER_WINDOW_WIDTH = 1600;
const DEFAULT_BROWSER_WINDOW_HEIGHT = 1100;
const FLASH_SELECTION_MODE_COUNT = 'count';
const FLASH_SELECTION_MODE_ALL = 'all';
const FLASH_SELECTION_MODE_IDS = 'ids';
const ADD_PRODUCT_EXCLUSION_FILTER_LABELS = [
  '隐藏已参与限时秒杀的产品',
  '隐藏已参与本次活动的产品',
];
const STOP_BROWSER_CLOSE_TIMEOUT_MS = 3000;

let activeBrowser = null;
let stoppingBySignal = false;

function closeBrowserWithTimeout(browser, timeoutMs = STOP_BROWSER_CLOSE_TIMEOUT_MS) {
  if (!browser) {
    return Promise.resolve();
  }
  return Promise.race([
    browser.close(),
    sleep(timeoutMs),
  ]).catch(() => { });
}

async function stopFromSignal(signal) {
  if (stoppingBySignal) {
    return;
  }
  stoppingBySignal = true;
  log(`收到停止信号 ${signal}，正在关闭自动化浏览器。`);
  await closeBrowserWithTimeout(activeBrowser);
  process.exit(130);
}

process.once('SIGTERM', () => {
  stopFromSignal('SIGTERM');
});

process.once('SIGINT', () => {
  stopFromSignal('SIGINT');
});

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    count: 1,
    flashSelectionMode: FLASH_SELECTION_MODE_COUNT,
    activityIds: [],
    skipActivityIds: [],
    headless: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--count' || arg === '--flash-count') {
      args.count = Number.parseInt(argv[index + 1], 10);
      args.flashSelectionMode = FLASH_SELECTION_MODE_COUNT;
      index += 1;
      continue;
    }
    if (arg === '--all') {
      args.flashSelectionMode = FLASH_SELECTION_MODE_ALL;
      args.count = 0;
      continue;
    }
    if (arg === '--activity-ids') {
      args.activityIds = String(argv[index + 1] || '')
        .split(/[\s,，、]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      args.flashSelectionMode = FLASH_SELECTION_MODE_IDS;
      args.count = args.activityIds.length;
      index += 1;
      continue;
    }
    if (arg === '--skip-activity-ids') {
      args.skipActivityIds = String(argv[index + 1] || '')
        .split(/[\s,，、]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--headless') {
      args.headless = argv[index + 1] === 'true';
      index += 1;
      continue;
    }
  }

  if (args.flashSelectionMode === FLASH_SELECTION_MODE_COUNT && (!Number.isFinite(args.count) || args.count < 1 || args.count > 100)) {
    throw new Error('秒杀活动数量必须是 1 到 100 之间的整数。');
  }
  if (args.flashSelectionMode === FLASH_SELECTION_MODE_IDS && args.activityIds.length === 0) {
    throw new Error('指定秒杀活动 ID 不能为空。');
  }

  return args;
}

function emitProgress(event = {}) {
  if (String(process.env.MIAOSHOU_PROGRESS || '') !== '1') {
    return;
  }
  process.stderr.write(`MIAOSHOU_PROGRESS ${JSON.stringify(event)}\n`);
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function getCaptchaDir() {
  return process.env.MIAOSHOU_CAPTCHA_DIR || path.join(__dirname, '.captcha');
}

function getRunId() {
  return String(process.env.MIAOSHOU_RUN_ID || 'manual').replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function saveFlashFailureArtifacts(browser, context = {}, error = null) {
  try {
    const result = await captureBrowserArtifacts(browser, {
      runId: getRunId(),
      stage: context.stage || 'flash-failure',
      label: context.label || '',
      error,
      limit: 3,
    });
    if (result && Array.isArray(result.artifacts) && result.artifacts.length > 0) {
      log(`已保存失败页面诊断证据：${result.dir}`);
    }
  } catch (captureError) {
    log(`保存失败页面诊断证据失败：${captureError.message || String(captureError)}`);
  }
}

function safeFilePart(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 160);
}

function captchaResponsePath(captchaId) {
  return path.join(getCaptchaDir(), `captcha-response-${safeFilePart(captchaId)}.json`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChromeExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
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
      }).catch(() => { });
    }
  } finally {
    await session.detach().catch(() => { });
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
    await session.detach().catch(() => { });
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
  await sleep(300);

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
  }).catch(() => { });
  await page.evaluate(({ width, height }) => {
    window.moveTo(0, 0);
    window.resizeTo(width, height);
  }, {
    width: viewportWidth,
    height: viewportHeight,
  }).catch(() => { });
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseFirstNumberBefore(text = '', suffix = '条') {
  const match = String(text || '').match(new RegExp(`(\\d+)\\s*${suffix}`));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseProductTotalCount(text = '') {
  const counts = Array.from(String(text || '').matchAll(/(\d+)\s*条(?!\s*\/\s*页)/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((count) => Number.isFinite(count) && count >= 0);
  return counts.length > 0 ? counts[0] : 0;
}

function allFilteredProductsVisible(text = '', rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }
  const productCount = parseProductTotalCount(text);
  return productCount > 0 && rows.length >= productCount;
}

function parseSelectedCount(text = '') {
  const match = String(text || '').match(/已(?:选|选择|选中)[^\d]{0,12}(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function hasEmptyTableText(text = '') {
  const normalized = normalizeText(text);
  return /暂无数据|没有数据/.test(normalized)
    || /(^|[^\d])0\s*条(?!\/页)/.test(normalized);
}

function hasLoginCueText(text = '') {
  const normalized = normalizeText(text);
  return /立即登录|扫码登录|账号登录|密码登录|忘记密码|手机号\/子账号\/邮箱|请输入.*(手机号|手机|账号|邮箱|密码|验证码)/.test(normalized);
}

function isFlashSaleListReadyText(text = '', url = '') {
  const normalized = normalizeText(text);
  if (!url.includes('/tiktok/marketing/flashSale') && !normalized.includes('限时秒杀')) {
    return false;
  }
  return /活动名称|管理产品|活动状态|活动ID|活动时间|创建活动|批量终止|进行中\s*\(\s*\d+\s*\)/.test(normalized);
}

function isFlashSaleShellText(text = '', url = '') {
  const normalized = normalizeText(text);
  return url.includes('/tiktok/marketing/flashSale')
    && normalized.includes('限时秒杀')
    && !hasLoginCueText(normalized);
}

function parseActivityFromRow(text = '') {
  const normalized = normalizeText(text);
  const idMatch = normalized.match(/\b\d{16,22}\b/);
  const id = idMatch ? idMatch[0] : '';
  const title = idMatch ? normalized.slice(0, idMatch.index).trim() : normalized.split(' 管理产品 ')[0].trim();
  const discountMatch = title.match(/(\d+(?:\.\d+)?)\s*%/);
  const productMatch = normalized.match(/(\d+)个产品（含(\d+)个SKU）/);
  const failedMatch = normalized.match(/(\d+)个产品（含(\d+)个SKU）添加失败/);
  return {
    id,
    title,
    discount: discountMatch ? Number.parseFloat(discountMatch[1]) : null,
    productCount: productMatch ? Number.parseInt(productMatch[1], 10) : 0,
    skuCount: productMatch ? Number.parseInt(productMatch[2], 10) : 0,
    failedProductCount: failedMatch ? Number.parseInt(failedMatch[1], 10) : 0,
    text: normalized,
  };
}

function buildActivityKey(activity = {}) {
  return buildActivityKeys(activity)[0] || '';
}

function buildActivityKeys(activity = {}) {
  const keys = [];
  const addKey = (value) => {
    const key = normalizeText(value);
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  };

  addKey(activity.id);
  addKey(activity.activityId);
  addKey(activity.title);
  addKey(activity.activityTitle);

  const text = normalizeText(activity.text);
  const idMatch = text.match(/\b\d{16,22}\b/);
  if (idMatch) {
    addKey(idMatch[0]);
    addKey(text.slice(0, idMatch.index).trim());
  }

  return keys;
}

function hasProcessedActivity(processedActivityKeys, activity = {}) {
  const keys = buildActivityKeys(activity);
  return keys.length > 0 && keys.some((key) => processedActivityKeys.has(key));
}

function markProcessedActivity(processedActivityKeys, activity = {}) {
  buildActivityKeys(activity).forEach((key) => processedActivityKeys.add(key));
}

function isNavigationContextError(error) {
  const message = String(error && error.message ? error.message : error || '');
  return message.includes('Execution context was destroyed')
    || message.includes('Cannot find context with specified id')
    || message.includes('Inspected target navigated or closed')
    || message.includes('Attempted to use detached Frame')
    || message.includes('detached Frame');
}

async function bodyText(page, retries = 5) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await page.evaluate(() => document.body ? document.body.innerText : '');
    } catch (error) {
      lastError = error;
      if (!isNavigationContextError(error) || attempt === retries) {
        throw error;
      }
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => { });
      await sleep(700);
    }
  }
  throw lastError;
}

async function waitForBodyText(page, pattern, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const text = await bodyText(page);
    if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) {
      return text;
    }
    await sleep(500);
  }
  throw new Error(`等待页面内容超时：${pattern}`);
}

async function waitForFlashSaleListReady(page, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const text = await bodyText(page);
    if (isFlashSaleListReadyText(text, page.url())) {
      return text;
    }
    await sleep(500);
  }
  throw new Error('秒杀活动页面加载超时。请确认页面已正常进入“限时秒杀”列表。');
}

async function clickText(page, text, options = {}) {
  const exact = options.exact !== false;
  const selector = options.selector || 'button, label, span, div, a, li';
  const index = options.index || 0;
  const clicked = await page.evaluate(({ text, exact, selector, index }) => {
    const elements = Array.from(document.querySelectorAll(selector));
    const matches = elements.filter((element) => {
      const value = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!value) return false;
      return exact ? value === text : value.includes(text);
    }).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    const element = matches[index] || matches[0];
    if (!element) return false;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
    return true;
  }, { text, exact, selector, index });

  if (!clicked) {
    throw new Error(`没有找到可点击文本：${text}`);
  }
  await sleep(options.afterClickMs || 500);
}

async function tryClickText(page, text, options = {}) {
  try {
    await clickText(page, text, options);
    return true;
  } catch (error) {
    return false;
  }
}

async function setInputByPlaceholder(page, placeholder, value) {
  const ok = await page.evaluate(({ placeholder, value }) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const input = inputs.find((item) => String(item.placeholder || '').includes(placeholder));
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { placeholder, value });
  return ok;
}

async function setInputByHints(page, hints = [], value, options = {}) {
  const ok = await page.evaluate(({ hints, value, type }) => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && !element.disabled
        && !element.readOnly;
    };
    const getLabelText = (input) => {
      const pieces = [
        input.placeholder,
        input.getAttribute('aria-label'),
        input.getAttribute('title'),
        input.name,
        input.id,
      ];
      const parent = input.closest('label, .el-form-item, .ant-form-item, .form-item, div');
      if (parent) {
        pieces.push(parent.innerText || parent.textContent || '');
      }
      return pieces.join(' ').replace(/\s+/g, ' ').trim();
    };

    const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const exactType = type ? inputs.find((input) => String(input.type || '').toLowerCase() === type) : null;
    const matched = inputs.find((input) => {
      if (type && String(input.type || '').toLowerCase() === type) return true;
      const text = getLabelText(input);
      return hints.some((hint) => text.includes(hint));
    });
    const input = exactType || matched;
    if (!input) return false;
    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { hints, value, type: options.type || '' });
  return ok;
}

async function setLoginInput(page, kind, value) {
  if (kind === 'phone') {
    if (await setInputByPlaceholder(page, '手机号/子账号/邮箱', value)) return;
    if (await setInputByHints(page, ['手机号', '子账号', '邮箱', '账号', '手机'], value)) return;
    throw new Error('没有找到账号输入框。请确认当前页面已切换到账号密码登录。');
  }

  if (await setInputByPlaceholder(page, '密码', value)) return;
  if (await setInputByHints(page, ['密码'], value, { type: 'password' })) return;
  throw new Error('没有找到密码输入框。请确认当前页面已切换到账号密码登录。');
}

async function getLoginCaptchaState(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const fieldText = (input) => {
      const pieces = [
        input.placeholder,
        input.getAttribute('aria-label'),
        input.getAttribute('title'),
        input.name,
        input.id,
      ];
      const parent = input.closest('label, .el-form-item, .ant-form-item, .form-item');
      if (parent) pieces.push(parent.innerText || parent.textContent || '');
      return pieces.join(' ').replace(/\s+/g, ' ');
    };
    const captchaInput = Array.from(document.querySelectorAll('input'))
      .filter(isVisible)
      .find((input) => /验证码|校验码|captcha|verify|verification/i.test(fieldText(input)));
    const captchaImage = Array.from(document.querySelectorAll('img, canvas'))
      .filter(isVisible)
      .find((element) => {
        const text = [
          element.getAttribute('src'),
          element.getAttribute('alt'),
          element.getAttribute('title'),
          element.className,
          element.id,
        ].join(' ');
        return /验证码|校验码|captcha|verify|code/i.test(text);
      });
    const text = document.body ? document.body.innerText || document.body.textContent || '' : '';
    return {
      hasCaptcha: Boolean(captchaInput || captchaImage || /图形验证码|请输入验证码|验证码错误|验证码不能为空/.test(text)),
      hasInput: Boolean(captchaInput),
      hasImage: Boolean(captchaImage),
    };
  });
}

async function captureLoginCaptcha(page, captchaId) {
  const dir = getCaptchaDir();
  fs.mkdirSync(dir, { recursive: true });
  const imageFile = `captcha-${getRunId()}-${safeFilePart(captchaId)}.png`;
  const imagePath = path.join(dir, imageFile);
  await ensureLargeBrowserViewport(page);
  await sleep(1200);


  const clip = await page.evaluate(() => {



    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const normalizedRect = (rect) => ({
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(window.innerWidth, rect.right),
      bottom: Math.min(window.innerHeight, rect.bottom),
      width: Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left)),
      height: Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top)),
    });
    const textFor = (element) => [
      element.placeholder,
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('src'),
      element.getAttribute?.('alt'),
      element.name,
      element.id,
      element.className,
    ].join(' ');
    const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const captchaInput = inputs.find((input) => /验证码|校验码|captcha|verify|verification/i.test(textFor(input)))
      || inputs.find((input) => /验证码|校验码/.test((input.closest('label, .el-form-item, .ant-form-item, .form-item, div') || {}).innerText || ''))
      || null;
    const inputRect = captchaInput ? normalizedRect(captchaInput.getBoundingClientRect()) : null;
    const form = captchaInput
      ? captchaInput.closest('form, .el-form, .ant-form, .login, .login-form, .form, .el-form-item, [class*=login], [class*=Login]')
      : null;
    const formRect = form && isVisible(form) ? normalizedRect(form.getBoundingClientRect()) : null;
    const visuals = Array.from(document.querySelectorAll('img, canvas'))
      .filter(isVisible)
      .map((element) => {
        const rect = normalizedRect(element.getBoundingClientRect());
        const text = textFor(element);
        let score = /验证码|校验码|captcha|verify|code/i.test(text) ? 1000 : 0;
        if (rect.width >= 70 && rect.width <= 260 && rect.height >= 24 && rect.height <= 100) {
          score += 160;
        }
        if (inputRect) {
          const centerY = rect.top + rect.height / 2;
          const inputCenterY = inputRect.top + inputRect.height / 2;
          score += Math.max(0, 240 - Math.abs(centerY - inputCenterY));
          score += rect.left >= inputRect.left + inputRect.width * 0.45 ? 220 : 0;
          score += rect.top <= inputRect.bottom + 80 && rect.bottom >= inputRect.top - 80 ? 80 : 0;
          score += Math.abs((rect.left + rect.width / 2) - (inputRect.left + inputRect.width / 2)) < 520 ? 40 : 0;
        }
        if (formRect
          && rect.left >= formRect.left - 2
          && rect.right <= formRect.right + 2
          && rect.top >= formRect.top - 2
          && rect.bottom <= formRect.bottom + 2) {
          score += 120;
        }
        return { element, rect, score };
      })
      .sort((a, b) => b.score - a.score);

    const captchaVisual = visuals
      .filter((item) => item.score > 0)
      .filter((item) => !inputRect || (
        item.rect.top <= inputRect.bottom + 80
        && item.rect.bottom >= inputRect.top - 80
        && item.rect.left >= inputRect.left + inputRect.width * 0.35
        && item.rect.right <= inputRect.right + 260
      ))
      .find((item) => item.rect.width >= 50 && item.rect.height >= 20);

    let targetRect = null;
    if (captchaVisual) {
      targetRect = captchaVisual.rect;
    } else if (inputRect) {
      const fallbackWidth = Math.max(90, Math.min(180, inputRect.width * 0.38));
      targetRect = {
        left: Math.max(0, inputRect.right - fallbackWidth),
        top: inputRect.top,
        right: inputRect.right,
        bottom: inputRect.bottom,
        width: fallbackWidth,
        height: inputRect.height,
      };
    }
    if (!targetRect) return null;

    const padding = 4;
    const x = Math.max(0, Math.floor(targetRect.left - padding));
    const y = Math.max(0, Math.floor(targetRect.top - padding));
    const width = Math.min(window.innerWidth - x, Math.max(80, Math.ceil(targetRect.width + padding * 2)));
    const height = Math.min(window.innerHeight - y, Math.max(28, Math.ceil(targetRect.height + padding * 2)));
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  });

  try {
    if (clip) {
      await page.screenshot({ path: imagePath, clip });
    } else {
      await page.screenshot({ path: imagePath, fullPage: false });
    }
  } catch (error) {
    await page.screenshot({ path: imagePath, fullPage: false });
  }

  return imageFile;
}

async function waitForCaptchaCode(captchaId, timeout = LOGIN_TIMEOUT) {
  const responseFile = captchaResponsePath(captchaId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (fs.existsSync(responseFile)) {
      const payload = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      fs.rmSync(responseFile, { force: true });
      const code = String(payload.code || '').trim();
      if (!code) {
        throw new Error('网页提交的验证码为空。');
      }
      return code;
    }
    await sleep(1000);
  }
  throw new Error('等待网页输入验证码超时。');
}

async function requestCaptchaFromWeb(page, accountLabel) {
  const captchaId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const responseFile = captchaResponsePath(captchaId);
  fs.rmSync(responseFile, { force: true });
  const imageFile = await captureLoginCaptcha(page, captchaId);

  const createdAt = new Date().toISOString();
  console.log('验证码图片文件名:', imageFile);
  console.log('验证码图片本地路径:', path.join(getCaptchaDir(), imageFile));

  fs.writeFileSync(path.join(getCaptchaDir(), `captcha-request-${safeFilePart(captchaId)}.json`), JSON.stringify({
    id: captchaId,
    runId: getRunId(),
    accountLabel,
    imageFile,
    createdAt,
  }), 'utf8');

  emitProgress({
    phase: 'captcha',
    captcha: {
      id: captchaId,
      accountLabel,
      imageFile,
      createdAt,
      message: `妙手账号 ${accountLabel || '当前账号'} 需要输入验证码。`,
    },
  });
  log('妙手登录需要验证码，已发送到网页，请在网页输入验证码。');
  const code = await waitForCaptchaCode(captchaId);
  emitProgress({ phase: 'login', captchaClear: true });
  return code;
}

async function setCaptchaInput(page, value) {
  const ok = await page.evaluate((value) => {
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && !element.disabled
        && !element.readOnly;
    };
    const textFor = (input) => {
      const pieces = [
        input.placeholder,
        input.getAttribute('aria-label'),
        input.getAttribute('title'),
        input.name,
        input.id,
      ];
      const parent = input.closest('label, .el-form-item, .ant-form-item, .form-item');
      if (parent) pieces.push(parent.innerText || parent.textContent || '');
      return pieces.join(' ').replace(/\s+/g, ' ');
    };
    const input = Array.from(document.querySelectorAll('input'))
      .filter(isVisible)
      .find((item) => /验证码|校验码|captcha|verify|verification/i.test(textFor(item)));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, value);
  if (!ok) {
    throw new Error('没有找到验证码输入框。');
  }
}

async function switchToPasswordLogin(page) {
  const candidates = [
    '账号登录',
    '密码登录',
    '账号密码登录',
    '手机号登录',
    '其他方式登录',
  ];
  for (const text of candidates) {
    const clicked = await tryClickText(page, text, { exact: false, afterClickMs: 800 });
    if (clicked) {
      const hasPhoneInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.some((input) => /手机号|子账号|邮箱|账号|手机/.test([
          input.placeholder,
          input.getAttribute('aria-label'),
          input.getAttribute('title'),
          input.name,
          input.id,
        ].join(' ')));
      });
      if (hasPhoneInput) return true;
    }
  }
  return false;
}

async function waitForLoginCheckpoint(page, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  let flashSaleShellSince = 0;

  while (Date.now() - startedAt < timeout) {
    const text = await bodyText(page);
    const url = page.url();
    if (isFlashSaleListReadyText(text, url)) {
      return { state: 'logged-in-ready', text, url };
    }
    if (isFlashSaleShellText(text, url)) {
      if (!flashSaleShellSince) {
        flashSaleShellSince = Date.now();
      }
      if (Date.now() - flashSaleShellSince > 4000) {
        return { state: 'logged-in-loading', text, url };
      }
    } else {
      flashSaleShellSince = 0;
    }
    if (hasLoginCueText(text)) {
      return { state: 'login', text, url };
    }
    await sleep(500);
  }

  return { state: 'unknown', text: await bodyText(page), url: page.url() };
}

async function ensureLoggedIn(page) {
  await page.goto(FLASH_SALE_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
  const checkpoint = await waitForLoginCheckpoint(page, DEFAULT_TIMEOUT);

  let text = checkpoint.text;
  if (checkpoint.state === 'logged-in-ready') {
    log('妙手账号已登录，已进入秒杀活动页面。');
    return;
  }
  if (checkpoint.state === 'logged-in-loading') {
    log('妙手账号已登录，秒杀活动页面正在加载。');
    return;
  }

  const phone = process.env.MIAOSHOU_LOGIN_PHONE || process.env.MIAOSHOU_ACCOUNT_LABEL || '';
  const password = process.env.MIAOSHOU_LOGIN_PASSWORD || '';
  if (!phone || !password) {
    throw new Error('需要先配置妙手登录手机号和密码。');
  }

  if (checkpoint.state !== 'login') {
    await page.goto('https://erp.91miaoshou.com/?redirect=%2Ftiktok%2Fmarketing%2FflashSale', {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    });
    const nextCheckpoint = await waitForLoginCheckpoint(page, DEFAULT_TIMEOUT);
    text = nextCheckpoint.text;
    if (nextCheckpoint.state === 'logged-in-ready' || nextCheckpoint.state === 'logged-in-loading') {
      log('妙手账号已登录，已进入秒杀活动页面。');
      return;
    }
  }

  await switchToPasswordLogin(page);
  await setLoginInput(page, 'phone', phone);
  await setLoginInput(page, 'password', password);
  log(`已填写妙手账号 ${phone}。如果页面要求验证码，会在网页中显示并等待输入。`);
  emitProgress({
    phase: 'login',
    phaseLabel: '等待登录',
    completed: 0,
    total: 1,
    totalCount: 1,
    overallPercent: 0,
  });

  let captchaAttempts = 0;
  let lastCaptchaSubmittedAt = 0;
  const fillCaptchaIfPresent = async () => {
    const captchaState = await getLoginCaptchaState(page);
    if (!captchaState.hasCaptcha) {
      return false;
    }
    if (lastCaptchaSubmittedAt && Date.now() - lastCaptchaSubmittedAt < 8000) {
      return false;
    }
    captchaAttempts += 1;
    if (captchaAttempts > 5) {
      throw new Error('验证码连续处理次数过多，请检查登录页面。');
    }
    const code = await requestCaptchaFromWeb(page, phone);
    await setCaptchaInput(page, code);
    lastCaptchaSubmittedAt = Date.now();
    log('已从网页收到验证码并填写到妙手登录页。');
    return true;
  };

  await fillCaptchaIfPresent();

  try {
    await clickText(page, '立即登录', { selector: 'button', exact: true, afterClickMs: 1000 });
  } catch (error) {
    log('登录按钮暂时不可点，继续等待页面状态。');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < LOGIN_TIMEOUT) {
    text = await bodyText(page);
    const url = page.url();
    if (isFlashSaleListReadyText(text, url) || isFlashSaleShellText(text, url)) {
      log('妙手登录已完成。');
      return;
    }
    if (hasLoginCueText(text) && await fillCaptchaIfPresent()) {
      await clickText(page, '立即登录', { selector: 'button', exact: true, afterClickMs: 1200 }).catch(() => { });
      continue;
    }
    await sleep(1500);
  }

  throw new Error('等待妙手登录超时。请确认网页验证码已输入并登录成功。');
}

async function clickRunningTab(page, options = {}) {
  const quiet = Boolean(options.quiet);
  if (!quiet) {
    log('准备切换到“进行中”秒杀活动列表。');
  }
  let lastState = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    lastState = await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
      const isVisible = (element) => {
        if (!element || !element.getClientRects().length) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const activeLike = (element) => {
        let current = element;
        for (let depth = 0; current && current !== document.body && depth < 7; depth += 1) {
          const className = String(current.className || '').toLowerCase();
          const ariaSelected = String(current.getAttribute?.('aria-selected') || '').toLowerCase();
          const ariaChecked = String(current.getAttribute?.('aria-checked') || '').toLowerCase();
          if (ariaSelected === 'true' || ariaChecked === 'true') return true;
          if (/active|selected|checked|current|is-active|is-checked/.test(className)) return true;
          current = current.parentElement;
        }
        return false;
      };
      const clickElement = (element) => {
        const target = element.closest?.('[role=tab], label, li, button, .el-tabs__item, .ant-tabs-tab, .semi-tabs-tab, .arco-tabs-header-title')
          || element;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          }));
        }
      };

      const elements = Array.from(document.querySelectorAll('[role=tab], label, button, li, span, div'))
        .filter(isVisible);
      const tab = elements.find((item) => /^进行中(?:\(\d+\))?$/.test(normalize(item.innerText || item.textContent || '')));
      if (!tab) {
        return { found: false, active: false, label: '', count: null };
      }

      const label = (tab.innerText || tab.textContent || '').replace(/\s+/g, ' ').trim();
      const countMatch = normalize(label).match(/进行中\((\d+)\)/);
      if (!activeLike(tab)) {
        clickElement(tab);
      }
      return {
        found: true,
        active: activeLike(tab),
        label,
        count: countMatch ? Number.parseInt(countMatch[1], 10) : null,
      };
    });

    if (!lastState.found) {
      throw new Error('没有找到“进行中”筛选。');
    }

    await sleep(1200);
    const confirmed = await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
      const isVisible = (element) => {
        if (!element || !element.getClientRects().length) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const activeLike = (element) => {
        let current = element;
        for (let depth = 0; current && current !== document.body && depth < 7; depth += 1) {
          const className = String(current.className || '').toLowerCase();
          const ariaSelected = String(current.getAttribute?.('aria-selected') || '').toLowerCase();
          const ariaChecked = String(current.getAttribute?.('aria-checked') || '').toLowerCase();
          if (ariaSelected === 'true' || ariaChecked === 'true') return true;
          if (/active|selected|checked|current|is-active|is-checked/.test(className)) return true;
          current = current.parentElement;
        }
        return false;
      };
      const elements = Array.from(document.querySelectorAll('[role=tab], label, button, li, span, div'))
        .filter(isVisible);
      const tab = elements.find((item) => /^进行中(?:\(\d+\))?$/.test(normalize(item.innerText || item.textContent || '')));
      if (!tab) return { active: false, label: '' };
      return {
        active: activeLike(tab),
        label: (tab.innerText || tab.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });

    if (confirmed.active) {
      if (!quiet) {
        log(`已切换到“进行中”列表${lastState.count ? `（页面显示 ${lastState.count} 个）` : ''}。`);
      }
      return lastState;
    }
  }

  throw new Error(`点击“进行中”后没有确认切换成功，最后识别到：${lastState && lastState.label ? lastState.label : '未知'}`);
}

async function selectActivityListPageSize100(page) {
  log('准备将秒杀活动列表分页切换为 100 条/页。');

  const readCurrentPageSize = () => page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const elements = Array.from(document.querySelectorAll('button, span, div, input'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter((element) => !element.closest('[class*=dropdown], [class*=Dropdown], [class*=popper], [class*=Popper], [class*=option], [class*=Option]'))
      .filter(isVisible);
    const pageSizeElements = elements
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || element.value || '');
        const match = text.match(/^(\d+)条\/页$/);
        if (!match) return null;
        const rect = element.getBoundingClientRect();
        return {
          element,
          value: Number.parseInt(match[1], 10),
          text,
          bottom: rect.bottom,
          right: rect.right,
        };
      })
      .filter(Boolean);
    const current = pageSizeElements
      .sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0] || null;

    return current ? { found: true, value: current.value, text: current.text } : { found: false, value: null, text: '' };
  });

  const getPageSizeTriggerPoint = () => page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const entries = Array.from(document.querySelectorAll('button, span, div, input'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter((element) => !element.closest('[class*=dropdown], [class*=Dropdown], [class*=popper], [class*=Popper], [class*=option], [class*=Option]'))
      .filter(isVisible)
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || element.value || '');
        const match = text.match(/^(\d+)条\/页$/);
        if (!match) return null;
        const rect = element.getBoundingClientRect();
        return { element, value: Number.parseInt(match[1], 10), bottom: rect.bottom, right: rect.right };
      })
      .filter(Boolean)
      .sort((a, b) => b.bottom - a.bottom || b.right - a.right);

    const current = entries[0];
    if (!current) return null;
    const trigger = current.element.closest?.('.el-select, .el-select__wrapper, .ant-select, .semi-select, .arco-select, .jx-select, [class*=select], [class*=Select], [role=button], button')
      || current.element.parentElement
      || current.element;
    const rect = trigger.getBoundingClientRect();
    trigger.scrollIntoView({ block: 'center', inline: 'center' });
    return {
      x: Math.max(rect.left + 4, rect.right - 16),
      y: rect.top + rect.height / 2,
      value: current.value,
    };
  });

  const getPageSizeOptionPoint = () => page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const option = Array.from(document.querySelectorAll('[role=option], li, span, div'))
      .filter(isVisible)
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || '');
        const rect = element.getBoundingClientRect();
        return { element, text, rect };
      })
      .filter((entry) => entry.text === '100条/页')
      .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right)[0];
    if (!option) return null;
    const target = option.element.closest?.('[role=option], li, .el-select-dropdown__item, .ant-select-item, .semi-select-option, .arco-select-option')
      || option.element;
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readCurrentPageSize();
    if (current.value === 100) {
      log('已确认秒杀活动列表当前为 100 条/页。');
      return true;
    }

    const triggerPoint = await getPageSizeTriggerPoint();
    if (!triggerPoint) {
      await sleep(800);
      continue;
    }
    log(`当前活动列表分页为 ${triggerPoint.value} 条/页，点击右下角分页器。`);
    await page.mouse.click(triggerPoint.x, triggerPoint.y);
    await sleep(800);

    let optionPoint = null;
    for (let optionAttempt = 0; optionAttempt < 5; optionAttempt += 1) {
      optionPoint = await getPageSizeOptionPoint();
      if (optionPoint) break;
      await page.mouse.wheel({ deltaY: 160 });
      await sleep(300);
    }
    if (!optionPoint) {
      await sleep(800);
      continue;
    }
    await page.mouse.click(optionPoint.x, optionPoint.y);
    await sleep(2500);
  }

  const finalState = await readCurrentPageSize();
  log(`秒杀活动列表分页未切换到 100 条/页，当前识别为：${finalState.text || '未识别'}；将继续处理当前可见活动。`);
  return false;
}

async function findFlashSaleListPage(browser) {
  const pages = await browser.pages();
  for (const page of pages) {
    if (page.isClosed()) {
      continue;
    }
    const url = page.url();
    if (!url.includes('/tiktok/marketing/flashSale') || url.includes('/tiktok/marketing/flashSale/create')) {
      continue;
    }
    const text = await bodyText(page, 1).catch(() => '');
    if (isFlashSaleListReadyText(text, url) || isFlashSaleShellText(text, url)) {
      return page;
    }
  }
  return null;
}

async function ensureActivityListPage(browser, listPage, options = {}) {
  const quiet = Boolean(options.quiet);
  let page = listPage && !listPage.isClosed() ? listPage : null;
  if (!page) {
    page = await findFlashSaleListPage(browser);
  }
  if (!page) {
    page = await browser.newPage();
  }

  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
  await page.bringToFront().catch(() => { });
  await ensureLargeBrowserViewport(page);

  let text = await bodyText(page, 1).catch(() => '');
  let url = page.url();
  let navigated = false;
  const isDetailPage = url.includes('/tiktok/marketing/flashSale/create') || text.includes('管理活动产品');
  const isListPage = isFlashSaleListReadyText(text, url) || isFlashSaleShellText(text, url);
  if (isDetailPage || !isListPage) {
    if (!quiet) {
      log('当前不在秒杀活动列表页，返回最开始的秒杀活动列表。');
    }
    await page.goto(FLASH_SALE_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    navigated = true;
  }

  await waitForFlashSaleListReady(page, DEFAULT_TIMEOUT);
  await clickRunningTab(page, { quiet: true });
  if (navigated || options.ensurePageSize) {
    await selectActivityListPageSize100(page);
  }
  if (options.resetScroll !== false) {
    await resetActivityListScroll(page);
  }
  return page;
}

async function readActivityRows(page) {
  await waitForBodyText(page, '管理产品', DEFAULT_TIMEOUT);
  return page.evaluate((selectors) => Array.from(document.querySelectorAll(selectors.activityRows))
    .map((element, index) => ({
      index,
      text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => row.text && row.text.includes('管理产品')), FLASH_SELECTORS);
}

function getActivityCandidates(rows, processedActivityKeys) {
  return rows
    .map((row) => ({ ...row, activity: parseActivityFromRow(row.text) }))
    .filter((row) => row.text.includes('进行中') && !row.text.includes('未开始'))
    .filter((row) => buildActivityKeys(row.activity).length > 0)
    .filter((row) => !hasProcessedActivity(processedActivityKeys, row.activity));
}

function getUniqueActivityRows(rows, seenActivityKeys) {
  const activities = [];
  for (const row of rows) {
    if (!row.text.includes('进行中') || row.text.includes('未开始')) {
      continue;
    }
    const activity = parseActivityFromRow(row.text);
    const keys = buildActivityKeys(activity);
    if (keys.length === 0 || keys.some((key) => seenActivityKeys.has(key))) {
      continue;
    }
    keys.forEach((key) => seenActivityKeys.add(key));
    activities.push({ activity, text: row.text });
  }
  return activities;
}

async function resetActivityListScroll(page) {
  await page.evaluate((selectors) => {
    const rows = Array.from(document.querySelectorAll(selectors.activityRows))
      .filter((element) => (element.innerText || element.textContent || '').includes('管理产品'));
    const isScrollable = (element) => element
      && element.scrollHeight > element.clientHeight + 20
      && window.getComputedStyle(element).overflowY !== 'hidden';
    let scroller = null;

    if (rows[0]) {
      let current = rows[0].parentElement;
      for (let depth = 0; current && current !== document.body && depth < 12; depth += 1) {
        if (isScrollable(current)) {
          scroller = current;
          break;
        }
        current = current.parentElement;
      }
    }

    if (!scroller) {
      scroller = document.scrollingElement || document.documentElement;
    }
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
  }, FLASH_SELECTORS);
  await sleep(1200);
}

async function scrollActivityListToBottom(page) {
  const state = await page.evaluate((selectors) => {
    const rows = Array.from(document.querySelectorAll(selectors.activityRows))
      .filter((element) => (element.innerText || element.textContent || '').includes('管理产品'));
    const isScrollable = (element) => element
      && element.scrollHeight > element.clientHeight + 20
      && window.getComputedStyle(element).overflowY !== 'hidden';
    let scroller = null;

    if (rows[0]) {
      let current = rows[0].parentElement;
      for (let depth = 0; current && current !== document.body && depth < 12; depth += 1) {
        if (isScrollable(current)) {
          scroller = current;
          break;
        }
        current = current.parentElement;
      }
    }

    if (!scroller) {
      scroller = document.scrollingElement || document.documentElement;
    }

    const before = scroller.scrollTop;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = maxScrollTop;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));

    return {
      before,
      after: scroller.scrollTop,
      maxScrollTop,
      rowCount: rows.length,
      moved: Math.abs(scroller.scrollTop - before) > 5,
      atBottom: scroller.scrollTop >= maxScrollTop - 5,
    };
  }, FLASH_SELECTORS);
  await sleep(1500);
  return state;
}

async function scrollActivityListForMoreRows(page) {
  const state = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
      .filter((element) => (element.innerText || element.textContent || '').includes('管理产品'));
    const isScrollable = (element) => element
      && element.scrollHeight > element.clientHeight + 20
      && window.getComputedStyle(element).overflowY !== 'hidden';
    let scroller = null;

    if (rows[0]) {
      let current = rows[0].parentElement;
      for (let depth = 0; current && current !== document.body && depth < 12; depth += 1) {
        if (isScrollable(current)) {
          scroller = current;
          break;
        }
        current = current.parentElement;
      }
    }

    if (!scroller) {
      scroller = document.scrollingElement || document.documentElement;
    }

    const before = scroller.scrollTop;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const step = Math.max(260, Math.floor(scroller.clientHeight * 0.65));
    scroller.scrollTop = Math.min(maxScrollTop, before + step);
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));

    return {
      before,
      after: scroller.scrollTop,
      maxScrollTop,
      rowCount: rows.length,
      moved: scroller.scrollTop > before + 5,
      atBottom: scroller.scrollTop >= maxScrollTop - 5,
    };
  });
  await sleep(1500);
  return state;
}

async function getVisibleActivityListSignature(page) {
  const rows = await readActivityRows(page).catch(() => []);
  return rows.map((row) => row.text).join('|');
}

async function clickNextActivityListPage(page) {
  const beforeSignature = await getVisibleActivityListSignature(page);
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const isDisabled = (element) => {
      if (!element) return true;
      const disabledText = `${element.getAttribute?.('aria-disabled') || ''} ${element.getAttribute?.('disabled') || ''} ${element.className || ''}`;
      return element.disabled === true || /true|disabled|is-disabled/.test(String(disabledText).toLowerCase());
    };
    const entries = Array.from(document.querySelectorAll('button, [role=button], li, a, span, div'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter(isVisible)
      .map((element) => {
        const target = element.closest?.('button, [role=button], li, a, .ant-pagination-next, .el-pagination .btn-next, .btn-next, [class*=next], [class*=Next]')
          || element;
        const marker = [
          normalize(element.innerText || element.textContent || ''),
          normalize(element.getAttribute?.('aria-label') || ''),
          normalize(element.getAttribute?.('title') || ''),
          String(element.className || ''),
          String(target.className || ''),
        ].join(' ');
        const rect = target.getBoundingClientRect();
        return { element: target, marker, rect };
      })
      .filter((entry) => /下一页|next|right|chevron-right|arrow-right|pager-next|pagination-next|btn-next/i.test(entry.marker))
      .filter((entry) => !isDisabled(entry.element))
      .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right);

    const next = entries[0];
    if (!next) return false;
    next.element.scrollIntoView({ block: 'center', inline: 'center' });
    next.element.click();
    return true;
  });

  if (!clicked) {
    return false;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(800);
    const currentSignature = await getVisibleActivityListSignature(page);
    if (currentSignature && currentSignature !== beforeSignature) {
      return true;
    }
  }

  return true;
}

async function collectRunningActivityQueue(page, expectedCount = null, options = {}) {
  const allowPagination = Boolean(options.allowPagination);
  const seenActivityKeys = new Set();
  const queue = [];
  let pageNumber = 1;

  await resetActivityListScroll(page);

  for (let pageAttempt = 0; pageAttempt < 50; pageAttempt += 1) {
    let lastCollectedCount = queue.length;
    let stagnantCount = 0;

    for (let attempt = 0; attempt < 160; attempt += 1) {
      const rows = await readActivityRows(page);
      const newActivities = getUniqueActivityRows(rows, seenActivityKeys);
      if (newActivities.length > 0) {
        queue.push(...newActivities);
        log(`已收集进行中的秒杀活动：${queue.length} 个。`);
        if (Number.isFinite(expectedCount) && expectedCount > 0 && queue.length >= expectedCount) {
          break;
        }
      }

      const scrollState = await scrollActivityListForMoreRows(page);
      if (!scrollState.moved && scrollState.atBottom) {
        break;
      }

      if (queue.length === lastCollectedCount) {
        stagnantCount += 1;
        if (stagnantCount >= 5) {
          break;
        }
      } else {
        stagnantCount = 0;
        lastCollectedCount = queue.length;
      }
    }

    if (Number.isFinite(expectedCount) && expectedCount > 0 && queue.length >= expectedCount) {
      break;
    }

    if (!allowPagination) {
      break;
    }

    const movedToNextPage = await clickNextActivityListPage(page);
    if (!movedToNextPage) {
      break;
    }
    pageNumber += 1;
    log(`已切换到秒杀活动列表第 ${pageNumber} 页，继续收集活动ID。`);
    await resetActivityListScroll(page);
  }

  if (Number.isFinite(expectedCount) && expectedCount > 0 && queue.length < expectedCount) {
    log(`页面显示进行中 ${expectedCount} 个，但滚动到底只收集到 ${queue.length} 个，请留意是否有分页或列表加载限制。`);
  }
  log(`进行中活动完整队列收集完成，共 ${queue.length} 个。`);
  await resetActivityListScroll(page);
  return queue;
}

async function findNextActivityCandidate(page, processedActivityKeys) {
  let lastVisibleSignature = '';
  let stagnantCount = 0;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await readActivityRows(page);
    const candidates = getActivityCandidates(rows, processedActivityKeys);
    if (candidates.length > 0) {
      if (attempt > 0) {
        log(`已向下加载活动列表，找到下一个未处理活动：${candidates[0].activity.title}。`);
      }
      return candidates[0];
    }

    const visibleSignature = rows
      .map((row) => buildActivityKey(parseActivityFromRow(row.text)))
      .filter(Boolean)
      .join('|');

    log('当前可见活动都已处理过，向下加载更多进行中的活动。');
    const scrollState = await scrollActivityListForMoreRows(page);
    if (!scrollState.moved && scrollState.atBottom) {
      return null;
    }
    if (!scrollState.moved && visibleSignature === lastVisibleSignature) {
      stagnantCount += 1;
      if (stagnantCount >= 3) {
        return null;
      }
    } else {
      stagnantCount = 0;
    }
    lastVisibleSignature = visibleSignature;
  }

  return null;
}

async function clickManageProductByRowIndex(page, rowIndex) {
  const clicked = await page.evaluate((rowIndex) => {
    const rows = Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
      .filter((element) => (element.innerText || element.textContent || '').includes('管理产品'));
    const row = rows[rowIndex];
    if (!row) return false;
    const buttons = Array.from(row.querySelectorAll('button, span, div'));
    const button = buttons.find((element) => (element.innerText || element.textContent || '').trim() === '管理产品');
    if (!button) return false;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  }, rowIndex);
  if (!clicked) {
    throw new Error('没有找到该活动的“管理产品”按钮。');
  }
}

async function searchActivityById(page, activityId) {
  const id = String(activityId || '').trim();
  if (!id) return false;

  log(`按活动ID搜索活动：${id}。`);
  const filled = await page.evaluate((id) => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && !element.disabled
        && !element.readOnly;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const activity = /活动\s*ID|活动ID|activity\s*id/i;
    const fieldContainerSelector = [
      'label',
      '.el-form-item',
      '.ant-form-item',
      '.semi-form-field',
      '.arco-form-item',
      '.form-item',
      '[class*="form-item"]',
      '[class*="FormItem"]',
    ].join(',');
    const isShopNameSearchFieldText = (text) => {
      const normalized = normalize(text);
      if (!normalized) return false;
      return /店铺|店铺名|店铺名称|店铺ID|shop|store|活动名称|activity\s*name/i.test(normalized);
    };
    const findClosestFieldContainer = (element) => {
      const container = element && element.closest
        ? element.closest(fieldContainerSelector)
        : null;
      if (!container || container === document.body) {
        return null;
      }
      return container;
    };
    const ownTextFor = (input) => normalize([
      input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute('title'),
      input.name,
      input.id,
    ].join(' '));
    const textFor = (input) => {
      const pieces = [ownTextFor(input)];
      const fieldContainer = findClosestFieldContainer(input);
      if (fieldContainer) {
        pieces.push(fieldContainer.innerText || fieldContainer.textContent || '');
      }
      return normalize(pieces.join(' '));
    };
    function findActivityIdSearchInput(inputs) {
      const directInput = inputs.find((input) => {
        const ownText = ownTextFor(input);
        const text = textFor(input);
        return activity.test(ownText)
          || (activity.test(text) && !isShopNameSearchFieldText(text));
      });
      if (directInput) {
        return directInput;
      }

      const labels = Array.from(document.querySelectorAll('label, span, div'))
        .filter(isVisible)
        .map((element) => ({
          element,
          text: normalize(element.innerText || element.textContent || ''),
          rect: element.getBoundingClientRect(),
        }))
        .filter((item) => activity.test(item.text) && item.text.length <= 80);

      for (const label of labels) {
        const fieldContainer = findClosestFieldContainer(label.element);
        const containerText = normalize(fieldContainer && (fieldContainer.innerText || fieldContainer.textContent || ''));
        if (!fieldContainer || !activity.test(containerText) || isShopNameSearchFieldText(containerText)) {
          continue;
        }
        const nestedInput = Array.from(fieldContainer.querySelectorAll('input'))
          .find((input) => inputs.includes(input) && !isShopNameSearchFieldText(ownTextFor(input)));
        if (nestedInput) {
          return nestedInput;
        }
      }

      const inputEntries = inputs.map((input) => ({
        input,
        rect: input.getBoundingClientRect(),
      }));
      let best = null;
      for (const label of labels) {
        for (const entry of inputEntries) {
          const verticalDistance = Math.abs((entry.rect.top + entry.rect.bottom) / 2 - (label.rect.top + label.rect.bottom) / 2);
          const horizontalDistance = Math.max(0, entry.rect.left - label.rect.right);
          const isRightSide = entry.rect.left >= label.rect.left - 20;
          const isNearRow = verticalDistance < 36;
          const ownInputText = ownTextFor(entry.input);
          if (!isRightSide || !isNearRow || isShopNameSearchFieldText(ownInputText)) {
            continue;
          }
          const score = verticalDistance * 4 + horizontalDistance;
          if (!best || score < best.score) {
            best = { input: entry.input, score };
          }
        }
      }
      return best ? best.input : null;
    }
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter((input) => !input.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter(isVisible);
    const input = findActivityIdSearchInput(inputs);
    if (!input) return false;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();
    input.select?.();
    if (setter) setter.call(input, id);
    else input.value = id;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: id }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, id);

  if (!filled) {
    log('没有找到活动ID搜索输入框，改用滚动定位活动。');
    return false;
  }

  const searched = await tryClickText(page, '搜索', { selector: 'button, span, div', exact: true, afterClickMs: 1800 });
  if (!searched) {
    log('没有找到搜索按钮，改用滚动定位活动。');
    return false;
  }

  const waitForSearchResult = async (timeout = DEFAULT_TIMEOUT) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const rows = await readActivityRows(page);
      if (rows.some((row) => row.text.includes(id))) {
        return true;
      }
      await sleep(800);
    }
    return false;
  };

  if (await waitForSearchResult()) {
    return true;
  }

  log(`按活动ID搜索后没有看到活动：${id}。`);
  log('当前活动列表是虚拟列表，先滚动到最底部，再重新搜索一次。');
  await scrollActivityListToBottom(page);

  const searchedAgain = await tryClickText(page, '搜索', { selector: 'button, span, div', exact: true, afterClickMs: 1800 });
  if (!searchedAgain) {
    log('滚动到底部后没有找到搜索按钮，改用滚动定位活动。');
    return false;
  }

  if (await waitForSearchResult()) {
    log(`滚动到底部后重新搜索已找到活动：${id}。`);
    return true;
  }

  log(`滚动到底部后重新搜索仍未看到活动：${id}。`);
  return false;
}

async function clickManageProductByActivity(page, activity) {
  const keys = buildActivityKeys(activity);
  const searched = await searchActivityById(page, activity.id);
  if (searched) {
    const clicked = await page.evaluate((activityId) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
        .filter((element) => (element.innerText || element.textContent || '').includes('管理产品'));
      const row = rows.find((element) => normalize(element.innerText || element.textContent || '').includes(activityId));
      if (!row) return false;
      const buttons = Array.from(row.querySelectorAll('button, span, div'));
      const button = buttons.find((element) => (element.innerText || element.textContent || '').trim() === '管理产品');
      if (!button) return false;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      button.click();
      return true;
    }, String(activity.id || '').trim());

    if (clicked) {
      return;
    }
    log('搜索结果里没有点到“管理产品”，改用滚动定位活动。');
  }

  await resetActivityListScroll(page);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const clicked = await page.evaluate((keys) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
        .filter((element) => (element.innerText || element.textContent || '').includes('管理产品'));
      const row = rows.find((element) => {
        const text = normalize(element.innerText || element.textContent || '');
        return keys.some((key) => key && text.includes(key));
      });
      if (!row) return false;
      const buttons = Array.from(row.querySelectorAll('button, span, div'));
      const button = buttons.find((element) => (element.innerText || element.textContent || '').trim() === '管理产品');
      if (!button) return false;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      button.click();
      return true;
    }, keys);

    if (clicked) {
      return;
    }

    const scrollState = await scrollActivityListForMoreRows(page);
    if (!scrollState.moved && scrollState.atBottom) {
      break;
    }
  }

  throw new Error(`没有在进行中列表里找到活动的“管理产品”按钮：${activity.title || activity.id}`);
}

async function waitForDetailPage(browser, listPage, beforePages = []) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_TIMEOUT) {
    const pages = await browser.pages();
    const created = pages.find((page) => !beforePages.includes(page) && page.url().includes('/tiktok/marketing/flashSale/create'));
    if (created) {
      await created.bringToFront();
      await created.waitForSelector('body', { timeout: DEFAULT_TIMEOUT });
      return created;
    }
    if (listPage.url().includes('/tiktok/marketing/flashSale/create')) {
      return listPage;
    }
    await sleep(500);
  }
  throw new Error('打开管理活动产品页面超时。');
}

async function leaveActivityDetailPage(browser, listPage, detailPage) {
  if (!detailPage || detailPage.isClosed()) {
    return listPage;
  }

  if (detailPage !== listPage) {
    await detailPage.close({ runBeforeUnload: false }).catch(() => { });
    if (listPage && !listPage.isClosed()) {
      await listPage.bringToFront().catch(() => { });
    }
    return listPage;
  }

  await clickText(detailPage, '返回活动列表', { exact: true, afterClickMs: 1500 }).catch(() => { });
  const text = await bodyText(detailPage, 1).catch(() => '');
  const url = detailPage.url();
  if (!isFlashSaleListReadyText(text, url) && !isFlashSaleShellText(text, url)) {
    await detailPage.goto(FLASH_SALE_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => { });
  }
  await waitForFlashSaleListReady(detailPage, DEFAULT_TIMEOUT).catch(() => { });
  return detailPage;
}

async function getVisibleDialogText(page, title) {
  return page.evaluate(({ title, selectors }) => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const dialogs = Array.from(document.querySelectorAll(selectors.dialogs));
    const dialog = dialogs.reverse().find((item) => {
      const text = item.innerText || item.textContent || '';
      return isVisible(item) && text.includes(title);
    });
    return dialog ? dialog.innerText || dialog.textContent || '' : '';
  }, { title, selectors: FLASH_SELECTORS });
}

async function getDialogProductState(page, title) {
  return page.evaluate(({ title, selectors }) => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const dialogs = Array.from(document.querySelectorAll(selectors.dialogs));
    const dialog = dialogs.reverse().find((item) => isVisible(item) && (item.innerText || item.textContent || '').includes(title));
    if (!dialog) {
      return { text: '', rows: [] };
    }
    const rows = Array.from(dialog.querySelectorAll(selectors.productRows))
      .filter(isVisible)
      .map((element, index) => ({
        index,
        text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((row) => row.text && /(?:产品|商品)ID[:：]/.test(row.text));
    return {
      text: dialog.innerText || dialog.textContent || '',
      rows,
    };
  }, { title, selectors: FLASH_SELECTORS });
}

async function getDialogSelectionState(page, title) {
  return page.evaluate(({ title, selectors }) => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const hasCheckedMark = (element) => {
      if (!element) return false;
      if (element.matches?.('input[type="checkbox"]')) return Boolean(element.checked);
      const ariaChecked = String(element.getAttribute?.('aria-checked') || '').toLowerCase();
      const className = String(element.className || '').toLowerCase();
      return ariaChecked === 'true'
        || /\bis-checked\b/.test(className)
        || /\bchecked\b/.test(className)
        || /\bselected\b/.test(className);
    };

    const dialogs = Array.from(document.querySelectorAll(selectors.dialogs));
    const dialog = dialogs.reverse().find((item) => isVisible(item) && (item.innerText || item.textContent || '').includes(title));
    if (!dialog) {
      return { text: '', visibleRows: 0, selectedRows: 0, checkedControls: 0 };
    }

    const text = normalize(dialog.innerText || dialog.textContent || '');
    const rows = Array.from(dialog.querySelectorAll(selectors.productRows))
      .filter(isVisible)
      .filter((row) => /(?:产品|商品)ID[:：]/.test(row.innerText || row.textContent || ''));
    const selectedRows = rows.filter((row) => {
      if (hasCheckedMark(row)) return true;
      return Array.from(row.querySelectorAll(selectors.checkboxControls))
        .some((element) => isVisible(element) && hasCheckedMark(element));
    }).length;
    const checkedControls = Array.from(dialog.querySelectorAll(selectors.checkedControls))
      .filter((element) => isVisible(element))
      .length;

    return {
      text,
      visibleRows: rows.length,
      selectedRows,
      checkedControls,
    };
  }, { title, selectors: FLASH_SELECTORS });
}

async function waitForDialogProductsLoaded(page, title, timeout = 60000) {
  const startedAt = Date.now();
  let lastState = { text: '', rows: [] };

  while (Date.now() - startedAt < timeout) {
    lastState = await getDialogProductState(page, title);
    if (lastState.rows.length > 0 || hasEmptyTableText(lastState.text)) {
      return lastState;
    }
    await sleep(800);
  }

  throw new Error(`${title} 弹窗商品数据加载超时，最后可见产品行：${lastState.rows.length}`);
}

async function waitForDialogSelectedCount(page, title, timeout = 12000) {
  const startedAt = Date.now();
  let lastSelectedCount = null;

  while (Date.now() - startedAt < timeout) {
    const state = await getDialogSelectionState(page, title);
    lastSelectedCount = parseSelectedCount(state.text);
    if (Number.isFinite(lastSelectedCount) && lastSelectedCount > 0) {
      return lastSelectedCount;
    }
    if (state.selectedRows > 0) {
      return state.selectedRows;
    }
    if (state.checkedControls > 1 && state.visibleRows > 0) {
      return state.visibleRows;
    }
    await sleep(800);
  }

  return lastSelectedCount;
}

async function waitForDialogProductStateStable(page, title, timeout = 15000) {
  const startedAt = Date.now();
  let lastCount = null;
  let stableReads = 0;
  let lastState = { text: '', rows: [] };

  while (Date.now() - startedAt < timeout) {
    lastState = await getDialogProductState(page, title);
    const count = parseFirstNumberBefore(lastState.text, '条');
    if (count === lastCount) {
      stableReads += 1;
    } else {
      lastCount = count;
      stableReads = 0;
    }

    if (
      stableReads >= 2
      && (lastState.rows.length > 0 || hasEmptyTableText(lastState.text))
    ) {
      return {
        ...lastState,
        count,
      };
    }

    await sleep(800);
  }

  return {
    ...lastState,
    count: parseFirstNumberBefore(lastState.text, '条'),
  };
}

async function ensureAddProductExclusionFilters(page, title = '添加产品') {
  const result = {
    checked: [],
    clicked: [],
    missing: [],
    unchecked: [],
  };

  for (const labelText of ADD_PRODUCT_EXCLUSION_FILTER_LABELS) {
    let state = { found: false, checked: false, clicked: false };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      state = await page.evaluate(({ title, labelText, selectors }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const classText = (element) => {
          if (!element) return '';
          const className = element.className;
          return typeof className === 'string' ? className : String(className && className.baseVal || '');
        };
        const isVisible = (element) => {
          if (!element || !element.getClientRects().length) return false;
          let current = element;
          while (current && current !== document.body) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
              return false;
            }
            current = current.parentElement;
          }
          return true;
        };
        const dialogs = Array.from(document.querySelectorAll(selectors.dialogs));
        const dialog = dialogs.reverse().find((item) => isVisible(item) && normalize(item.innerText || item.textContent || '').includes(title));
        if (!dialog) {
          return { found: false, checked: false, clicked: false };
        }

        const labelCandidates = Array.from(dialog.querySelectorAll(selectors.labelTextNodes))
          .filter(isVisible)
          .filter((element) => {
            const text = normalize(element.innerText || element.textContent || '');
            return text === labelText || (text.includes(labelText) && text.length <= labelText.length + 8);
          });
        const label = labelCandidates[0] || null;
        if (!label) {
          return { found: false, checked: false, clicked: false };
        }

        const wrapper = label.closest('label')
          || label.closest('.el-checkbox, .ant-checkbox-wrapper, .jx-checkbox, [class*="checkbox"]')
          || label.parentElement
          || label;
        const stateElements = [
          wrapper,
          ...Array.from(wrapper.querySelectorAll(selectors.checkboxControls)),
        ].filter(Boolean);
        const checked = stateElements.some((element) => {
          if (element.matches && element.matches('input[type="checkbox"]')) {
            return Boolean(element.checked);
          }
          const ariaChecked = String(element.getAttribute && element.getAttribute('aria-checked') || '').toLowerCase();
          const cls = classText(element).toLowerCase();
          return ariaChecked === 'true'
            || /\bis-checked\b/.test(cls)
            || /\bchecked\b/.test(cls)
            || /\bselected\b/.test(cls);
        });

        if (checked) {
          return { found: true, checked: true, clicked: false };
        }

        wrapper.scrollIntoView({ block: 'center', inline: 'center' });
        wrapper.click();
        return { found: true, checked: false, clicked: true };
      }, { title, labelText, selectors: FLASH_SELECTORS });

      if (!state.found || state.checked) {
        break;
      }
      if (state.clicked) {
        result.clicked.push(labelText);
        await sleep(1200);
      }
    }

    if (!state.found) {
      result.missing.push(labelText);
      continue;
    }
    if (state.checked) {
      result.checked.push(labelText);
      continue;
    }
    result.unchecked.push(labelText);
  }

  result.clicked = [...new Set(result.clicked)];
  return result;
}

async function clickDialogButton(page, title, buttonText) {
  const clicked = await page.evaluate(({ title, buttonText }) => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog'));
    const dialog = dialogs.reverse().find((item) => isVisible(item) && (item.innerText || item.textContent || '').includes(title));
    if (!dialog) return false;
    const buttons = Array.from(dialog.querySelectorAll('button, span, div')).filter(isVisible);
    const button = buttons.find((item) => (item.innerText || item.textContent || '').trim() === buttonText);
    if (!button) return false;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  }, { title, buttonText });
  if (!clicked) {
    throw new Error(`没有找到弹窗按钮：${title} / ${buttonText}`);
  }
  await sleep(1500);
}

async function waitForDialogGone(page, title, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  let lastText = '';
  while (Date.now() - startedAt < timeout) {
    const text = await getVisibleDialogText(page, title);
    if (!text) return;
    lastText = text;
    await sleep(500);
  }
  const clipped = String(lastText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  throw new Error(`${title} 弹窗没有关闭，已停止避免在弹窗遮挡时继续操作。${clipped ? `弹窗内容：${clipped}` : ''}`);
}

async function getActivityProductListState(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };

    const rows = Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter(isVisible)
      .map((element, index) => ({
        index,
        text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((row) => row.text && /(?:产品|商品)ID[:：]/.test(row.text));

    const text = document.body ? document.body.innerText || document.body.textContent || '' : '';
    const loadingElements = Array.from(document.querySelectorAll('.el-loading-mask, .jx-spin, .ant-spin, [class*=loading], [class*=Loading]'))
      .filter(isVisible);

    return {
      rows,
      text: text.replace(/\s+/g, ' ').trim(),
      hasEmpty: /暂无数据|没有数据/.test(text),
      loading: loadingElements.length > 0 || /加载中|Loading/i.test(text),
    };
  });
}

async function waitForActivityProductListLoaded(page, expectedCount = 0, timeout = 60000) {
  const startedAt = Date.now();
  let lastState = null;
  log('等待当前活动商品列表加载完成，再打开添加产品。');

  while (Date.now() - startedAt < timeout) {
    lastState = await getActivityProductListState(page);
    if (lastState.rows.length > 0) {
      log(`当前活动商品列表已加载 ${lastState.rows.length} 行可见商品。`);
      return lastState;
    }
    if (!expectedCount && lastState.hasEmpty && !lastState.loading) {
      log('当前活动商品列表为空，继续添加产品流程。');
      return lastState;
    }
    await sleep(1000);
  }

  throw new Error(`当前活动商品列表加载超时，已停止避免过早点击添加产品。最后可见商品行：${lastState ? lastState.rows.length : 0}`);
}

async function handleAddProducts(page, activity) {
  await waitForActivityProductListLoaded(page, activity.productCount, 60000);
  await clickText(page, '添加产品', { selector: 'button', exact: true, afterClickMs: 1500 });
  let dialogText = await getVisibleDialogText(page, '添加产品');
  if (!dialogText) {
    throw new Error('添加产品弹窗没有打开。');
  }

  const productState = await waitForDialogProductsLoaded(page, '添加产品', 60000);
  dialogText = await getVisibleDialogText(page, '添加产品');
  let popupProductCount = parseFirstNumberBefore(dialogText, '条');
  log(`添加产品弹窗产品数：${popupProductCount || '未识别'}；可见商品行：${productState.rows.length}；活动当前产品数：${activity.productCount || 0}。`);

  if (productState.rows.length === 0) {
    await clickDialogButton(page, '添加产品', '取消');
    await waitForDialogGone(page, '添加产品', 10000);
    log('添加产品弹窗没有可添加商品，本活动跳过添加产品。');
    return { added: 0, popupProductCount };
  }

  if (!popupProductCount) {
    log('添加产品弹窗总数未识别，但已检测到可见商品行，继续执行添加，避免误跳过。');
  } else if (popupProductCount <= activity.productCount) {
    log('添加产品弹窗总数不大于活动当前产品数，仍先勾选排除筛选确认是否还有可添加商品。');
  }

  log('准备勾选添加产品弹窗里的排除筛选：隐藏已参与限时秒杀、本次活动的产品。');
  const filterResult = await ensureAddProductExclusionFilters(page, '添加产品');
  if (filterResult.clicked.length > 0) {
    log(`已勾选添加产品筛选：${filterResult.clicked.join('、')}。`);
  }
  if (filterResult.checked.length > 0) {
    log(`添加产品筛选已是勾选状态：${filterResult.checked.join('、')}。`);
  }
  if (filterResult.missing.length > 0) {
    log(`未找到添加产品筛选项：${filterResult.missing.join('、')}。`);
  }
  if (filterResult.unchecked.length > 0) {
    log(`添加产品筛选未确认勾选：${filterResult.unchecked.join('、')}。`);
  }
  const unconfirmedFilters = [
    ...filterResult.missing,
    ...filterResult.unchecked,
  ];
  if (unconfirmedFilters.length > 0) {
    throw new Error(`添加产品筛选没有确认勾选：${unconfirmedFilters.join('、')}，已停止避免添加已参与活动的商品。`);
  }

  await sleep(1000);
  const filteredState = await waitForDialogProductStateStable(page, '添加产品', 20000);
  dialogText = filteredState.text || await getVisibleDialogText(page, '添加产品');
  const filteredPopupProductCount = filteredState.count || parseFirstNumberBefore(dialogText, '条');
  if (filteredPopupProductCount) {
    popupProductCount = filteredPopupProductCount;
  }
  log(`添加产品筛选后产品数：${popupProductCount || '未识别'}；可见商品行：${filteredState.rows.length}。`);

  if (filteredState.rows.length === 0 || hasEmptyTableText(dialogText) || popupProductCount === 0) {
    await clickDialogButton(page, '添加产品', '取消');
    await waitForDialogGone(page, '添加产品', 10000);
    log('添加产品筛选后没有可添加商品，本活动跳过添加产品。');
    return { added: 0, popupProductCount };
  }

  if (popupProductCount > MAX_ADD_PRODUCT_SEARCH_RESULT_COUNT) {
    throw new Error(
      `添加产品筛选后仍有 ${popupProductCount} 条，超过 ${MAX_ADD_PRODUCT_SEARCH_RESULT_COUNT} 条上限，已停止避免添加失败。`,
    );
  }

  log(`添加产品弹窗已筛选出 ${filteredState.rows.length} 行可见商品，准备全选搜索结果。`);

  await clickDialogButton(page, '添加产品', '一键全选搜索结果产品');
  let selectedCount = await waitForDialogSelectedCount(page, '添加产品', 12000);
  if (!Number.isFinite(selectedCount) || selectedCount <= 0) {
    log('第一次点击一键全选后未检测到已选商品，等待列表稳定后重试。');
    await waitForDialogProductsLoaded(page, '添加产品', 30000);
    await clickDialogButton(page, '添加产品', '一键全选搜索结果产品');
    selectedCount = await waitForDialogSelectedCount(page, '添加产品', 12000);
  }
  if (Number.isFinite(selectedCount) && selectedCount <= 0) {
    throw new Error('一键全选后已选商品仍为 0，已停止避免提交空选择。');
  }
  await clickDialogButton(page, '添加产品', '确定');
  await waitForDialogGone(page, '添加产品', 30000).catch(async () => {
    await clickDialogButton(page, '添加产品', '确定');
    await waitForDialogGone(page, '添加产品', 30000);
  });

  const added = popupProductCount
    || (Number.isFinite(selectedCount) && selectedCount > 0 ? selectedCount : filteredState.rows.length);
  log(`已尝试添加 ${added} 个新产品。`);
  return { added, popupProductCount };
}

async function isProductPageSize1000Selected(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    return Array.from(document.querySelectorAll('span, div, input'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter(isVisible)
      .some((element) => /^1000条\/页$/.test(normalize(element.innerText || element.textContent || element.value || '')));
  });
}

async function waitForPageSize1000Selected(page, timeout = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await isProductPageSize1000Selected(page)) {
      return true;
    }
    await sleep(500);
  }
  throw new Error('等待商品列表分页切换到 1000 条/页超时，已停止避免全选旧列表。');
}

async function selectPageSize1000(page) {
  if (await isProductPageSize1000Selected(page)) {
    log('商品列表分页已是 1000 条/页，等待列表稳定。');
    await waitForFilteredProductListStable(page, 60000);
    return true;
  }

  const getProductPageSizeTriggerPoint = () => page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const entries = Array.from(document.querySelectorAll('button, span, div, input'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter((element) => !element.closest('[class*=dropdown], [class*=Dropdown], [class*=popper], [class*=Popper], [class*=option], [class*=Option]'))
      .filter((element) => !element.closest('.jx-select-dropdown, .el-select-dropdown, .ant-select-dropdown, .semi-select-option-list, .arco-select-dropdown'))
      .filter(isVisible)
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || element.value || '');
        const match = text.match(/^(\d+)条\/页$/);
        if (!match) return null;
        const rect = element.getBoundingClientRect();
        return {
          element,
          value: Number.parseInt(match[1], 10),
          bottom: rect.bottom,
          right: rect.right,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.bottom - a.bottom || b.right - a.right);

    const current = entries[0];
    if (!current) return null;
    const trigger = current.element.closest?.('.jx-select, .jx-select__wrapper, .el-select, .el-select__wrapper, .ant-select, .semi-select, .arco-select, [class*=select], [class*=Select], [role=button], button')
      || current.element.parentElement
      || current.element;
    trigger.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = trigger.getBoundingClientRect();
    return {
      x: Math.max(rect.left + 4, rect.right - 16),
      y: rect.top + rect.height / 2,
      value: current.value,
    };
  });

  const getProductPageSizeOptionPoint = () => page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const option = Array.from(document.querySelectorAll('[role=option], li, span, div'))
      .filter(isVisible);
    const targetEntry = option
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || '');
        if (text !== '1000条/页') return null;
        const target = element.closest?.('[role=option], li, .jx-select-dropdown__item, .el-select-dropdown__item, .ant-select-item, .semi-select-option, .arco-select-option')
          || element;
        const rect = target.getBoundingClientRect();
        return { target, rect };
      })
      .filter(Boolean)
      .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right)[0];
    if (!targetEntry) return null;
    targetEntry.target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = targetEntry.target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await isProductPageSize1000Selected(page)) {
      break;
    }

    const triggerPoint = await getProductPageSizeTriggerPoint();
    if (!triggerPoint) {
      await sleep(800);
      continue;
    }
    log(`当前添加产品列表分页为 ${triggerPoint.value} 条/页，点击分页器。`);
    await page.mouse.click(triggerPoint.x, triggerPoint.y);
    await sleep(800);

    let optionPoint = null;
    for (let optionAttempt = 0; optionAttempt < 5; optionAttempt += 1) {
      optionPoint = await getProductPageSizeOptionPoint();
      if (optionPoint) break;
      await page.mouse.wheel({ deltaY: 160 });
      await sleep(300);
    }
    if (!optionPoint) {
      await sleep(800);
      continue;
    }

    await page.mouse.click(optionPoint.x, optionPoint.y);
    await sleep(1500);
  }

  await waitForPageSize1000Selected(page, 20000);
  log('已确认商品列表分页切换为 1000 条/页，等待列表刷新完成。');
  await waitForFilteredProductListStable(page, 60000);
  return true;
}

async function ensureUnpricedFilter(page) {
  const clicked = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label, span, div'));
    const label = labels.find((item) => (item.innerText || item.textContent || '').trim() === '仅展示未设置秒杀价产品');
    if (!label) return false;
    const root = label.closest('label') || label.parentElement || label;
    const input = root.querySelector('input[type=checkbox]');
    if (input && input.checked) return true;
    label.scrollIntoView({ block: 'center', inline: 'center' });
    label.click();
    return true;
  });
  if (!clicked) {
    throw new Error('没有找到“仅展示未设置秒杀价产品”筛选。');
  }
  log('已勾选“仅展示未设置秒杀价产品”，等待筛选结果刷新。');
  await waitForUnpricedFilterChecked(page, 15000).catch(() => { });
  await waitForFilteredProductListStable(page, 60000);
  log('筛选结果已刷新，继续设置商品列表分页。');
  await sleep(FLASH_SAFE_STEP_DELAY_MS);
}

async function waitForUnpricedFilterChecked(page, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const checked = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label, span, div'));
      const label = labels.find((item) => (item.innerText || item.textContent || '').trim() === '仅展示未设置秒杀价产品');
      if (!label) return null;
      const root = label.closest('label') || label.parentElement || label;
      const input = root.querySelector('input[type=checkbox]');
      if (input) return Boolean(input.checked);
      return /checked|is-checked|active/.test(root.className || '');
    });
    if (checked === true) return true;
    await sleep(500);
  }
  throw new Error('等待“仅展示未设置秒杀价产品”勾选状态超时。');
}

async function getProductListRefreshState(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };

    const rows = Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
      .filter((element) => !element.closest('[role=dialog], .jx-dialog, .el-dialog'))
      .filter(isVisible)
      .map((element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text && /(?:产品|商品)ID[:：]/.test(text));
    const text = document.body ? document.body.innerText || document.body.textContent || '' : '';
    const loadingElements = Array.from(document.querySelectorAll('.el-loading-mask, .jx-spin, .ant-spin, [class*=loading], [class*=Loading]'))
      .filter(isVisible);
    const ids = rows.map((row) => {
      const match = row.match(/(?:产品|商品)ID[:：]\s*(\d+)/);
      return match ? match[1] : row.slice(0, 80);
    });

    return {
      rows,
      loadingMaskCount: loadingElements.length,
      hasLoadingText: /加载中|Loading/i.test(text),
      loading: loadingElements.length > 0 || /加载中|Loading/i.test(text),
      hasEmpty: /暂无数据|没有数据/.test(text),
      signature: `${rows.length}:${ids.slice(0, 5).join('|')}:${ids.slice(-3).join('|')}`,
    };
  });
}

function isFilteredProductListRefreshReady(state = {}) {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const blockingLoading = Number(state.loadingMaskCount || 0) > 0;

  if (blockingLoading) {
    return false;
  }
  if (rows.length > 0) {
    return true;
  }

  return Boolean(state.hasEmpty && !state.loading);
}

async function waitForFilteredProductListStable(page, timeout = 60000) {
  const startedAt = Date.now();
  const minWaitMs = 8000;
  let lastSignature = '';
  let stableSince = 0;
  let lastState = null;

  while (Date.now() - startedAt < timeout) {
    lastState = await getProductListRefreshState(page);
    const elapsed = Date.now() - startedAt;
    const ready = isFilteredProductListRefreshReady(lastState);

    if (ready && lastState.signature === lastSignature) {
      if (!stableSince) stableSince = Date.now();
    } else {
      stableSince = 0;
      lastSignature = lastState.signature;
    }

    if (ready && elapsed >= minWaitMs && stableSince && Date.now() - stableSince >= 2500) {
      if (lastState.hasLoadingText && lastState.rows.length > 0) {
        log('筛选后的商品列表仍有加载提示文案，但商品行已稳定且没有可见加载遮罩，继续处理。');
      }
      log(`筛选后的商品列表已稳定，当前可见商品行：${lastState.rows.length}。`);
      return lastState;
    }

    await sleep(1000);
  }

  throw new Error(`筛选后的商品列表加载超时，已停止避免过早全选。最后可见商品行：${lastState ? lastState.rows.length : 0}`);
}

async function readProductRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.pro-virtual-table__row, .pro-virtual-scroll__row'))
    .map((element, index) => ({
      index,
      text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => row.text && /(?:产品|商品)ID[:：]/.test(row.text)));
}

async function waitForProductRowsOrEmpty(page, timeout = 60000) {
  const startedAt = Date.now();
  let lastText = '';
  let lastRows = [];

  while (Date.now() - startedAt < timeout) {
    lastText = await bodyText(page);
    lastRows = await readProductRows(page);
    if (lastRows.length > 0 || hasEmptyTableText(lastText)) {
      return { text: lastText, rows: lastRows };
    }
    await sleep(800);
  }

  throw new Error(`商品列表加载超时，最后可见产品行：${lastRows.length}`);
}

async function selectAllFilteredProducts(page) {
  await waitForUnpricedFilterChecked(page, 5000);
  await waitForFilteredProductListStable(page, 20000);

  const clicked = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('th, .pro-virtual-table__header, .pro-table__header, div'));
    const productHeader = headers.find((item) => (item.innerText || item.textContent || '').includes('产品信息'));
    const container = productHeader ? (productHeader.closest('table') || productHeader.parentElement || document.body) : document.body;
    const checkboxes = Array.from(container.querySelectorAll('input[type=checkbox]'));
    const checkbox = checkboxes.find((input) => {
      const text = (input.closest('label') || input.parentElement || input).innerText || '';
      return !text.includes('仅展示未设置秒杀价产品');
    }) || checkboxes[0];
    if (checkbox) {
      const target = checkbox.closest('label') || checkbox.parentElement || checkbox;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    throw new Error('没有找到产品表格全选框。');
  }
  await sleep(1000);

  const selectedCount = parseSelectedCount(await bodyText(page));
  if (Number.isFinite(selectedCount) && selectedCount <= 0) {
    throw new Error('点击产品表格全选后已选数量仍为 0，已停止避免空提交。');
  }
}

async function selectDiscountModeAndFill(page, discount, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  let lastReason = '';

  while (Date.now() - startedAt < timeout) {
    const result = await page.evaluate((discountValue) => {
      const dialog = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog'))
        .reverse()
        .find((item) => (item.innerText || item.textContent || '').includes('批量设置秒杀价'));
      if (!dialog) {
        return { ok: false, reason: '没有找到批量设置秒杀价弹窗' };
      }

      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
      const dispatchClick = (element) => {
        if (!element) return false;
        let target = element;
        for (let depth = 0; target && target !== dialog && depth < 6; depth += 1) {
          if (isVisible(target)) break;
          target = target.parentElement;
        }
        if (!target) target = element;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          }));
        }
        if (typeof target.click === 'function') {
          target.click();
        } else {
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          }));
        }
        return true;
      };
      const setNativeValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(input, value);
        } else {
          input.value = value;
        }
      };
      const findOption = (labelText) => {
        const label = Array.from(dialog.querySelectorAll('label, span, div'))
          .filter(isVisible)
          .find((element) => normalize(element.innerText || element.textContent).replace(/[:：]$/, '') === labelText);
        if (!label) return null;
        let row = label;
        for (let depth = 0; row && row !== dialog && depth < 10; depth += 1) {
          const text = normalize(row.innerText || row.textContent || '');
          const rect = row.getBoundingClientRect();
          const hasInput = row.querySelectorAll('input').length > 0;
          const containsOtherOption = ['统一价格', '统一减价', '统一折扣']
            .some((item) => item !== labelText && text.includes(item));
          if (text.includes(labelText) && hasInput && !containsOtherOption && rect.height >= 20 && rect.height <= 90) {
            return { label, row };
          }
          row = row.parentElement;
        }
        return { label, row: label.parentElement || label };
      };
      const findValueInputInRow = (row) => Array.from(row.querySelectorAll('input'))
        .filter((input) => isVisible(input)
          && input.type !== 'hidden'
          && input.type !== 'radio'
          && input.type !== 'checkbox')
        .find((input) => !input.disabled && !input.readOnly);
      const findValueInputByLine = (label) => {
        const labelRect = label.getBoundingClientRect();
        const labelCenterY = labelRect.top + labelRect.height / 2;
        return Array.from(dialog.querySelectorAll('input'))
          .filter((input) => input.type !== 'hidden'
            && input.type !== 'radio'
            && input.type !== 'checkbox'
            && !input.disabled
            && !input.readOnly)
          .map((input) => {
            const rect = input.getBoundingClientRect();
            return {
              input,
              rect,
              distance: Math.abs((rect.top + rect.height / 2) - labelCenterY),
            };
          })
          .filter((entry) => isVisible(entry.input)
            && entry.rect.left >= labelRect.left - 4
            && entry.distance <= 36)
          .sort((a, b) => a.distance - b.distance || a.rect.left - b.rect.left)[0]?.input || null;
      };
      const findToggleInRow = (row, type) => {
        const classNeedle = type === 'radio' ? 'radio' : 'checkbox';
        const visibleControl = Array.from(row.querySelectorAll(`[role="${type}"], *[class*="${classNeedle}"]`))
          .filter(isVisible)
          .find((element) => {
            const className = String(element.className || '').toLowerCase();
            const role = String(element.getAttribute('role') || '').toLowerCase();
            return className.includes(classNeedle) || role === type;
          });
        if (visibleControl) return visibleControl;

        const direct = Array.from(row.querySelectorAll(`input[type="${type}"]`))
          .find((input) => !input.disabled && isVisible(input));
        if (direct) return direct;

        const hiddenDirect = Array.from(row.querySelectorAll(`input[type="${type}"]`))
          .find((input) => !input.disabled);
        if (!hiddenDirect) return null;
        let parent = hiddenDirect.closest('label') || hiddenDirect.parentElement;
        for (let depth = 0; parent && parent !== dialog && depth < 6; depth += 1) {
          if (isVisible(parent)) return parent;
          parent = parent.parentElement;
        }
        return hiddenDirect;
      };
      const findToggleByLine = (label, type) => {
        const labelRect = label.getBoundingClientRect();
        const labelCenterY = labelRect.top + labelRect.height / 2;
        const classNeedle = type === 'radio' ? 'radio' : 'checkbox';
        return Array.from(dialog.querySelectorAll(`input[type="${type}"], [role="${type}"], *[class*="${classNeedle}"]`))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              element,
              rect,
              distance: Math.abs((rect.top + rect.height / 2) - labelCenterY),
            };
          })
          .filter((entry) => isVisible(entry.element)
            && entry.distance <= 36
            && entry.rect.left <= labelRect.left + 18
            && entry.rect.right >= labelRect.left - 56
            && entry.rect.left >= dialog.getBoundingClientRect().left)
          .sort((a, b) => a.distance - b.distance
            || (a.rect.width - b.rect.width)
            || b.rect.left - a.rect.left)[0]?.element || null;
      };
      const isToggleChecked = (element, root) => {
        if (!element) return false;
        if (element.matches && element.matches('input')) {
          return Boolean(element.checked);
        }
        const chain = [];
        let current = element;
        for (let depth = 0; current && current !== dialog && depth < 6; depth += 1) {
          chain.push(current);
          current = current.parentElement;
        }
        if (root) chain.push(root);
        return chain.some((item) => {
          const className = String(item.className || '').toLowerCase();
          const ariaChecked = String(item.getAttribute?.('aria-checked') || '').toLowerCase();
          return ariaChecked === 'true'
            || className.includes('is-checked')
            || className.includes('checked')
            || className.includes('active')
            || className.includes('selected');
        });
      };

      const discountOption = findOption('统一折扣');
      if (!discountOption || !discountOption.row) {
        return { ok: false, reason: '没有找到统一折扣这一行' };
      }

      const discountRadio = findToggleInRow(discountOption.row, 'radio')
        || findToggleByLine(discountOption.label, 'radio');
      if (!dispatchClick(discountRadio || discountOption.row || discountOption.label)) {
        return { ok: false, reason: '没有找到可点击的统一折扣单选框' };
      }
      if (!isToggleChecked(discountRadio, discountOption.row)) {
        return { ok: false, reason: '已点击统一折扣，等待选中状态刷新' };
      }

      const targetInput = findValueInputInRow(discountOption.row)
        || findValueInputByLine(discountOption.label);
      if (!targetInput) {
        return { ok: false, reason: '没有找到统一折扣输入框' };
      }
      if (targetInput.disabled || targetInput.readOnly) {
        return { ok: false, reason: '统一折扣输入框还没有启用' };
      }

      targetInput.focus();
      setNativeValue(targetInput, '');
      targetInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeValue(targetInput, String(discountValue));
      targetInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(discountValue) }));
      targetInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: String(discountValue).slice(-1) || '0' }));
      targetInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(discountValue).slice(-1) || '0' }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));

      const minLabel = Array.from(dialog.querySelectorAll('label, span, div'))
        .filter(isVisible)
        .find((element) => normalize(element.innerText || element.textContent).includes('秒杀价不低于原价'));
      if (minLabel) {
        let minRow = minLabel;
        for (let depth = 0; minRow && minRow !== dialog && depth < 10; depth += 1) {
          const text = normalize(minRow.innerText || minRow.textContent || '');
          const rect = minRow.getBoundingClientRect();
          if (text.includes('秒杀价不低于原价') && rect.height >= 20 && rect.height <= 90) {
            break;
          }
          minRow = minRow.parentElement;
        }
        const minRoot = minRow || minLabel.closest('label') || minLabel.parentElement || minLabel;
        const minCheckbox = findToggleInRow(minRoot, 'checkbox')
          || findToggleByLine(minLabel, 'checkbox');
        const minChecked = isToggleChecked(minCheckbox, minRoot);
        if (minChecked) {
          dispatchClick(minCheckbox || minRoot || minLabel);
          return { ok: false, reason: '已取消5折保护，等待状态刷新' };
        }
      }

      return { ok: true };
    }, discount);

    if (!result || !result.ok) {
      lastReason = result && result.reason ? result.reason : '未知原因';
      await sleep(700);
      continue;
    }

    const stableResult = await waitForDiscountInputStable(page, discount, 4500);
    if (stableResult.ok) {
      log(`统一折扣已设置为 ${discount}%OFF。`);
      return;
    }

    lastReason = stableResult.reason;
    await sleep(700);
  }

  throw new Error(`没有正确填写统一折扣：${lastReason}`);
}

async function waitForDiscountInputStable(page, discount, timeout = 3500) {
  const startedAt = Date.now();
  const requiredStableMs = 1800;
  let stableSince = 0;
  let lastReason = '';

  while (Date.now() - startedAt < timeout) {
    const result = await page.evaluate((discountValue) => {
      const dialog = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog'))
        .reverse()
        .find((item) => (item.innerText || item.textContent || '').includes('批量设置秒杀价'));
      if (!dialog) return { ok: false, reason: '弹窗已不存在' };

      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
      const findOption = (labelText) => {
        const label = Array.from(dialog.querySelectorAll('label, span, div'))
          .filter(isVisible)
          .find((element) => normalize(element.innerText || element.textContent).replace(/[:：]$/, '') === labelText);
        if (!label) return null;
        let row = label;
        for (let depth = 0; row && row !== dialog && depth < 10; depth += 1) {
          const text = normalize(row.innerText || row.textContent || '');
          const rect = row.getBoundingClientRect();
          const hasInput = row.querySelectorAll('input').length > 0;
          const containsOtherOption = ['统一价格', '统一减价', '统一折扣']
            .some((item) => item !== labelText && text.includes(item));
          if (text.includes(labelText) && hasInput && !containsOtherOption && rect.height >= 20 && rect.height <= 90) {
            return { label, row };
          }
          row = row.parentElement;
        }
        return { label, row: label.parentElement || label };
      };
      const findValueInputInRow = (row) => Array.from(row.querySelectorAll('input'))
        .filter((input) => isVisible(input)
          && input.type !== 'hidden'
          && input.type !== 'radio'
          && input.type !== 'checkbox')
        .find((input) => !input.disabled && !input.readOnly);
      const findValueInputByLine = (label) => {
        const labelRect = label.getBoundingClientRect();
        const labelCenterY = labelRect.top + labelRect.height / 2;
        return Array.from(dialog.querySelectorAll('input'))
          .filter((input) => input.type !== 'hidden'
            && input.type !== 'radio'
            && input.type !== 'checkbox'
            && !input.disabled
            && !input.readOnly)
          .map((input) => {
            const rect = input.getBoundingClientRect();
            return {
              input,
              rect,
              distance: Math.abs((rect.top + rect.height / 2) - labelCenterY),
            };
          })
          .filter((entry) => isVisible(entry.input)
            && entry.rect.left >= labelRect.left - 4
            && entry.distance <= 36)
          .sort((a, b) => a.distance - b.distance || a.rect.left - b.rect.left)[0]?.input || null;
      };
      const findToggleInRow = (row, type) => {
        const classNeedle = type === 'radio' ? 'radio' : 'checkbox';
        const visibleControl = Array.from(row.querySelectorAll(`[role="${type}"], *[class*="${classNeedle}"]`))
          .filter(isVisible)
          .find((element) => {
            const className = String(element.className || '').toLowerCase();
            const role = String(element.getAttribute('role') || '').toLowerCase();
            return className.includes(classNeedle) || role === type;
          });
        if (visibleControl) return visibleControl;

        const direct = Array.from(row.querySelectorAll(`input[type="${type}"]`))
          .find((input) => !input.disabled && isVisible(input));
        if (direct) return direct;

        const hiddenDirect = Array.from(row.querySelectorAll(`input[type="${type}"]`))
          .find((input) => !input.disabled);
        if (!hiddenDirect) return null;
        let parent = hiddenDirect.closest('label') || hiddenDirect.parentElement;
        for (let depth = 0; parent && parent !== dialog && depth < 6; depth += 1) {
          if (isVisible(parent)) return parent;
          parent = parent.parentElement;
        }
        return hiddenDirect;
      };
      const findToggleByLine = (label, type) => {
        const labelRect = label.getBoundingClientRect();
        const labelCenterY = labelRect.top + labelRect.height / 2;
        const classNeedle = type === 'radio' ? 'radio' : 'checkbox';
        return Array.from(dialog.querySelectorAll(`input[type="${type}"], [role="${type}"], *[class*="${classNeedle}"]`))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              element,
              rect,
              distance: Math.abs((rect.top + rect.height / 2) - labelCenterY),
            };
          })
          .filter((entry) => isVisible(entry.element)
            && entry.distance <= 36
            && entry.rect.left <= labelRect.left + 18
            && entry.rect.right >= labelRect.left - 56
            && entry.rect.left >= dialog.getBoundingClientRect().left)
          .sort((a, b) => a.distance - b.distance
            || (a.rect.width - b.rect.width)
            || b.rect.left - a.rect.left)[0]?.element || null;
      };
      const isToggleChecked = (element, root) => {
        if (!element) return false;
        if (element.matches && element.matches('input')) {
          return Boolean(element.checked);
        }
        const chain = [];
        let current = element;
        for (let depth = 0; current && current !== dialog && depth < 6; depth += 1) {
          chain.push(current);
          current = current.parentElement;
        }
        if (root) chain.push(root);
        return chain.some((item) => {
          const className = String(item.className || '').toLowerCase();
          const ariaChecked = String(item.getAttribute?.('aria-checked') || '').toLowerCase();
          return ariaChecked === 'true'
            || className.includes('is-checked')
            || className.includes('checked')
            || className.includes('active')
            || className.includes('selected');
        });
      };

      const discountOption = findOption('统一折扣');
      if (!discountOption || !discountOption.row) return { ok: false, reason: '统一折扣选项消失' };
      const input = findValueInputInRow(discountOption.row) || findValueInputByLine(discountOption.label);
      if (!input) return { ok: false, reason: '没有找到统一折扣输入框' };

      const normalizedActual = String(input.value || '').replace(/[^\d.]/g, '');
      const normalizedExpected = String(discountValue || '').replace(/[^\d.]/g, '');
      const discountRadio = findToggleInRow(discountOption.row, 'radio')
        || findToggleByLine(discountOption.label, 'radio');
      const radioChecked = isToggleChecked(discountRadio, discountOption.row);
      const minPriceLabel = Array.from(dialog.querySelectorAll('label, span, div'))
        .filter(isVisible)
        .find((element) => normalize(element.innerText || element.textContent).includes('秒杀价不低于原价'));
      const minPriceStillChecked = (() => {
        if (!minPriceLabel) return false;
        let minRow = minPriceLabel;
        for (let depth = 0; minRow && minRow !== dialog && depth < 10; depth += 1) {
          const text = normalize(minRow.innerText || minRow.textContent || '');
          const rect = minRow.getBoundingClientRect();
          if (text.includes('秒杀价不低于原价') && rect.height >= 20 && rect.height <= 90) {
            break;
          }
          minRow = minRow.parentElement;
        }
        const minRoot = minRow || minPriceLabel.closest('label') || minPriceLabel.parentElement || minPriceLabel;
        const minCheckbox = findToggleInRow(minRoot, 'checkbox')
          || findToggleByLine(minPriceLabel, 'checkbox');
        return isToggleChecked(minCheckbox, minRoot);
      })();

      return {
        ok: normalizedActual === normalizedExpected && radioChecked && !minPriceStillChecked,
        value: input.value || '',
        radioChecked,
        minPriceStillChecked,
        reason: `统一折扣输入框当前值：${input.value || '空'}；统一折扣${radioChecked ? '已选中' : '未选中'}；5折保护${minPriceStillChecked ? '仍勾选' : '已取消'}`,
      };
    }, discount);

    if (result && result.ok) {
      if (!stableSince) {
        stableSince = Date.now();
      }
      if (Date.now() - stableSince >= requiredStableMs) {
        return { ok: true };
      }
    } else {
      stableSince = 0;
      lastReason = result && result.reason ? result.reason : '未知原因';
    }

    await sleep(400);
  }

  return { ok: false, reason: lastReason || '统一折扣输入框没有稳定保持目标值' };
}

async function clickDiscountApplyButton(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const dialog = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog'))
      .reverse()
      .find((item) => isVisible(item) && (item.innerText || item.textContent || '').includes('批量设置秒杀价'));
    if (!dialog) return false;
    const buttons = Array.from(dialog.querySelectorAll('button'))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
    const button = buttons.find((item) => (item.innerText || item.textContent || '').trim() === '应用至选中');
    if (!button || button.disabled) return false;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  });

  if (!clicked) {
    throw new Error('没有找到可点击的“应用至选中”按钮。');
  }
  await sleep(1000);
}

async function waitForDiscountDialogApplied(page, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  let lastText = '';
  while (Date.now() - startedAt < timeout) {
    lastText = await getVisibleDialogText(page, '批量设置秒杀价');
    if (!lastText) {
      return;
    }
    await sleep(1000);
  }

  const clipped = normalizeText(lastText).slice(0, 180);
  throw new Error(`批量设置秒杀价弹窗没有关闭，页面可能没有接受折扣设置。弹窗内容：${clipped}`);
}

async function applyDiscount(page, discount) {
  await clickText(page, '批量秒杀价格', { selector: 'button', exact: true, afterClickMs: 1000 });
  await waitForBodyText(page, '批量设置秒杀价', DEFAULT_TIMEOUT);
  log(`准备按活动标题设置统一折扣：${discount}%OFF。`);
  await selectDiscountModeAndFill(page, discount, DEFAULT_TIMEOUT);

  await clickDiscountApplyButton(page);
  await waitForDiscountDialogApplied(page, DEFAULT_TIMEOUT);
  await sleep(1500);
}

function parseSubmitFailedCount(text = '') {
  const normalized = normalizeText(text);
  const values = [];
  const patterns = [
    /失败(?!列表)(?:产品|数|数量|项)?\s*[:：]?\s*(\d+)/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(normalized);
    while (match) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value)) {
        values.push(value);
      }
      match = pattern.exec(normalized);
    }
  }
  return values.length > 0 ? values[values.length - 1] : 0;
}

async function getSubmitResultText(page) {
  const dialogText = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'))
      .filter(isVisible)
      .map((element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => /未完成|成功|失败|失败列表|确认/.test(text));
    return dialogs.reverse()[0] || '';
  });

  return dialogText || bodyText(page);
}

async function waitForSubmitResult(page, timeout = 10 * 60 * 1000) {
  let text = await getSubmitResultText(page);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    text = await getSubmitResultText(page);
    const failedCount = parseSubmitFailedCount(text);
    if (failedCount > 0 && (text.includes('失败列表') || /失败/.test(text))) {
      break;
    }
    if (text.includes('失败列表')) {
      break;
    }
    if (/未完成\s*[:：]?\s*0/.test(normalizeText(text)) && failedCount === 0) {
      break;
    }
    await sleep(3000);
  }

  let failedCount = parseSubmitFailedCount(text);
  if (failedCount === 0 && text.includes('失败列表') && !/失败\s*[:：]?\s*0/.test(normalizeText(text))) {
    failedCount = 1;
  }
  log(`提交结果识别：失败产品 ${failedCount} 个。`);
  return {
    text,
    failedCount,
  };
}

async function getVisibleFailureListText(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'))
      .filter(isVisible);
    const dialog = dialogs.reverse().find((item) => {
      const text = normalize(item.innerText || item.textContent || '');
      return /继续编辑|失败原因/.test(text)
        || (text.includes('失败列表') && !/未完成|成功|确认/.test(text));
    });
    return dialog ? (dialog.innerText || dialog.textContent || '') : '';
  });
}

async function waitForFailureListDialog(page, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const text = await getVisibleFailureListText(page);
    if (text) {
      return text;
    }
    await sleep(500);
  }
  throw new Error('等待失败列表弹窗超时。');
}

async function clickFailureListEntry(page) {
  const result = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isClickable = (element) => {
      const tag = element.tagName ? element.tagName.toLowerCase() : '';
      const role = element.getAttribute?.('role') || '';
      const className = String(element.className || '');
      const style = window.getComputedStyle(element);
      return ['button', 'a', 'li'].includes(tag)
        || ['button', 'tab', 'link'].includes(role)
        || style.cursor === 'pointer'
        || /btn|button|tab|link|click|item|text-btn/i.test(className);
    };
    const closestClickable = (element) => {
      let current = element;
      for (let depth = 0; current && current !== document.body && depth < 8; depth += 1) {
        if (isClickable(current)) {
          return current;
        }
        current = current.parentElement;
      }
      return element;
    };
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'))
      .filter(isVisible);
    const resultDialog = dialogs.reverse().find((item) => {
      const text = normalize(item.innerText || item.textContent || '');
      return /未完成|成功|失败|失败列表|确认/.test(text);
    }) || document.body;
    const candidates = Array.from(resultDialog.querySelectorAll('button, a, [role=button], [role=tab], li, span, div'))
      .filter(isVisible)
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || element.getAttribute?.('title') || '');
        return { element, text };
      })
      .filter((item) => item.text && item.text.length <= 80);

    const scoreEntry = ({ element, text }) => {
      if (text === '失败列表') return 0;
      if (/失败列表/.test(text)) return 1;
      if (/失败明细|失败详情|失败产品|查看失败|查看详情/.test(text)) return 2;
      if (/^失败\s*[:：]?\s*\d+/.test(text)) return 3;
      if (/失败\s*\d+/.test(text) && isClickable(element)) return 4;
      if (/失败/.test(text) && isClickable(element)) return 5;
      return 99;
    };

    const entry = candidates
      .map((item) => ({ ...item, score: scoreEntry(item) }))
      .filter((item) => item.score < 99)
      .sort((a, b) => a.score - b.score || a.text.length - b.text.length)[0];
    if (!entry) {
      return {
        ok: false,
        reason: normalize(resultDialog.innerText || resultDialog.textContent || '').slice(0, 240),
      };
    }

    const target = closestClickable(entry.element);
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return { ok: true, text: entry.text };
  });

  if (!result.ok) {
    throw new Error(`没有找到失败列表入口。当前提交结果内容：${result.reason || '-'}`);
  }
  log(`已点击失败列表入口：${result.text}。`);
  await sleep(1500);
}

async function openFailureList(page) {
  const existingText = await getVisibleFailureListText(page);
  if (existingText) {
    return existingText;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await clickFailureListEntry(page);
      return await waitForFailureListDialog(page, 8000);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        log(`第 ${attempt} 次打开失败列表未成功，稍等后重试。`);
        await sleep(1500);
      }
    }
  }

  throw lastError || new Error('没有打开失败列表。');
}

async function selectFailureDialogPageSize500(page) {
  const opened = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'));
    const dialog = dialogs.reverse().find((item) => {
      const text = normalize(item.innerText || item.textContent || '');
      return isVisible(item) && (/继续编辑|失败原因/.test(text)
        || (text.includes('失败列表') && !/未完成|成功|确认/.test(text)));
    });
    if (!dialog) return false;
    if ((dialog.innerText || dialog.textContent || '').includes('500条/页')) return true;
    const pageSize = Array.from(dialog.querySelectorAll('span, div, input'))
      .filter(isVisible)
      .find((item) => /\d+条\/页/.test((item.innerText || item.textContent || item.value || '').trim()));
    if (!pageSize) return false;
    pageSize.scrollIntoView({ block: 'center', inline: 'center' });
    pageSize.click();
    return true;
  });
  if (!opened) return false;
  await sleep(800);

  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const option = Array.from(document.querySelectorAll('li, span, div'))
      .filter(isVisible)
      .find((item) => (item.innerText || item.textContent || '').trim() === '500条/页');
    if (!option) return false;
    option.scrollIntoView({ block: 'center', inline: 'center' });
    option.click();
    return true;
  });
  await sleep(1500);
  return clicked;
}

async function selectAllFailureProducts(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const clickElement = (element) => {
      const target = element.closest?.('label') || element.parentElement || element;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'));
    const dialog = dialogs.reverse().find((item) => {
      const text = normalize(item.innerText || item.textContent || '');
      return isVisible(item) && (/继续编辑|失败原因/.test(text)
        || (text.includes('失败列表') && !/未完成|成功|确认/.test(text)));
    });
    if (!dialog) return false;

    const header = Array.from(dialog.querySelectorAll('th, .pro-virtual-table__header, .pro-table__header, div'))
      .filter(isVisible)
      .find((item) => (item.innerText || item.textContent || '').includes('产品信息')
        || (item.innerText || item.textContent || '').includes('失败原因'));
    const container = header ? (header.closest('table') || header.parentElement || dialog) : dialog;
    const checkbox = Array.from(container.querySelectorAll('input[type=checkbox]'))
      .filter(isVisible)[0]
      || Array.from(container.querySelectorAll('[role=checkbox], *[class*=checkbox]'))
        .filter(isVisible)[0];
    return checkbox ? clickElement(checkbox) : false;
  });

  if (!clicked) {
    throw new Error('失败列表里没有找到全选框。');
  }
  await sleep(1000);
}

async function clickFailureDialogContinueEdit(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'));
    const dialog = dialogs.reverse().find((item) => {
      const text = normalize(item.innerText || item.textContent || '');
      return isVisible(item) && (/继续编辑|失败原因/.test(text)
        || (text.includes('失败列表') && !/未完成|成功|确认/.test(text)));
    });
    if (!dialog) return false;
    const button = Array.from(dialog.querySelectorAll('button, [role=button], a, span, div'))
      .filter(isVisible)
      .find((item) => normalize(item.innerText || item.textContent || '') === '继续编辑');
    if (!button) return false;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  });

  if (!clicked) {
    throw new Error('失败列表里没有找到“继续编辑”按钮。');
  }
  await sleep(1000);
}

async function continueEditingFailedProducts(page, failedCount) {
  log(`提交后仍有失败产品：${failedCount}，打开失败列表继续编辑。`);
  await openFailureList(page);
  await waitForFailureListDialog(page, DEFAULT_TIMEOUT);
  await selectFailureDialogPageSize500(page).catch((error) => {
    log(`失败列表切换 500 条/页失败，继续尝试全选：${error.message}`);
  });
  await selectAllFailureProducts(page);
  await clickFailureDialogContinueEdit(page);
  await waitForDialogGone(page, '继续编辑', DEFAULT_TIMEOUT).catch(() => { });
  await sleep(2000);
}

async function closeSubmitResultPrompt(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element || !element.getClientRects().length) return false;
      let current = element;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const dialogs = Array.from(document.querySelectorAll('[role=dialog], .jx-dialog, .el-dialog, .ant-modal, .semi-modal, .arco-modal'))
      .filter(isVisible);
    const dialog = dialogs.reverse().find((item) => /提示|未完成|成功|失败/.test(normalize(item.innerText || item.textContent || '')));
    if (!dialog) return false;
    const buttons = Array.from(dialog.querySelectorAll('button, [role=button], a, span, div'))
      .filter(isVisible);
    const button = buttons.find((item) => ['确认', '关闭'].includes(normalize(item.innerText || item.textContent || '')))
      || buttons.find((item) => /关闭|close/i.test(normalize(item.getAttribute?.('aria-label') || item.getAttribute?.('title') || item.className || '')));
    if (!button) return false;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  });

  if (!clicked) {
    await tryClickText(page, '确认', { selector: 'button, span, div', exact: true, afterClickMs: 800 })
      || await tryClickText(page, '关闭', { selector: 'button, span, div', exact: true, afterClickMs: 800 });
  }
  await sleep(1200);
}

async function submitActivity(page) {
  await clickText(page, '提交', { selector: 'button', exact: true, afterClickMs: 1500 });
  await sleep(2000);
  const result = await waitForSubmitResult(page);
  if (result.failedCount <= 0) {
    await closeSubmitResultPrompt(page).catch(() => { });
    return { failedCount: 0, submitRounds: 1 };
  }

  log(`提交后仍有失败产品：${result.failedCount}，不再打开失败列表，改为重新处理当前活动剩余未设置商品。`);
  await closeSubmitResultPrompt(page).catch(() => { });
  return { failedCount: result.failedCount, submitRounds: 1 };
}

async function processActivity(browser, listPage, activity, runState) {
  const beforePages = await browser.pages();
  log(`开始处理活动：${activity.title}（${activity.id || '无ID'}）。`);
  emitProgress({
    phase: 'flash',
    phaseLabel: `处理活动 ${runState.completed + 1}/${runState.total}`,
    completed: runState.completed,
    total: runState.total,
    totalCount: runState.total,
    detailId: activity.id,
    detailName: activity.title,
    overallPercent: Math.round((runState.completed / runState.total) * 100),
  });

  await clickManageProductByActivity(listPage, activity);
  const detailPage = await waitForDetailPage(browser, listPage, beforePages);
  await waitForBodyText(detailPage, '管理活动产品', DEFAULT_TIMEOUT);
  const detailText = await bodyText(detailPage);
  const detailTitleMatch = detailText.match(/活动名称\s*:\s*([^\n]+)/) || detailText.match(/活动名称\s*\n:\s*\n([^\n]+)/);
  const detailTitle = detailTitleMatch ? detailTitleMatch[1].trim() : activity.title;
  const resultTitle = detailTitle && detailTitle !== '活动时间' ? detailTitle : activity.title;
  const discount = activity.discount;
  if (!Number.isFinite(discount)) {
    throw new Error(`活动标题没有清晰折扣：${activity.title}`);
  }

  let totalAddedProducts = 0;
  let lastUnpricedProducts = 0;
  let submitted = false;
  let submitResult = { failedCount: 0, submitRounds: 0 };

  for (let attempt = 1; attempt <= MAX_FAILURE_RETRY_ROUNDS; attempt += 1) {
    if (attempt > 1) {
      log(`第 ${attempt} 轮重新处理当前秒杀活动：重新走添加产品流程后，再处理剩余未设置秒杀价商品。`);
      await detailPage.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => { });
      await waitForBodyText(detailPage, '管理活动产品', DEFAULT_TIMEOUT);
      await sleep(1500);
    }

    const addResult = await handleAddProducts(detailPage, activity);
    totalAddedProducts += addResult.added;
    log(attempt === 1
      ? '添加产品流程完成，停留 0.5 秒后先勾选“仅展示未设置秒杀价产品”，再切换 1000 条/页。'
      : '重试添加产品流程完成，停留 0.5 秒后先勾选“仅展示未设置秒杀价产品”，再切换 1000 条/页。');
    await sleep(FLASH_SAFE_STEP_DELAY_MS);

    await ensureUnpricedFilter(detailPage);
    let filteredProductState = await waitForProductRowsOrEmpty(detailPage, 60000);
    let textAfterFilter = filteredProductState.text;
    let productRows = filteredProductState.rows;
    if (textAfterFilter.includes('暂无数据') || productRows.length === 0) {
      log('筛选后没有未设置秒杀价商品，跳过 1000 条/页切换。');
    } else if (allFilteredProductsVisible(textAfterFilter, productRows)) {
      log('筛选后的商品已全部可见，跳过 1000 条/页切换。');
    } else {
      await selectPageSize1000(detailPage);
      filteredProductState = await waitForProductRowsOrEmpty(detailPage, 60000);
      textAfterFilter = filteredProductState.text;
      productRows = filteredProductState.rows;
    }
    lastUnpricedProducts = productRows.length;
    if (textAfterFilter.includes('暂无数据') || productRows.length === 0) {
      if (submitted || attempt > 1) {
        log('重新检查后未设置秒杀价产品为 0 条，当前活动没有剩余失败商品。');
        submitResult = { failedCount: 0, submitRounds: attempt - 1 };
        break;
      }

      log('未设置秒杀价产品为 0 条，本活动无需提交。');
      await leaveActivityDetailPage(browser, listPage, detailPage);
      return {
        activityTitle: resultTitle,
        activityId: activity.id,
        addedProducts: totalAddedProducts,
        unpricedProducts: 0,
        submitted: false,
        failedCount: 0,
      };
    }

    await selectAllFilteredProducts(detailPage);
    await applyDiscount(detailPage, discount);
    submitResult = await submitActivity(detailPage);
    submitted = true;
    if (submitResult.failedCount <= 0) {
      break;
    }

    if (attempt >= MAX_FAILURE_RETRY_ROUNDS) {
      throw new Error(`已重新处理当前秒杀活动 ${MAX_FAILURE_RETRY_ROUNDS} 轮，仍有失败商品：${submitResult.failedCount}`);
    }
    log(`当前活动还有 ${submitResult.failedCount} 个失败商品，准备重新处理当前活动。`);
  }

  await leaveActivityDetailPage(browser, listPage, detailPage);

  return {
    activityTitle: resultTitle,
    activityId: activity.id,
    addedProducts: totalAddedProducts,
    unpricedProducts: lastUnpricedProducts,
    submitted,
    failedCount: submitResult.failedCount,
  };
}

function buildFailedActivityResult(activity = {}, activityError) {
  const errorMessage = activityError && activityError.message
    ? activityError.message
    : String(activityError || '秒杀活动处理失败');
  return {
    activityTitle: activity.title || '',
    activityId: activity.id || '',
    addedProducts: 0,
    unpricedProducts: 0,
    submitted: null,
    failedCount: 1,
    error: errorMessage,
    stage: 'flash-activity',
  };
}

async function run() {
  const args = parseArgs();
  let browser = null;
  const results = [];
  const processedActivityKeys = new Set();
  args.skipActivityIds.forEach((activityId) => processedActivityKeys.add(normalizeText(activityId)));
  const runState = {
    completed: 0,
    total: args.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? 0 : args.count,
  };
  const failureContext = {
    stage: 'launch',
    label: '启动浏览器',
  };

  try {
    browser = await puppeteer.launch({
      executablePath: getChromeExecutablePath(),
      headless: args.headless,
      userDataDir: getProfileDir(),
      defaultViewport: null,
      args: [
        `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
      ],
    });
    activeBrowser = browser;

    const pages = await browser.pages();
    let listPage = pages[0] || await browser.newPage();
    listPage.setDefaultTimeout(DEFAULT_TIMEOUT);
    listPage.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
    await ensureLargeBrowserViewport(listPage);

    failureContext.stage = 'login';
    failureContext.label = '登录妙手';
    await ensureLoggedIn(listPage);
    failureContext.stage = 'activity-list';
    failureContext.label = '秒杀活动列表';
    await listPage.goto(FLASH_SALE_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    await waitForFlashSaleListReady(listPage, DEFAULT_TIMEOUT);
    const runningState = await clickRunningTab(listPage);
    const activityListPageSizeReady = await selectActivityListPageSize100(listPage);
    const allRunningActivities = await collectRunningActivityQueue(listPage, runningState.count, { allowPagination: !activityListPageSizeReady });
    if (allRunningActivities.length === 0) {
      throw new Error('没有找到进行中的秒杀活动。');
    }
    const candidateRunningActivities = allRunningActivities.filter((item) => !hasProcessedActivity(processedActivityKeys, item.activity));
    const activityQueue = args.flashSelectionMode === FLASH_SELECTION_MODE_IDS
      ? args.activityIds.map((activityId) => {
        const matched = candidateRunningActivities.find((item) => String(item.activity && item.activity.id) === String(activityId));
        if (!matched) {
          return null;
        }
        return matched;
      }).filter(Boolean)
      : (args.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? candidateRunningActivities : candidateRunningActivities.slice(0, args.count));
    if (args.flashSelectionMode === FLASH_SELECTION_MODE_IDS && activityQueue.length !== args.activityIds.length) {
      const foundIds = new Set(activityQueue.map((item) => String(item.activity && item.activity.id)));
      const missingIds = args.activityIds.filter((id) => !foundIds.has(String(id)));
      throw new Error(`没有找到指定秒杀活动：${missingIds.join('、')}`);
    }
    const requestedText = args.flashSelectionMode === FLASH_SELECTION_MODE_IDS
      ? `指定活动 ${args.activityIds.length} 个`
      : (args.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? '全部进行中活动' : `${args.count} 个`);
    log(`已确认本页共获取 ${allRunningActivities.length} 个进行中活动，已跳过处理过的活动 ${args.skipActivityIds.length} 个，本次计划处理 ${requestedText}，实际队列 ${activityQueue.length} 个。`);
    runState.total = activityQueue.length;
    emitProgress({
      phase: 'flash',
      phaseLabel: '秒杀活动',
      completed: 0,
      total: runState.total,
      totalCount: runState.total,
      detailId: '',
      overallPercent: 0,
    });

    for (const target of activityQueue) {
      failureContext.stage = 'process-activity';
      failureContext.label = target.activity.title || target.activity.id || '秒杀活动';
      listPage = await ensureActivityListPage(browser, listPage, { quiet: true, resetScroll: true });
      log('已回到最开始的秒杀活动列表页，准备寻找下一个活动。');

      markProcessedActivity(processedActivityKeys, target.activity);
      let progressResult = null;
      try {
        const result = await processActivity(browser, listPage, target.activity, runState);
        listPage = await ensureActivityListPage(browser, listPage, { quiet: true, resetScroll: true });
        markProcessedActivity(processedActivityKeys, result);
        results.push(result);
        progressResult = result;
      } catch (activityError) {
        await saveFlashFailureArtifacts(browser, failureContext, activityError);
        const failedResult = buildFailedActivityResult(target.activity, activityError);
        results.push(failedResult);
        markProcessedActivity(processedActivityKeys, failedResult);
        progressResult = failedResult;
        log(`秒杀活动处理失败，已记录失败并继续后续活动：${failedResult.activityTitle || failedResult.activityId || '未知活动'}；${failedResult.error}`);
        listPage = await ensureActivityListPage(browser, listPage, { quiet: true, resetScroll: true }).catch((recoverError) => {
          log(`失败活动后回到秒杀列表页失败，将在下一轮继续尝试恢复：${recoverError.message || String(recoverError)}`);
          return listPage;
        });
      }
      runState.completed += 1;
      emitProgress({
        phase: 'flash',
        phaseLabel: '秒杀活动',
        completed: runState.completed,
        total: runState.total,
        totalCount: runState.total,
        detailId: progressResult && progressResult.activityId,
        detailName: progressResult && progressResult.activityTitle,
        processedActivity: true,
        overallPercent: Math.round((runState.completed / runState.total) * 100),
      });
    }

    const failedCount = results.filter((item) => item.failedCount > 0).length;
    console.log(JSON.stringify({
      totalCount: results.length,
      requestedCount: args.flashSelectionMode === FLASH_SELECTION_MODE_ALL ? activityQueue.length : args.count,
      flashSelectionMode: args.flashSelectionMode,
      successCount: results.length - failedCount,
      errorCount: failedCount,
      skippedCount: results.filter((item) => item.submitted === false).length,
      mode: 'flash-sale',
      results,
    }));
  } catch (error) {
    await saveFlashFailureArtifacts(browser, failureContext, error);
    throw error;
  } finally {
    if (browser) {
      await closeBrowserWithTimeout(browser);
      if (activeBrowser === browser) {
        activeBrowser = null;
      }
    }
  }
}

run().catch((error) => {
  log(error.stack || error.message || String(error));
  process.exitCode = 1;
});
