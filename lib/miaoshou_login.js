const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_TIMEOUT = 30000;
const LOGIN_TIMEOUT = 10 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeFilePart(value = '') {
  return String(value || 'captcha').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'captcha';
}

function getRunId() {
  return process.env.MIAOSHOU_RUN_ID || 'manual';
}

function getCaptchaDir() {
  return process.env.MIAOSHOU_CAPTCHA_DIR || path.join(__dirname, '..', '.captcha');
}

function captchaResponsePath(captchaId) {
  return path.join(getCaptchaDir(), `captcha-response-${safeFilePart(captchaId)}.json`);
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

function hasLoginCueText(text = '') {
  const normalized = normalizeText(text);
  return /立即登录|扫码登录|账号登录|密码登录|忘记密码|手机号\/子账号\/邮箱|请输入.*(手机号|手机|账号|邮箱|密码|验证码)/.test(normalized);
}

function isLoginUrl(url = '') {
  return /\/login|passport|signin/i.test(String(url || ''));
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
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
      await sleep(700);
    }
  }
  throw lastError;
}

async function waitForMiaoshouPageCheckpoint(page, readyText, timeout = DEFAULT_TIMEOUT) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const text = await bodyText(page);
    const url = page.url();
    if (readyText && text.includes(readyText) && !hasLoginCueText(text)) {
      return { state: 'ready', text, url };
    }
    if (hasLoginCueText(text) || isLoginUrl(url)) {
      return { state: 'login', text, url };
    }
    await sleep(500);
  }

  return { state: 'unknown', text: await bodyText(page), url: page.url() };
}

async function clickText(page, text, options = {}) {
  const exact = options.exact !== false;
  const selector = options.selector || 'button, label, span, div, a, li';
  const clicked = await page.evaluate(({ text, exact, selector }) => {
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
    const element = matches[0];
    if (!element) return false;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
    return true;
  }, { text, exact, selector });

  if (!clicked) {
    throw new Error(`没有找到可点击文本：${text}`);
  }
  await sleep(options.afterClickMs || 500);
}

async function tryClickText(page, text, options = {}) {
  try {
    await clickText(page, text, options);
    return true;
  } catch (_error) {
    return false;
  }
}

async function setInputByPlaceholder(page, placeholder, value) {
  return page.evaluate(({ placeholder, value }) => {
    const input = Array.from(document.querySelectorAll('input'))
      .find((item) => String(item.placeholder || '').includes(placeholder));
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { placeholder, value });
}

async function setInputByHints(page, hints = [], value, options = {}) {
  return page.evaluate(({ hints, value, type }) => {
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

async function switchToPasswordLogin(page) {
  const candidates = ['账号登录', '密码登录', '账号密码登录', '手机号登录', '其他方式登录'];
  for (const text of candidates) {
    const clicked = await tryClickText(page, text, { exact: false, afterClickMs: 800 });
    if (!clicked) {
      continue;
    }
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
    if (hasPhoneInput) {
      return true;
    }
  }
  return false;
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
    const unionRects = (rects) => {
      const valid = rects
        .filter(Boolean)
        .map(normalizedRect)
        .filter((rect) => rect.width > 0 && rect.height > 0);
      if (!valid.length) return null;
      const left = Math.min(...valid.map((rect) => rect.left));
      const top = Math.min(...valid.map((rect) => rect.top));
      const right = Math.max(...valid.map((rect) => rect.right));
      const bottom = Math.max(...valid.map((rect) => rect.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
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
        if (inputRect) {
          const centerY = rect.top + rect.height / 2;
          const inputCenterY = inputRect.top + inputRect.height / 2;
          score += Math.max(0, 240 - Math.abs(centerY - inputCenterY));
          score += rect.left >= inputRect.left - 40 ? 80 : 0;
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

    const nearbyVisuals = visuals
      .filter((item) => item.score > 0)
      .filter((item) => !inputRect || (
        item.rect.top <= inputRect.bottom + 180
        && item.rect.bottom >= inputRect.top - 180
        && item.rect.left <= inputRect.right + 520
        && item.rect.right >= inputRect.left - 180
      ))
      .slice(0, 3)
      .map((item) => item.rect);

    let targetRect = null;
    if (inputRect) {
      const labelRects = Array.from(document.querySelectorAll('label, span, div'))
        .filter(isVisible)
        .filter((element) => /验证码|校验码/.test((element.innerText || element.textContent || '').replace(/\s+/g, '')))
        .map((element) => normalizedRect(element.getBoundingClientRect()))
        .filter((rect) => rect.top <= inputRect.bottom + 120 && rect.bottom >= inputRect.top - 120);
      targetRect = unionRects([inputRect, ...nearbyVisuals, ...labelRects]);
      if (formRect && (!targetRect || targetRect.width < 180 || targetRect.height < 70)) {
        targetRect = formRect;
      }
    } else if (nearbyVisuals.length) {
      targetRect = unionRects(nearbyVisuals);
    }
    if (!targetRect) return null;

    const padding = 24;
    const x = Math.max(0, Math.floor(targetRect.left - padding));
    const y = Math.max(0, Math.floor(targetRect.top - padding));
    const width = Math.min(window.innerWidth - x, Math.max(260, Math.ceil(targetRect.width + padding * 2)));
    const height = Math.min(window.innerHeight - y, Math.max(120, Math.ceil(targetRect.height + padding * 2)));
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  });

  try {
    if (clip) {
      await page.screenshot({ path: imagePath, clip });
    } else {
      await page.screenshot({ path: imagePath, fullPage: false });
    }
  } catch (_error) {
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

function buildLoginUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return `https://erp.91miaoshou.com/?redirect=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
  } catch (_error) {
    return 'https://erp.91miaoshou.com/';
  }
}

async function ensureMiaoshouLoggedIn(page, targetUrl, readyText, options = {}) {
  const phone = process.env.MIAOSHOU_LOGIN_PHONE || process.env.MIAOSHOU_ACCOUNT_LABEL || '';
  const password = process.env.MIAOSHOU_LOGIN_PASSWORD || '';
  if (!phone || !password) {
    throw new Error('需要先配置妙手登录手机号和密码。');
  }

  if (!hasLoginCueText(await bodyText(page)) && !isLoginUrl(page.url())) {
    await page.goto(buildLoginUrl(targetUrl), { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    const checkpoint = await waitForMiaoshouPageCheckpoint(page, readyText, DEFAULT_TIMEOUT);
    if (checkpoint.state === 'ready') {
      log(`妙手账号已登录，已进入${options.pageLabel || readyText || '目标页面'}。`);
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
  await clickText(page, '立即登录', { selector: 'button', exact: true, afterClickMs: 1200 })
    .catch(() => log('登录按钮暂时不可点，继续等待页面状态。'));

  const startedAt = Date.now();
  while (Date.now() - startedAt < LOGIN_TIMEOUT) {
    const text = await bodyText(page);
    if (readyText && text.includes(readyText) && !hasLoginCueText(text)) {
      log('妙手登录已完成。');
      return;
    }
    if (hasLoginCueText(text) && await fillCaptchaIfPresent()) {
      await clickText(page, '立即登录', { selector: 'button', exact: true, afterClickMs: 1200 }).catch(() => {});
      continue;
    }
    if (!hasLoginCueText(text) && !isLoginUrl(page.url())) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => {});
      const checkpoint = await waitForMiaoshouPageCheckpoint(page, readyText, 8000);
      if (checkpoint.state === 'ready') {
        log('妙手登录已完成。');
        return;
      }
    }
    await sleep(1500);
  }

  throw new Error('等待妙手登录超时。请确认网页验证码已输入并登录成功。');
}

async function openMiaoshouPageWithLogin(page, targetUrl, options = {}) {
  const readyText = options.readyText || '';
  const pageLabel = options.pageLabel || readyText || '目标页面';
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: options.timeout || DEFAULT_TIMEOUT });
  const checkpoint = await waitForMiaoshouPageCheckpoint(page, readyText, options.timeout || DEFAULT_TIMEOUT);
  if (checkpoint.state === 'ready') {
    return checkpoint;
  }

  if (checkpoint.state !== 'login') {
    const snippet = normalizeText(checkpoint.text).slice(0, 120);
    throw new Error(`${pageLabel}加载超时，且没有识别到登录页。当前页面：${checkpoint.url} ${snippet}`);
  }

  log(`妙手需要登录后才能进入${pageLabel}。`);
  await ensureMiaoshouLoggedIn(page, targetUrl, readyText, { pageLabel });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: options.timeout || DEFAULT_TIMEOUT });
  const finalCheckpoint = await waitForMiaoshouPageCheckpoint(page, readyText, options.timeout || DEFAULT_TIMEOUT);
  if (finalCheckpoint.state !== 'ready') {
    const snippet = normalizeText(finalCheckpoint.text).slice(0, 120);
    throw new Error(`${pageLabel}登录后仍未加载完成。当前页面：${finalCheckpoint.url} ${snippet}`);
  }
  return finalCheckpoint;
}

module.exports = {
  hasLoginCueText,
  openMiaoshouPageWithLogin,
};
