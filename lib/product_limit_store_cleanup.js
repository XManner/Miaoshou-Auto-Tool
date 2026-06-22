const { openMiaoshouPageWithLogin } = require('./miaoshou_login');

const PRODUCT_LIMIT_REASON_PATTERNS = Object.freeze([
  '商店试用期',
  '最多只能使用1000个产品列表',
]);
const DEFAULT_ZERO_SALES_RETAIN_COUNT = 900;
const ZERO_SALES_UNPUBLISH_THRESHOLD = DEFAULT_ZERO_SALES_RETAIN_COUNT;
const MAX_ZERO_SALES_CLEANUP_ROUNDS = 20;
const DEFAULT_NETWORK_SETTLE_TIMEOUT_MS = 4000;
const DEFAULT_NETWORK_IDLE_MS = 600;
const STORE_OPTION_TEXT_PATTERN = /^(.*?)\s*-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)\s*$/;
const PUBLISH_HISTORY_URL = 'https://erp.91miaoshou.com/tiktok/move_collect/history?status=fail';
const SHOP_PRODUCTS_URL = 'https://erp.91miaoshou.com/tiktok/item/item';

function matchesProductLimitFailureReason(reason = '') {
  const normalizedReason = String(reason || '').replace(/\s+/g, '');
  return PRODUCT_LIMIT_REASON_PATTERNS.every((pattern) => normalizedReason.includes(pattern));
}

function normalizeZeroSalesRetainCount(value = DEFAULT_ZERO_SALES_RETAIN_COUNT) {
  const raw = value === '' || value === null || value === undefined
    ? DEFAULT_ZERO_SALES_RETAIN_COUNT
    : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('保留数量必须是大于等于 0 的整数。');
  }
  return parsed;
}

function shouldSkipUnpublishByZeroSalesCount(count, retainCount = DEFAULT_ZERO_SALES_RETAIN_COUNT) {
  if (count === null || count === undefined || count === '') {
    return false;
  }
  const numericCount = Number(count);
  const normalizedRetainCount = normalizeZeroSalesRetainCount(retainCount);
  return Number.isFinite(numericCount)
    && numericCount >= 0
    && numericCount <= normalizedRetainCount;
}

function looksLikeSelectedStoreText(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return STORE_OPTION_TEXT_PATTERN.test(text) || /^\+\s*\d+$/.test(text);
}

function parseVisibleProductResultCountFromTexts(texts = []) {
  const candidates = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || '').replace(/[,，]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const onSaleCandidates = candidates.filter((text) => /在售中/.test(text));
  const orderedCandidates = [
    ...onSaleCandidates,
    ...candidates.filter((text) => !onSaleCandidates.includes(text)),
  ];
  const patterns = [
    /在售中\s*(?:[（(]\s*)?(\d+)(?:\s*[）)])?/,
    /共\s*(\d+)\s*(?:条|项|个|件)/,
    /(?:^|\s)(\d+)\s*条(?!\s*\/)(?:\s|$)/,
    /total\s*[:：]?\s*(\d+)/i,
  ];

  for (const text of orderedCandidates) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
  }

  return null;
}

function parseProductPageSizeFromTexts(texts = []) {
  const candidates = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const text of candidates) {
    const matches = [...text.matchAll(/(\d+)\s*条\s*\/\s*页/g)];
    if (matches.length > 0) {
      return Number.parseInt(matches[matches.length - 1][1], 10);
    }
  }

  return null;
}

function normalizeStoreName(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)\s*$/, '')
    .trim();
}

function hasExplicitStoreOptionText(value = '') {
  return STORE_OPTION_TEXT_PATTERN.test(String(value || '').replace(/\s+/g, ' ').trim());
}

function normalizeStoreOptionText(value = '') {
  const normalizedValue = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalizedValue) {
    return '';
  }

  const suffixMatch = normalizedValue.match(STORE_OPTION_TEXT_PATTERN);
  const storeName = normalizeStoreName(normalizedValue);
  if (!storeName) {
    return '';
  }

  if (suffixMatch) {
    return [storeName, suffixMatch[2]].join('-');
  }

  return '';
}

function resolveStoreTarget(store = {}, explicitStoreOptionText = '') {
  const rawStore = store && typeof store === 'object' ? store : { storeName: store };
  const optionCandidate = explicitStoreOptionText || rawStore.storeOptionText || rawStore.optionText || '';
  const storeOptionText = normalizeStoreOptionText(optionCandidate);
  const storeName = normalizeStoreName(rawStore.storeName || rawStore.shopName || storeOptionText || optionCandidate);

  return {
    storeName,
    storeOptionText,
  };
}

function resolveManualStoreTargets(stores = []) {
  return (Array.isArray(stores) ? stores : [])
    .map((store) => {
      const rawStore = store && typeof store === 'object' ? store : { storeName: store };
      const candidate = rawStore.storeOptionText
        || rawStore.optionText
        || rawStore.storeName
        || rawStore.shopName
        || '';
      const target = resolveStoreTarget({
        ...rawStore,
        storeName: rawStore.storeName || rawStore.shopName || candidate,
        storeOptionText: hasExplicitStoreOptionText(candidate) ? candidate : rawStore.storeOptionText,
      });
      return {
        ...target,
        failureCount: 1,
      };
    })
    .filter((target) => target.storeName);
}

function dedupeLimitStoreRecords(records = []) {
  const countsByStoreName = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const reason = (record || {}).reason || (record || {}).failureReason;
    if (!matchesProductLimitFailureReason(reason)) {
      continue;
    }

    const storeName = normalizeStoreName((record || {}).storeName || (record || {}).shopName);
    if (!storeName) {
      continue;
    }

    countsByStoreName.set(storeName, (countsByStoreName.get(storeName) || 0) + 1);
  }

  return [...countsByStoreName.entries()].map(([storeName, failureCount]) => ({
    storeName,
    failureCount,
  }));
}

function buildMatchedLimitStoreRecords(records = []) {
  const countsByStoreOptionText = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const reason = (record || {}).reason || (record || {}).failureReason;
    if (!matchesProductLimitFailureReason(reason)) {
      continue;
    }

    const target = resolveStoreTarget({
      storeName: (record || {}).storeName || (record || {}).shopName,
      storeOptionText: (record || {}).storeOptionText,
    });
    if (!target.storeName) {
      continue;
    }

    const dedupeKey = target.storeName;
    const current = countsByStoreOptionText.get(dedupeKey) || {
      ...target,
      failureCount: 0,
    };
    current.failureCount += 1;
    countsByStoreOptionText.set(dedupeKey, current);
  }

  return [...countsByStoreOptionText.values()];
}

function buildLimitStoreSummary({
  scannedFailureRecords = 0,
  matchedStores = [],
  results = [],
  failedItems = [],
  retainCount = DEFAULT_ZERO_SALES_RETAIN_COUNT,
} = {}) {
  const safeMatchedStores = Array.isArray(matchedStores) ? matchedStores : [];
  const safeResults = Array.isArray(results) ? results : [];
  const normalizedRetainCount = normalizeZeroSalesRetainCount(retainCount);

  return {
    mode: 'product-limit-store-unpublish',
    retainCount: normalizedRetainCount,
    scannedFailureRecords,
    matchedStores: safeMatchedStores,
    matchedStoreCount: safeMatchedStores.length,
    processedStoreCount: safeResults.filter((result) => !result.skipped && !result.error).length,
    unpublishedCount: safeResults.reduce((total, result) => (
      typeof result.unpublishedCount === 'number' && Number.isFinite(result.unpublishedCount)
        ? total + result.unpublishedCount
        : total
    ), 0),
    skippedStores: safeResults
      .filter((result) => result.skipped)
      .map((result) => {
        const skippedStore = {
          storeName: result.storeName || result.shopName || '',
          reason: result.reason || '已跳过',
        };
        if (Object.prototype.hasOwnProperty.call(result, 'storeOptionText')) {
          skippedStore.storeOptionText = result.storeOptionText || '';
        }
        return skippedStore;
      }),
    failedItems: Array.isArray(failedItems) ? failedItems : [],
    results: safeResults,
  };
}

function emitProgress(event = {}) {
  process.stderr.write(`MIAOSHOU_PROGRESS ${JSON.stringify(event)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNavigationContextError(error) {
  const message = String(error && error.message ? error.message : error || '');
  return message.includes('Execution context was destroyed')
    || message.includes('Cannot find context with specified id')
    || message.includes('Inspected target navigated or closed')
    || message.includes('Attempted to use detached Frame')
    || message.includes('detached Frame');
}

async function waitForNetworkQuiet(page, timeout = DEFAULT_NETWORK_SETTLE_TIMEOUT_MS) {
  if (page && typeof page.waitForNetworkIdle === 'function') {
    await page.waitForNetworkIdle({ idleTime: DEFAULT_NETWORK_IDLE_MS, timeout }).catch(() => {});
    return;
  }
  await sleep(500);
}

async function waitForVisibleText(page, text, timeout = 15000) {
  await page.waitForFunction((needle) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    return Array.from(document.querySelectorAll('body *')).some((element) => (
      isVisible(element)
        && String(element.innerText || element.textContent || '').includes(needle)
    ));
  }, { timeout }, text);
}

async function hasVisibleText(page, text, timeout = 1000) {
  try {
    await waitForVisibleText(page, text, timeout);
    return true;
  } catch (_error) {
    return false;
  }
}

async function clickByText(page, text, { exact = false, timeout = 15000 } = {}) {
  await page.waitForFunction((needle, matchExact) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const matches = (element) => {
      const value = String(element.innerText || element.textContent || element.value || '').trim();
      return matchExact ? value === needle : value.includes(needle);
    };

    return Array.from(document.querySelectorAll('button, a, li, span, div, label'))
      .some((element) => isVisible(element) && matches(element));
  }, { timeout }, text, exact);

  const clicked = await page.evaluate((needle, matchExact) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const matches = (element) => {
      const value = String(element.innerText || element.textContent || element.value || '').trim();
      return matchExact ? value === needle : value.includes(needle);
    };

    const priority = (element) => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a') {
        return 0;
      }
      if (tag === 'li' || element.getAttribute('role') === 'option') {
        return 1;
      }
      return 2;
    };

    const candidates = Array.from(document.querySelectorAll('button, a, li, span, div, label'))
      .filter((element) => isVisible(element) && matches(element))
      .sort((left, right) => priority(left) - priority(right));
    const target = candidates[0];
    if (!target) {
      return false;
    }
    target.click();
    return true;
  }, text, exact);

  if (!clicked) {
    throw new Error(`没有找到可点击文本：${text}`);
  }
}

async function fillInputsNearText(page, labelText, values = []) {
  const inputBoxes = await page.evaluate((needle, maxCount) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const textElements = Array.from(document.querySelectorAll('label, span, div, td, th'))
      .filter((element) => isVisible(element)
        && String(element.innerText || element.textContent || '').includes(needle))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          element,
          text,
          score: (text === needle ? 0 : text.length) + (rect.width * rect.height) / 10000,
        };
      })
      .sort((left, right) => left.score - right.score);
    const labelElement = textElements[0] && textElements[0].element;
    if (!labelElement) {
      return [];
    }

    const inputSelector = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled])';
    const labelRect = labelElement.getBoundingClientRect();
    const relatedRoot = labelElement.closest('form, .ant-form-item, .el-form-item, .filter-item, .search-item')
      || labelElement.parentElement
      || document.body;
    const rootInputs = Array.from(relatedRoot.querySelectorAll(inputSelector)).filter(isVisible);
    const allInputs = Array.from(document.querySelectorAll(inputSelector)).filter(isVisible);
    const inputs = (rootInputs.length > 0 ? rootInputs : allInputs)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        return {
          input,
          distance: Math.abs(rect.top - labelRect.top) + Math.abs(rect.left - labelRect.left),
        };
      })
      .sort((left, right) => left.distance - right.distance)
      .map((entry) => entry.input)
      .slice(0, maxCount);

    return inputs.map((input) => {
      const rect = input.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });
  }, labelText, values.length);

  if (inputBoxes.length < values.length) {
    throw new Error(`没有找到足够的${labelText}输入框`);
  }

  for (let index = 0; index < values.length; index += 1) {
    const inputBox = inputBoxes[index];
    const value = String(values[index]);
    await page.mouse.click(inputBox.x, inputBox.y);
    await sleep(80);
    await clearFocusedTextInputWithKeyboard(page);
    await page.keyboard.type(value, { delay: 20 });
    await blurFocusedInput(page);
    await sleep(120);
  }

  return inputBoxes.length;
}

async function fillFirstVisibleInputNearText(page, labelText, value) {
  await fillInputsNearText(page, labelText, [value]);
}

async function clearFocusedTextInputWithKeyboard(page) {
  const focusedEditable = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return false;
    }
    const tag = String(active.tagName || '').toLowerCase();
    return tag === 'input'
      || tag === 'textarea'
      || active.getAttribute('contenteditable') === 'true';
  });
  if (!focusedEditable) {
    throw new Error('店铺搜索输入框没有成功聚焦');
  }

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(modifier);
  await page.keyboard.press('A');
  await page.keyboard.up(modifier);
  await page.keyboard.press('Backspace');
}

async function blurFocusedInput(page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return;
    }
    const tag = String(active.tagName || '').toLowerCase();
    const editable = tag === 'input'
      || tag === 'textarea'
      || active.getAttribute('contenteditable') === 'true';
    if (!editable || typeof active.blur !== 'function') {
      return;
    }
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    active.blur();
  });
}

async function collectStoreDropdownDebug(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || element.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dropdownRootSelector = [
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.el-select-dropdown:not([style*="display: none"])',
      '.custom-select-dropdown',
      '.ms-select-dropdown',
      '.select-dropdown',
      '.dropdown-menu',
      '.el-popper',
      '.ant-dropdown',
      '[role="listbox"]',
    ].join(', ');
    const optionSelector = [
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '[role="option"]',
      'li',
      'label',
      'span',
      'div',
    ].join(', ');
    const active = document.activeElement;
    const inputValues = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'))
      .filter(isVisible)
      .map((input) => ({
        value: String(input.value || ''),
        placeholder: String(input.getAttribute('placeholder') || ''),
        role: String(input.getAttribute('role') || ''),
        active: input === active,
      }))
      .slice(0, 12);
    const dropdownOptions = Array.from(document.querySelectorAll(dropdownRootSelector))
      .filter(isVisible)
      .flatMap((root) => Array.from(root.querySelectorAll(optionSelector))
        .filter(isVisible)
        .map(textOf)
        .filter(Boolean))
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 30);
    const selectedTags = Array.from(document.querySelectorAll([
      '.ant-select-selection-item',
      '.ant-select-selection-choice',
      '.el-tag',
      '.selected-tag',
      '.tag',
    ].join(', ')))
      .filter(isVisible)
      .map(textOf)
      .filter(Boolean)
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 20);
    return {
      activeTag: active ? String(active.tagName || '').toLowerCase() : '',
      activeValue: active && 'value' in active ? String(active.value || '') : '',
      inputValues,
      dropdownOptions,
      selectedTags,
    };
  });
}

function formatStoreDropdownDebug(debug = {}) {
  const inputValues = Array.isArray(debug.inputValues) ? debug.inputValues : [];
  const dropdownOptions = Array.isArray(debug.dropdownOptions) ? debug.dropdownOptions : [];
  const selectedTags = Array.isArray(debug.selectedTags) ? debug.selectedTags : [];
  const inputText = inputValues
    .map((input, index) => `#${index + 1}${input.active ? '*' : ''}="${input.value || ''}" placeholder="${input.placeholder || ''}"`)
    .join('；') || '无可见输入框';
  const optionText = dropdownOptions.length ? dropdownOptions.join(' | ') : '无候选项';
  const selectedText = selectedTags.length ? selectedTags.join(' | ') : '无已选标签';
  return `输入框实际值：${inputText}；下拉候选：${optionText}；已选标签：${selectedText}`;
}

async function enterStoreSearchText(page, storeSearchText) {
  const result = await page.evaluate((value) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && !element.disabled
        && !element.readOnly;
    };
    const inputSelector = [
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) input:not([type="hidden"]):not([disabled])',
      '.el-select-dropdown:not([style*="display: none"]) input:not([type="hidden"]):not([disabled])',
      '.ant-select-selector .ant-select-selection-search-input',
      '.ant-select-selector input[role="combobox"]',
      '.el-select__wrapper input:not([type="hidden"]):not([disabled])',
      '.el-input input:not([type="hidden"]):not([disabled])',
      'input[role="combobox"]:not([type="hidden"]):not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
    ].join(', ');
    const active = document.activeElement;
    const candidates = [
      active && active.matches && active.matches('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])') ? active : null,
      ...Array.from(document.querySelectorAll(inputSelector)),
    ].filter((input, index, all) => input && all.indexOf(input) === index && isVisible(input));
    const input = candidates[0];
    if (!input) {
      return {
        ok: false,
        reason: '没有找到可写入的店铺搜索输入框',
        value: '',
      };
    }

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    input.focus({ preventScroll: true });
    if (setter && input instanceof window.HTMLInputElement) {
      setter.call(input, '');
    } else {
      input.value = '';
    }
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward',
      data: null,
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (setter && input instanceof window.HTMLInputElement) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: value,
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key: value.slice(-1) || ' ',
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: true,
      value: String(input.value || ''),
      placeholder: String(input.getAttribute('placeholder') || ''),
      role: String(input.getAttribute('role') || ''),
    };
  }, storeSearchText);

  await sleep(500);
  const actualValue = String(result && result.value ? result.value : '').trim();
  if (!result || !result.ok || !actualValue.includes(storeSearchText)) {
    const debug = await collectStoreDropdownDebug(page);
    throw new Error(`店铺名没有写入店铺搜索输入框：目标="${storeSearchText}"，${formatStoreDropdownDebug(debug)}`);
  }
}

async function getStoreSelectorControlBox(page, mode = 'selector') {
  return page.evaluate((targetMode) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const textOf = (element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const inputTextOf = (element) => Array.from(element.querySelectorAll('input, textarea'))
      .map((input) => `${input.getAttribute('placeholder') || ''} ${input.value || ''}`)
      .join(' ');
    const selectorTextOf = (element) => `${textOf(element)} ${inputTextOf(element)}`.replace(/\s+/g, ' ').trim();
    const sameRow = (left, right) => {
      const verticalGap = Math.abs((left.top + left.height / 2) - (right.top + right.height / 2));
      return verticalGap <= Math.max(18, Math.min(left.height, right.height));
    };
    const isTypeSelectorText = (value) => /^(请选择|店铺|店铺分组)$/.test(String(value || '').replace(/\s+/g, ' ').trim());
    const optionLikeText = /菲律宾|马来|泰国|越南|新加坡|印尼|\b(PH|MY|TH|VN|SG|IDN|ID)\b/i;
    const nonStoreText = /类目|平台SKU|货源ID|产品ID|条\/页/;

    const visibleSelectors = Array.from(document.querySelectorAll(
      '.ant-select-selector, .el-select__wrapper, .el-input',
    ))
      .filter(isVisible)
      .map((selector) => {
        const root = selector.closest('.ant-select, .el-select') || selector;
        const rect = selector.getBoundingClientRect();
        return {
          selector,
          root,
          rect,
          text: selectorTextOf(selector),
          rootText: selectorTextOf(root),
        };
      })
      .filter((entry) => !entry.root.closest('.ant-pagination, .el-pagination'));

    const fieldTypeSelectors = visibleSelectors.filter((entry) => (
      entry.rect.width <= 260
        && isTypeSelectorText(entry.text)
        && !nonStoreText.test(entry.rootText)
    ));

    const categoryLabel = Array.from(document.querySelectorAll('label, span, div'))
      .filter(isVisible)
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        text: textOf(element),
      }))
      .filter((entry) => /^类目[:：]?$/.test(entry.text) || entry.text === '类目')
      .sort((left, right) => left.rect.left - right.rect.left)[0];
    const categoryLeft = categoryLabel ? categoryLabel.rect.left : Infinity;

    const scoreStoreSelector = (entry) => {
      const { rect, selector, text, rootText } = entry;
      const combinedText = `${text} ${rootText}`;
      let score = 0;

      if (nonStoreText.test(combinedText)) {
        return Number.NEGATIVE_INFINITY;
      }
      if (rect.left >= categoryLeft - 8) {
        return Number.NEGATIVE_INFINITY;
      }

      for (const typeSelector of fieldTypeSelectors) {
        if (selector === typeSelector.selector) {
          score -= 200;
          continue;
        }
        if (sameRow(rect, typeSelector.rect) && rect.left >= typeSelector.rect.right - 4) {
          score += 120;
          score -= Math.max(0, rect.left - typeSelector.rect.right) / 20;
        }
      }

      if (isTypeSelectorText(text) && rect.width <= 260) {
        score -= 180;
      }
      if (selector.querySelector('.ant-select-selection-item-remove, .ant-select-selection-choice-remove, .el-tag__close')) {
        score += 70;
      }
      if (optionLikeText.test(combinedText)) {
        score += 60;
      }
      if (selector.querySelector('.ant-select-selection-search-input, input[role="combobox"], input:not([type="hidden"]):not([disabled])')) {
        score += 24;
      }
      if (rect.width >= 300) {
        score += 20;
      }
      if (/店铺|店铺名/.test(combinedText)) {
        score += 10;
      }

      if (rect.top < window.innerHeight * 0.65) {
        score += 6;
      } else {
        score -= 20;
      }

      return score - (rect.top / 100);
    };

    const target = visibleSelectors
      .map((entry) => ({
        ...entry,
        score: scoreStoreSelector(entry),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score)[0];

    if (!target) {
      return null;
    }

    const selectorRect = target.selector.getBoundingClientRect();
    if (targetMode === 'selector') {
      return {
        x: selectorRect.left + selectorRect.width / 2,
        y: selectorRect.top + selectorRect.height / 2,
      };
    }

    const closeSelector = [
      '.ant-select-selection-item-remove',
      '.ant-select-selection-choice-remove',
      '.el-tag__close',
      '.ant-select-clear',
      '.el-select__caret.is-show-close',
      '.ant-select-selection-item .anticon-close',
      '.ant-select-selection-choice .anticon-close',
      '.ant-select-selection-item .anticon-close-circle',
      '.ant-select-selection-choice .anticon-close-circle',
      '.el-tag .anticon-close',
      '.el-tag .el-icon-close',
      '.el-tag .el-icon-circle-close',
      '.ms-tag-close',
      '.tag-close',
      '.select-tag-close',
      '[class*="tag"][class*="close"]',
      '[class*="close"][class*="circle"]',
      '[aria-label="close"]',
    ].join(', ');

    const seen = new Set();
    const candidates = [];
    const addCandidate = (element) => {
      if (!element || seen.has(element) || !isVisible(element)) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const isInsideSelector = rect.left >= selectorRect.left - 2
        && rect.right <= selectorRect.right + 2
        && rect.top >= selectorRect.top - 2
        && rect.bottom <= selectorRect.bottom + 2;
      if (!isInsideSelector) {
        return;
      }
      seen.add(element);
      const selectedParent = element.closest('.ant-select-selection-item, .ant-select-selection-choice, .el-tag');
      const isClearControl = element.matches('.ant-select-clear, .el-select__caret.is-show-close');
      candidates.push({
        element,
        rect,
        score: (selectedParent ? 100 : 0) + (isClearControl ? 20 : 0) - (rect.left / 10000),
      });
    };

    Array.from(target.selector.querySelectorAll(closeSelector)).forEach(addCandidate);
    Array.from(target.root.querySelectorAll(closeSelector)).forEach(addCandidate);

    const selectedTagSelectors = [
      '.ant-select-selection-item',
      '.ant-select-selection-choice',
      '.el-tag',
      '.selected-tag',
      '.tag',
    ].join(', ');
    const clickStoreOptionPattern = /-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)$/;
    if (!candidates.length) {
      Array.from(target.selector.querySelectorAll(selectedTagSelectors))
        .concat(Array.from(target.root.querySelectorAll(selectedTagSelectors)))
        .filter((element) => {
          if (!isVisible(element)) {
            return false;
          }
          const text = textOf(element);
          return clickStoreOptionPattern.test(text) || optionLikeText.test(text);
        })
        .forEach((element) => {
          const rect = element.getBoundingClientRect();
          const isInsideSelector = rect.left >= selectorRect.left - 2
            && rect.right <= selectorRect.right + 2
            && rect.top >= selectorRect.top - 2
            && rect.bottom <= selectorRect.bottom + 2;
          if (!isInsideSelector) {
            return;
          }
          candidates.push({
            element,
            rect,
            // click the selected tag right edge when the close icon is not a separate DOM node.
            x: Math.max(rect.left + 8, rect.right - 14),
            y: rect.top + rect.height / 2,
            score: 80 - (rect.left / 10000),
          });
        });
    }

    const button = candidates
      .sort((left, right) => right.score - left.score)[0];
    if (!button) {
      return null;
    }

    return {
      x: button.x || (button.rect.left + button.rect.width / 2),
      y: button.y || (button.rect.top + button.rect.height / 2),
    };
  }, mode);
}

async function clickSelectedStoreDropdownOption(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const normalize = (value) => String(value || '')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const textOf = (element) => normalize(element.innerText || element.textContent || element.getAttribute('title') || '');
    const dropdownRootSelector = [
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.el-select-dropdown:not([style*="display: none"])',
      '.custom-select-dropdown',
      '.ms-select-dropdown',
      '.select-dropdown',
      '.dropdown-menu',
      '.el-popper',
      '.ant-dropdown',
      '[role="listbox"]',
    ].join(', ');
    const selectedOptionSelector = [
      '.ant-select-item-option-selected',
      '.ant-select-item-option[aria-selected="true"]',
      '.el-select-dropdown__item.is-selected',
      '.el-select-dropdown__item.selected',
      '[role="option"][aria-selected="true"]',
      '.ant-checkbox-wrapper-checked',
      '.ant-checkbox-checked',
      '.el-checkbox.is-checked',
      '.el-checkbox__input.is-checked',
    ].join(', ');
    const optionRowSelector = [
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '[role="option"]',
      'li',
      'label',
      'div',
    ].join(', ');
    const storeOptionPattern = /-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)$/;
    const roots = Array.from(document.querySelectorAll(dropdownRootSelector)).filter(isVisible);
    const seen = new Set();
    const candidates = [];

    roots.forEach((root) => {
      Array.from(root.querySelectorAll(selectedOptionSelector)).forEach((element) => {
        const row = element.closest(optionRowSelector) || element;
        if (!row || seen.has(row) || !isVisible(row)) {
          return;
        }
        const text = textOf(row);
        if (!storeOptionPattern.test(text)) {
          return;
        }
        const rect = row.getBoundingClientRect();
        seen.add(row);
        candidates.push({
          row,
          rect,
          text,
          score: 100 + (text.includes('-') ? 40 : 0) + rect.left / 1000 - rect.top / 10000,
        });
      });
    });

    const target = candidates
      .sort((left, right) => right.score - left.score)[0];
    if (!target) {
      return false;
    }
    target.row.click();
    return true;
  });
}

async function getExistingStoreSelectionCount(page) {
  const state = await readSelectedStoreSelectionState(page);
  return state.selectedStoreCount;
}

async function readSelectedStoreSelectionState(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || element.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    const inputTextOf = (element) => Array.from(element.querySelectorAll('input, textarea'))
      .map((input) => `${input.getAttribute('placeholder') || ''} ${input.value || ''}`)
      .join(' ');
    const selectorTextOf = (element) => `${textOf(element)} ${inputTextOf(element)}`.replace(/\s+/g, ' ').trim();
    const sameRow = (left, right) => {
      const verticalGap = Math.abs((left.top + left.height / 2) - (right.top + right.height / 2));
      return verticalGap <= Math.max(18, Math.min(left.height, right.height));
    };
    const isTypeSelectorText = (value) => /^(请选择|店铺|店铺分组)$/.test(String(value || '').replace(/\s+/g, ' ').trim());
    const storeLikeText = /菲律宾|马来|泰国|越南|新加坡|印尼|\b(PH|MY|TH|VN|SG|IDN|ID)\b/i;
    const collapsedStoreSelectionCount = (value) => {
      const match = String(value || '').replace(/\s+/g, ' ').trim().match(/^\+\s*(\d+)$/);
      return match ? Number.parseInt(match[1], 10) : 0;
    };
    const looksLikeSelectedStoreText = (value) => (
      /^(.*?)\s*-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)\s*$/.test(String(value || '').replace(/\s+/g, ' ').trim())
      || collapsedStoreSelectionCount(value) > 0
    );
    const visibleSelectors = Array.from(document.querySelectorAll(
      '.ant-select-selector, .el-select__wrapper, .el-input',
    ))
      .filter(isVisible)
      .map((selector) => {
        const root = selector.closest('.ant-select, .el-select') || selector;
        const rect = selector.getBoundingClientRect();
        return {
          selector,
          root,
          rect,
          text: selectorTextOf(selector),
          rootText: selectorTextOf(root),
        };
      })
      .filter((entry) => !entry.root.closest('.ant-pagination, .el-pagination'));
    const fieldTypeSelectors = visibleSelectors.filter((entry) => (
      entry.rect.width <= 260
        && isTypeSelectorText(entry.text)
        && !/类目|平台SKU|货源ID|产品ID|条\/页/.test(entry.rootText)
    ));
    const categoryLabel = Array.from(document.querySelectorAll('label, span, div'))
      .filter(isVisible)
      .map((element) => ({
        rect: element.getBoundingClientRect(),
        text: textOf(element),
      }))
      .filter((entry) => /^类目[:：]?$/.test(entry.text) || entry.text === '类目')
      .sort((left, right) => left.rect.left - right.rect.left)[0];
    const categoryLeft = categoryLabel ? categoryLabel.rect.left : Infinity;
    const scoreStoreSelector = (entry) => {
      const { rect, selector, text, rootText } = entry;
      const combinedText = `${text} ${rootText}`;
      let score = 0;

      if (/类目|平台SKU|货源ID|产品ID|条\/页/.test(combinedText)) {
        return Number.NEGATIVE_INFINITY;
      }
      if (rect.left >= categoryLeft - 8) {
        return Number.NEGATIVE_INFINITY;
      }
      for (const typeSelector of fieldTypeSelectors) {
        if (selector === typeSelector.selector) {
          score -= 200;
          continue;
        }
        if (sameRow(rect, typeSelector.rect) && rect.left >= typeSelector.rect.right - 4) {
          score += 120;
          score -= Math.max(0, rect.left - typeSelector.rect.right) / 20;
        }
      }
      if (isTypeSelectorText(text) && rect.width <= 260) {
        score -= 180;
      }
      if (selector.querySelector('.ant-select-selection-item, .ant-select-selection-choice, .ant-select-selection-overflow-item, .el-tag')) {
        score += 90;
      }
      if (storeLikeText.test(combinedText) || /\+\s*\d+/.test(combinedText)) {
        score += 70;
      }
      if (selector.querySelector('.ant-select-selection-search-input, input[role="combobox"], input:not([type="hidden"]):not([disabled])')) {
        score += 24;
      }
      if (rect.width >= 300) {
        score += 20;
      }
      return score - (rect.top / 100);
    };
    const storeSelector = visibleSelectors
      .map((entry) => ({
        ...entry,
        score: scoreStoreSelector(entry),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score)[0];
    const root = storeSelector ? storeSelector.root : document;
    const selectedTagSelectors = [
      '.ant-select-selection-item',
      '.ant-select-selection-choice',
      '.ant-select-selection-overflow-item',
      '.el-tag',
      '.selected-tag',
      '.tag',
      '[class*="selection-item"]',
      '[class*="selected"]',
      '[class*="tag"]',
      '[class*="Tag"]',
    ].join(', ');
    const selectedTextCandidates = Array.from(root.querySelectorAll([
      '.ant-select-selector span, .ant-select-selector div',
      '.el-select__wrapper span, .el-select__wrapper div',
      '.el-input span, .el-input div',
    ].join(', '))).filter((element) => isVisible(element)
      && !element.closest('.ant-pagination, .el-pagination')
      && textOf(element).length <= 120
      && looksLikeSelectedStoreText(textOf(element)));
    const globalSelectedTagSelectors = [
      '.ant-select-selection-item',
      '.ant-select-selection-choice',
      '.ant-select-selection-overflow-item',
      '.el-tag',
      '.selected-tag',
      '.tag',
    ].join(', ');
    const globalSelectedTagElements = Array.from(document.querySelectorAll(globalSelectedTagSelectors))
      .filter((element) => isVisible(element)
        && !element.closest([
          '.ant-select-dropdown',
          '.el-select-dropdown',
          '.ant-dropdown',
          '.el-popper',
          '.ant-table-tbody',
          '.el-table__body',
          'tbody',
          '.ant-pagination',
          '.el-pagination',
          'nav',
        ].join(', '))
        && textOf(element).length <= 120
        && looksLikeSelectedStoreText(textOf(element)));
    const rawSelectedTexts = Array.from(new Set([
      ...Array.from(root.querySelectorAll(selectedTagSelectors)),
      ...selectedTextCandidates,
      ...globalSelectedTagElements,
    ]))
      .filter((element) => isVisible(element)
        && !element.closest('.ant-pagination, .el-pagination')
        && textOf(element).length <= 120
        && looksLikeSelectedStoreText(textOf(element)))
      .map(textOf)
      .filter(Boolean)
      .filter((text, index, all) => all.indexOf(text) === index);
    const selectedStoreTexts = rawSelectedTexts.filter((text) => (
      looksLikeSelectedStoreText(text) && collapsedStoreSelectionCount(text) === 0
    ));
    const collapsedCount = rawSelectedTexts.reduce((total, text) => total + collapsedStoreSelectionCount(text), 0);
    return {
      selectedStoreCount: selectedStoreTexts.length + collapsedCount,
      selectedStoreTexts,
      rawSelectedTexts,
      collapsedStoreSelectionCount: collapsedCount,
    };
  });
}

async function waitForStoreSelectionCountBelow(page, previousCount, timeout = 900) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const currentCount = await getExistingStoreSelectionCount(page);
    if (currentCount < previousCount) {
      return true;
    }
    await sleep(90);
  }
  return false;
}

async function pressBackspaceToRemoveStoreSelection(page) {
  const selectorBox = await getStoreSelectorControlBox(page, 'selector');
  if (!selectorBox) {
    return false;
  }
  await page.mouse.click(selectorBox.x, selectorBox.y);
  await sleep(80);

  const focused = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const inputSelector = [
      '.ant-select-focused .ant-select-selection-search-input',
      '.ant-select-open .ant-select-selection-search-input',
      '.ant-select-selector .ant-select-selection-search-input',
      '.ant-select-selector input[role="combobox"]',
      '.el-select__wrapper input:not([type="hidden"]):not([disabled])',
      '.el-input input:not([type="hidden"]):not([disabled])',
    ].join(', ');
    const active = document.activeElement;
    const activeInput = active
      && active.matches
      && active.matches('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])')
      ? active
      : null;
    const input = activeInput || Array.from(document.querySelectorAll(inputSelector)).filter(isVisible)[0];
    if (!input) {
      return false;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    input.focus({ preventScroll: true });
    if (setter && input instanceof window.HTMLInputElement) {
      setter.call(input, '');
    } else {
      input.value = '';
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return document.activeElement === input;
  });

  if (!focused) {
    return false;
  }
  await page.keyboard.press('Backspace');
  await sleep(220);
  return true;
}

async function clickExistingStoreSelectionClose(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || element.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dispatchMouseClick = (element, point = {}) => {
      if (!element) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const clientX = Number.isFinite(point.x) ? point.x : rect.left + rect.width / 2;
      const clientY = Number.isFinite(point.y) ? point.y : rect.top + rect.height / 2;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
        }));
      });
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      }));
      return true;
    };
    const closeSelector = [
      '.ant-select-selection-item-remove',
      '.ant-select-selection-choice-remove',
      '.el-tag__close',
      '.ant-select-clear',
      '.el-select__caret.is-show-close',
      '.ant-select-selection-item .anticon-close',
      '.ant-select-selection-choice .anticon-close',
      '.ant-select-selection-item .anticon-close-circle',
      '.ant-select-selection-choice .anticon-close-circle',
      '.el-tag .anticon-close',
      '.el-tag .el-icon-close',
      '.el-tag .el-icon-circle-close',
      '.ms-tag-close',
      '.tag-close',
      '.select-tag-close',
      '[class*="tag"][class*="close"]',
      '[class*="close"][class*="circle"]',
      '[aria-label="close"]',
    ].join(', ');
    const selectedTagSelectors = [
      '.ant-select-selection-item',
      '.ant-select-selection-choice',
      '.ant-select-selection-overflow-item',
      '.el-tag',
      '.selected-tag',
      '.tag',
      '[class*="selection-item"]',
      '[class*="selected"]',
      '[class*="tag"]',
      '[class*="Tag"]',
    ].join(', ');
    const storeLikeText = /菲律宾|马来|泰国|越南|新加坡|印尼|\b(PH|MY|TH|VN|SG|IDN|ID)\b/i;
    const isSelectedStoreTokenText = (value) => (
      /^(.*?)\s*-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)\s*$/.test(String(value || '').replace(/\s+/g, ' ').trim())
      || /^\+\s*\d+$/.test(String(value || '').replace(/\s+/g, ' ').trim())
    );
    const selectedTextCandidates = Array.from(document.querySelectorAll([
      '.ant-select-selector span, .ant-select-selector div',
      '.el-select__wrapper span, .el-select__wrapper div',
      '.el-input span, .el-input div',
    ].join(', '))).filter((element) => isVisible(element)
      && !element.closest('.ant-pagination, .el-pagination')
      && textOf(element).length <= 120
      && isSelectedStoreTokenText(textOf(element)));
    const resolveSelectedTag = (element) => {
      const selectorRoot = element.closest('.ant-select-selector, .el-select__wrapper, .el-input, .ant-select, .el-select');
      if (!selectorRoot) {
        return element;
      }
      const rootRect = selectorRoot.getBoundingClientRect();
      let current = element;
      let best = element;
      while (current && current !== selectorRoot && selectorRoot.contains(current)) {
        const rect = current.getBoundingClientRect();
        const text = textOf(current);
        if (isSelectedStoreTokenText(text)
          && text.length <= 140
          && rect.left >= rootRect.left - 2
          && rect.right <= rootRect.right + 2
          && rect.top >= rootRect.top - 2
          && rect.bottom <= rootRect.bottom + 2) {
          best = current;
        }
        current = current.parentElement;
      }
      return best;
    };
    const selectedTags = Array.from(new Set([
      ...Array.from(document.querySelectorAll(selectedTagSelectors)),
      ...selectedTextCandidates.map(resolveSelectedTag),
    ]))
      .filter((element) => isVisible(element)
        && !element.closest('.ant-pagination, .el-pagination')
        && isSelectedStoreTokenText(textOf(element)))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
      });

    for (const tag of selectedTags) {
      const tagRect = tag.getBoundingClientRect();
      const selectorRoot = tag.closest('.ant-select-selector, .el-select__wrapper, .el-input, .ant-select, .el-select') || tag.parentElement;
      const selectorRect = selectorRoot ? selectorRoot.getBoundingClientRect() : tagRect;
      const point = {
        x: Math.min(selectorRect.right - 8, Math.max(tagRect.left + 8, tagRect.right - 14)),
        y: tagRect.top + tagRect.height / 2,
      };
      const directClose = Array.from(tag.querySelectorAll(closeSelector)).filter(isVisible)[0];
      if (directClose && dispatchMouseClick(directClose, point)) {
        return true;
      }
      const nearbyClose = selectorRoot
        ? Array.from(selectorRoot.querySelectorAll(closeSelector))
          .filter(isVisible)
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter((entry) => entry.rect.left >= tagRect.left - 2
            && entry.rect.left <= tagRect.right + 28
            && Math.abs((entry.rect.top + entry.rect.height / 2) - point.y) <= Math.max(18, tagRect.height))
          .sort((left, right) => right.rect.left - left.rect.left)[0]
        : null;
      if (nearbyClose && dispatchMouseClick(nearbyClose.element, point)) {
        return true;
      }

      const pointTargets = [
        point.x,
        Math.max(tagRect.left + 8, tagRect.right - 8),
        Math.min(selectorRect.right - 8, tagRect.right + 10),
        Math.min(selectorRect.right - 8, tagRect.right + 24),
      ].flatMap((x) => document.elementsFromPoint(x, point.y)
        .map((element) => element.closest(closeSelector) || element));
      const pointTarget = pointTargets
        .find((element) => element && isVisible(element) && (tag.contains(element) || (selectorRoot && selectorRoot.contains(element))));
      if (pointTarget && dispatchMouseClick(pointTarget, point)) {
        return true;
      }

      if (dispatchMouseClick(tag, point)) {
        return true;
      }
    }

    return false;
  });
}

async function removeExistingStoreSelections(page) {
  for (let index = 0; index < 14; index += 1) {
    const existingCount = await getExistingStoreSelectionCount(page);
    if (existingCount <= 0) {
      // The selected-count detector can miss a collapsed Ant Select tag, while the visible close button can still exist.
      if (await clickExistingStoreSelectionClose(page)) {
        await sleep(260);
        continue;
      }
      break;
    }

    if (await clickExistingStoreSelectionClose(page)) {
      if (await waitForStoreSelectionCountBelow(page, existingCount)) {
        continue;
      }
    }

    if (await pressBackspaceToRemoveStoreSelection(page)) {
      if (await waitForStoreSelectionCountBelow(page, existingCount)) {
        continue;
      }
    }

    const selectorBox = await getStoreSelectorControlBox(page, 'selector');
    if (selectorBox) {
      await page.mouse.move(selectorBox.x, selectorBox.y);
      await sleep(80);
    }

    const removeBox = await getStoreSelectorControlBox(page, 'remove');
    if (removeBox) {
      await page.mouse.click(removeBox.x, removeBox.y);
      if (await waitForStoreSelectionCountBelow(page, existingCount)) {
        continue;
      }
    }

    if (selectorBox) {
      await page.mouse.click(selectorBox.x, selectorBox.y);
      await sleep(160);
    }

    if (await clickSelectedStoreDropdownOption(page)) {
      if (await waitForStoreSelectionCountBelow(page, existingCount)) {
        continue;
      }
    }

    break;
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function assertNoExistingStoreSelection(page) {
  const state = await readSelectedStoreSelectionState(page);
  if (state.selectedStoreCount > 0) {
    const selectedText = state.rawSelectedTexts.join(' | ') || `共 ${state.selectedStoreCount} 个`;
    throw new Error(`没有删除已有店铺选项，已停止，避免继续筛选错误店铺。当前已选：${selectedText}`);
  }
}

async function getShopProductsPageSnapshot(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const hasLoginCue = /立即登录|扫码登录|账号登录|密码登录|忘记密码|手机号\/子账号\/邮箱|请输入.*(手机号|手机|账号|邮箱|密码|验证码)/.test(textOf(document.body));
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, .page-title, .title, label, span, div'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          text: textOf(element),
          top: rect.top,
          left: rect.left,
          fontSize: Number.parseFloat(style.fontSize || '0') || 0,
        };
      })
      .find((entry) => (
        entry.text === '店铺产品'
          && entry.top >= 0
          && entry.top < 260
          && entry.left < 520
          && entry.fontSize >= 20
      ));
    const visibleControlCount = Array.from(document.querySelectorAll(
      '.ant-select-selector, .el-select__wrapper, .el-input',
    )).filter(isVisible).length;

    return {
      url: window.location.href,
      hasLoginCue,
      hasShopProductsHeading: Boolean(heading),
      visibleControlCount,
      bodyStart: textOf(document.body).slice(0, 180),
    };
  });
}

async function waitForShopProductsPageReady(page, timeout = 30000) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeout) {
    lastSnapshot = await getShopProductsPageSnapshot(page);
    const hasExpectedUrl = /\/tiktok\/item\/item(?:[/?#]|$)/.test(lastSnapshot.url || '');
    const selectorBox = hasExpectedUrl && lastSnapshot.hasShopProductsHeading
      ? await getStoreSelectorControlBox(page, 'selector').catch(() => null)
      : null;

    if (hasExpectedUrl && lastSnapshot.hasShopProductsHeading && selectorBox) {
      emitProgress({
        phase: 'cleanup',
        phaseLabel: '店铺产品筛选区已加载',
      });
      return lastSnapshot;
    }

    if (lastSnapshot.hasLoginCue && !hasExpectedUrl) {
      throw new Error(`店铺产品页面仍停留在登录入口：${lastSnapshot.url}`);
    }

    await sleep(500);
  }

  const snapshot = lastSnapshot || {};
  throw new Error(`店铺产品页面未加载到筛选区：${snapshot.url || page.url()} ${snapshot.bodyStart || ''}`);
}

async function closeTransientMenus(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(120);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await sleep(120);
}

async function openCleanShopProductsPage(page) {
  await closeTransientMenus(page);
  try {
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch (error) {
    if (!isNavigationContextError(error)) {
      throw error;
    }
    await sleep(800);
  }

  await openMiaoshouPageWithLogin(page, SHOP_PRODUCTS_URL, {
    readyText: '店铺产品',
    pageLabel: '店铺产品',
  });
  await waitForShopProductsPageReady(page);
  await closeTransientMenus(page);
}

async function clearStoreSelectorAndFocusSearchInput(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const focused = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const textOf = (element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const inputTextOf = (element) => Array.from(element.querySelectorAll('input, textarea'))
      .map((input) => `${input.getAttribute('placeholder') || ''} ${input.value || ''}`)
      .join(' ');
    const selectorTextOf = (element) => `${textOf(element)} ${inputTextOf(element)}`.replace(/\s+/g, ' ').trim();
    const sameRow = (left, right) => {
      const verticalGap = Math.abs((left.top + left.height / 2) - (right.top + right.height / 2));
      return verticalGap <= Math.max(18, Math.min(left.height, right.height));
    };
    const isTypeSelectorText = (value) => /^(请选择|店铺|店铺分组)$/.test(String(value || '').replace(/\s+/g, ' ').trim());
    const optionLikeText = /菲律宾|马来|泰国|越南|新加坡|印尼|\b(PH|MY|TH|VN|SG|IDN|ID)\b/i;
    const nonStoreText = /类目|平台SKU|货源ID|产品ID|条\/页/;

    const visibleSelectors = Array.from(document.querySelectorAll(
      '.ant-select-selector, .el-select__wrapper, .el-input',
    ))
      .filter(isVisible)
      .map((selector) => {
        const root = selector.closest('.ant-select, .el-select') || selector;
        const rect = selector.getBoundingClientRect();
        return {
          selector,
          root,
          rect,
          text: selectorTextOf(selector),
          rootText: selectorTextOf(root),
        };
      })
      .filter((entry) => !entry.root.closest('.ant-pagination, .el-pagination'));

    const fieldTypeSelectors = visibleSelectors.filter((entry) => (
      entry.rect.width <= 260
        && isTypeSelectorText(entry.text)
        && !nonStoreText.test(entry.rootText)
    ));

    const categoryLabel = Array.from(document.querySelectorAll('label, span, div'))
      .filter(isVisible)
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        text: textOf(element),
      }))
      .filter((entry) => /^类目[:：]?$/.test(entry.text) || entry.text === '类目')
      .sort((left, right) => left.rect.left - right.rect.left)[0];
    const categoryLeft = categoryLabel ? categoryLabel.rect.left : Infinity;

    const scoreStoreSelector = (entry) => {
      const { rect, selector, root, text, rootText } = entry;
      const combinedText = `${text} ${rootText}`;
      let score = 0;

      if (nonStoreText.test(combinedText)) {
        return Number.NEGATIVE_INFINITY;
      }
      if (rect.left >= categoryLeft - 8) {
        return Number.NEGATIVE_INFINITY;
      }

      for (const typeSelector of fieldTypeSelectors) {
        if (selector === typeSelector.selector) {
          score -= 200;
          continue;
        }
        if (sameRow(rect, typeSelector.rect) && rect.left >= typeSelector.rect.right - 4) {
          score += 120;
          score -= Math.max(0, rect.left - typeSelector.rect.right) / 20;
        }
      }

      if (isTypeSelectorText(text) && rect.width <= 260) {
        score -= 180;
      }
      if (selector.querySelector('.ant-select-selection-item-remove, .ant-select-selection-choice-remove, .el-tag__close')) {
        score += 70;
      }
      if (optionLikeText.test(combinedText)) {
        score += 60;
      }
      if (selector.querySelector('.ant-select-selection-search-input, input[role="combobox"], input:not([type="hidden"]):not([disabled])')) {
        score += 24;
      }
      if (rect.width >= 300) {
        score += 20;
      }
      if (/店铺|店铺名/.test(combinedText)) {
        score += 10;
      }

      if (rect.top < window.innerHeight * 0.65) {
        score += 6;
      } else {
        score -= 20;
      }

      return score - (rect.top / 100);
    };

    const targetEntry = visibleSelectors
      .map((entry) => ({
        ...entry,
        score: scoreStoreSelector(entry),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score);

    const target = targetEntry[0];
    if (!target) {
      return false;
    }
    const { selector, root } = target;

    const clickVisible = (selectors) => {
      const selectorRect = selector.getBoundingClientRect();
      const candidates = [
        ...Array.from(selector.querySelectorAll(selectors)),
        ...Array.from(root.querySelectorAll(selectors)).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= selectorRect.left - 2
            && rect.right <= selectorRect.right + 2
            && Math.abs((rect.top + rect.height / 2) - (selectorRect.top + selectorRect.height / 2)) <= selectorRect.height;
        }),
      ].filter(isVisible);
      const targetButton = candidates[0];
      if (!targetButton) {
        return false;
      }
      targetButton.click();
      return true;
    };

    for (let index = 0; index < 20; index += 1) {
      if (clickVisible('.ant-select-clear, .el-select__caret.is-show-close')) {
        continue;
      }
      if (clickVisible('.ant-select-selection-item-remove, .ant-select-selection-choice-remove, .el-tag__close')) {
        continue;
      }
      break;
    }

    selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    selector.click();

    const input = selector.querySelector('.ant-select-selection-search-input, input[role="combobox"], input:not([type="hidden"]):not([disabled])')
      || root.querySelector('.ant-select-selection-search-input, input[role="combobox"], input:not([type="hidden"]):not([disabled])')
      || document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) input:not([type="hidden"]):not([disabled])')
      || document.querySelector('.el-select-dropdown:not([style*="display: none"]) input:not([type="hidden"]):not([disabled])');
    if (!input) {
      return false;
    }

    input.focus({ preventScroll: true });
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return document.activeElement === input;
  });

  if (!focused) {
    throw new Error('没有找到店铺下拉搜索输入框');
  }
}

async function clickStoreDropdownOption(page, storeSearchText, { exact = false, timeout = 15000 } = {}) {
  try {
    await page.waitForFunction((needle, matchExact) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const normalizeOptionMatchText = (value) => String(value || '')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const matches = (element) => {
      const value = normalizeOptionMatchText(element.innerText || element.textContent || element.getAttribute('title') || '');
      const target = normalizeOptionMatchText(needle);
      return matchExact ? value === target : value.includes(target);
    };
    const textOf = (element) => String(element.innerText || element.textContent || element.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dropdownRootSelector = [
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.el-select-dropdown:not([style*="display: none"])',
      '.custom-select-dropdown',
      '.ms-select-dropdown',
      '.select-dropdown',
      '.dropdown-menu',
      '.el-popper',
      '.ant-dropdown',
      '[role="listbox"]',
    ].join(', ');
    const optionSelector = [
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '[role="option"]',
      'li',
      'label',
      'span',
      'div',
    ].join(', ');
    const findStoreDropdownOptionCandidates = () => {
      const roots = Array.from(document.querySelectorAll(dropdownRootSelector)).filter(isVisible);
      const rootCandidates = roots.flatMap((root) => Array.from(root.querySelectorAll(optionSelector))
        .filter((element) => isVisible(element) && matches(element)));
      if (rootCandidates.length > 0) {
        return rootCandidates;
      }
      return Array.from(document.querySelectorAll('li, label, span, div, [role="option"]'))
        .filter((element) => {
          if (!isVisible(element) || !matches(element)) {
            return false;
          }
          const text = textOf(element);
          const rect = element.getBoundingClientRect();
          const root = element.closest('[role="listbox"], .custom-select-dropdown, .ms-select-dropdown, .select-dropdown, .dropdown-menu, .el-popper, .ant-dropdown');
          return text.length <= 120
            && rect.top >= 0
            && rect.top < window.innerHeight
            && (root || /-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)$/.test(text));
        });
    };

    return findStoreDropdownOptionCandidates().length > 0;
    }, { timeout }, storeSearchText, exact);
  } catch (error) {
    const debug = await collectStoreDropdownDebug(page);
    throw new Error(`没有找到店铺候选项：${storeSearchText}。${formatStoreDropdownDebug(debug)}`);
  }

  const clicked = await page.evaluate((needle, matchExact) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const normalizeOptionMatchText = (value) => String(value || '')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const matches = (element) => {
      const value = normalizeOptionMatchText(element.innerText || element.textContent || element.getAttribute('title') || '');
      const target = normalizeOptionMatchText(needle);
      return matchExact ? value === target : value.includes(target);
    };
    const textOf = (element) => String(element.innerText || element.textContent || element.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dropdownRootSelector = [
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.el-select-dropdown:not([style*="display: none"])',
      '.custom-select-dropdown',
      '.ms-select-dropdown',
      '.select-dropdown',
      '.dropdown-menu',
      '.el-popper',
      '.ant-dropdown',
      '[role="listbox"]',
    ].join(', ');
    const optionSelector = [
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '[role="option"]',
      'li',
      'label',
      'span',
      'div',
    ].join(', ');
    const scoreOption = (element) => {
      const value = normalizeOptionMatchText(textOf(element));
      const target = normalizeOptionMatchText(needle);
      const rect = element.getBoundingClientRect();
      let score = value === target ? 200 : 0;
      if (value.includes(target)) {
        score += 100;
      }
      if (/-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)$/.test(value)) {
        score += 40;
      }
      if (element.closest(dropdownRootSelector)) {
        score += 30;
      }
      if (element.matches('[role="option"], .ant-select-item-option, .el-select-dropdown__item, li')) {
        score += 20;
      }
      return score - rect.top / 1000 - rect.left / 10000;
    };
    const findStoreDropdownOptionCandidates = () => {
      const roots = Array.from(document.querySelectorAll(dropdownRootSelector)).filter(isVisible);
      const rootCandidates = roots.flatMap((root) => Array.from(root.querySelectorAll(optionSelector))
        .filter((element) => isVisible(element) && matches(element)));
      if (rootCandidates.length > 0) {
        return rootCandidates;
      }
      return Array.from(document.querySelectorAll('li, label, span, div, [role="option"]'))
        .filter((element) => {
          if (!isVisible(element) || !matches(element)) {
            return false;
          }
          const text = textOf(element);
          const rect = element.getBoundingClientRect();
          const root = element.closest('[role="listbox"], .custom-select-dropdown, .ms-select-dropdown, .select-dropdown, .dropdown-menu, .el-popper, .ant-dropdown');
          return text.length <= 120
            && rect.top >= 0
            && rect.top < window.innerHeight
            && (root || /-\s*(菲律宾|马来|泰国|越南|新加坡|印尼)$/.test(text));
        });
    };

    const target = findStoreDropdownOptionCandidates()
      .sort((left, right) => scoreOption(right) - scoreOption(left))[0];
    if (!target) {
      return false;
    }
    target.click();
    return true;
  }, storeSearchText, exact);

  if (!clicked) {
    const debug = await collectStoreDropdownDebug(page);
    throw new Error(`没有点击到店铺候选项：${storeSearchText}。${formatStoreDropdownDebug(debug)}`);
  }
}

async function verifySelectedStoreTag(page, target, timeout = 10000) {
  const storeSearchText = target.storeOptionText || target.storeName;
  try {
    await page.waitForFunction((storeName, storeOptionText, expectedText) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const normalize = (value) => String(value || '')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const matchesExpected = (value) => {
      const normalizedValue = normalize(value);
      const expected = normalize(expectedText);
      const option = normalize(storeOptionText);
      const name = normalize(storeName);
      return Boolean(normalizedValue)
        && ((option && normalizedValue.includes(option))
          || (expected && normalizedValue.includes(expected))
          || (name && normalizedValue.includes(name)));
    };
    const selectedTags = Array.from(document.querySelectorAll([
      '.ant-select-selection-item',
      '.ant-select-selection-choice',
      '.el-tag',
      '.selected-tag',
      '.tag',
    ].join(', '))).filter(isVisible);

    if (selectedTags.some((element) => matchesExpected(element.innerText || element.textContent || element.getAttribute('title')))) {
      return true;
    }

    return Array.from(document.querySelectorAll('.ant-select-selector, .el-select__wrapper, .el-input'))
      .filter(isVisible)
      .some((element) => {
        const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        return matchesExpected(text)
          && Boolean(element.querySelector('.ant-select-selection-item-remove, .ant-select-selection-choice-remove, .el-tag__close'));
      });
    }, { timeout }, target.storeName, target.storeOptionText, storeSearchText);
  } catch (_error) {
    const debug = await collectStoreDropdownDebug(page);
    throw new Error(`没有确认店铺已选中：${storeSearchText}。${formatStoreDropdownDebug(debug)}`);
  }
}

async function assertSingleSelectedStoreSelection(page, target) {
  const state = await readSelectedStoreSelectionState(page);
  const storeSearchText = target.storeOptionText || target.storeName;
  const normalize = (value) => String(value || '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const expected = normalize(storeSearchText);
  const option = normalize(target.storeOptionText);
  const name = normalize(target.storeName);
  const hasExpectedStore = state.selectedStoreTexts.some((text) => {
    const value = normalize(text);
    return (option && value.includes(option))
      || (expected && value.includes(expected))
      || (name && value.includes(name));
  });

  if (state.selectedStoreCount !== 1 || !hasExpectedStore) {
    const selectedText = state.rawSelectedTexts.join(' | ') || `共 ${state.selectedStoreCount} 个`;
    throw new Error(`选择了多个店铺或店铺不准确，已停止，避免筛选错误店铺：目标=${storeSearchText}，当前已选=${selectedText}`);
  }
}

async function getVisibleInputValuesNearText(page, labelText, limit = 2) {
  return page.evaluate((needle, maxCount) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const textElements = Array.from(document.querySelectorAll('label, span, div, td, th'))
      .filter((element) => isVisible(element)
        && String(element.innerText || element.textContent || '').includes(needle))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          element,
          text,
          score: (text === needle ? 0 : text.length) + (rect.width * rect.height) / 10000,
        };
      })
      .sort((left, right) => left.score - right.score);
    const labelElement = textElements[0] && textElements[0].element;
    if (!labelElement) {
      return [];
    }

    const inputSelector = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled])';
    const labelRect = labelElement.getBoundingClientRect();
    const relatedRoot = labelElement.closest('form, .ant-form-item, .el-form-item, .filter-item, .search-item')
      || labelElement.parentElement
      || document.body;
    const rootInputs = Array.from(relatedRoot.querySelectorAll(inputSelector)).filter(isVisible);
    const allInputs = Array.from(document.querySelectorAll(inputSelector)).filter(isVisible);
    return (rootInputs.length > 0 ? rootInputs : allInputs)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        return {
          value: input.value,
          distance: Math.abs(rect.top - labelRect.top) + Math.abs(rect.left - labelRect.left),
        };
      })
      .sort((left, right) => left.distance - right.distance)
      .slice(0, maxCount)
      .map((entry) => String(entry.value || '').trim());
  }, labelText, limit);
}

async function verifyZeroSalesFilterInputs(page) {
  try {
    await assertZeroSalesFilterInputs(page);
    return true;
  } catch (_error) {
    return false;
  }
}

async function assertZeroSalesFilterInputs(page, message = '无法确认销量 0 到 0') {
  const salesFilterValues = await getVisibleInputValuesNearText(page, '销量', 2);
  const confirmed = salesFilterValues.length >= 2
    && salesFilterValues.slice(0, 2).every((value) => value === '0');
  if (!confirmed) {
    const currentValueText = salesFilterValues.length
      ? salesFilterValues.join(' 到 ')
      : '未找到销量输入框';
    throw new Error(`${message}，当前销量输入值：${currentValueText}`);
  }
  return salesFilterValues.slice(0, 2);
}

async function readVisibleProductRowSales(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const parseSalesValue = (text) => {
      const normalizedText = String(text || '').replace(/[,，]/g, '').trim();
      const labeledMatch = normalizedText.match(/销量\s*[:：]?\s*(\d+)/);
      const plainMatch = normalizedText.match(/^\s*(\d+)\s*$/);
      const match = labeledMatch || plainMatch;
      if (!match) {
        return null;
      }
      return Number.parseInt(match[1], 10);
    };
    const textOf = (element) => String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

    const rows = Array.from(document.querySelectorAll(
      '.ant-table-tbody tr, .el-table__body tr, tbody tr, [role="row"]',
    ))
      .filter((row, index, allRows) => allRows.indexOf(row) === index)
      .filter((row) => isVisible(row)
        && !row.closest('thead')
        && !/\bant-table-placeholder\b/.test(row.className || '')
        && !/\bel-table__empty-row\b/.test(row.className || ''));
    const salesColumnHeaderBox = Array.from(document.querySelectorAll(
      'thead th, [role="columnheader"], .ant-table-thead th, .el-table__header th',
    ))
      .filter((cell) => isVisible(cell) && textOf(cell).includes('销量'))
      .map((cell) => {
        const rect = cell.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          centerX: rect.left + rect.width / 2,
        };
      })
      .sort((left, right) => left.centerX - right.centerX)[0] || null;

    const salesValues = [];
    let unconfirmedRowCount = 0;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, [role="cell"]')).filter(isVisible);
      const table = row.closest('table');
      const headerCells = table
        ? Array.from(table.querySelectorAll('thead th, [role="columnheader"]')).filter(isVisible)
        : [];
      const salesColumnIndex = headerCells.findIndex((cell) => (
        textOf(cell).includes('销量')
      ));
      const headerCenterX = salesColumnHeaderBox ? salesColumnHeaderBox.centerX : null;
      const positionedSalesCell = headerCenterX === null
        ? null
        : cells.find((cell) => {
          const rect = cell.getBoundingClientRect();
          return rect.left <= headerCenterX && rect.right >= headerCenterX;
        });
      const indexedSalesCell = salesColumnIndex >= 0 && cells[salesColumnIndex]
        ? cells[salesColumnIndex]
        : null;
      const numericCells = cells.filter((cell) => parseSalesValue(textOf(cell)) !== null);
      const salesText = positionedSalesCell
        ? textOf(positionedSalesCell)
        : (indexedSalesCell ? textOf(indexedSalesCell) : (numericCells.length === 1 ? textOf(numericCells[0]) : ''));
      const salesValue = parseSalesValue(salesText);

      if (salesValue === null || !Number.isFinite(salesValue)) {
        unconfirmedRowCount += 1;
      } else {
        salesValues.push(salesValue);
      }
    }

    return {
      rowCount: rows.length,
      salesValues,
      unconfirmedRowCount,
      salesColumnHeaderFound: Boolean(salesColumnHeaderBox),
    };
  });
}

async function verifyVisibleProductRowSales(page) {
  const { rowCount, salesValues, unconfirmedRowCount } = await readVisibleProductRowSales(page);
  return rowCount > 0
    && unconfirmedRowCount === 0
    && salesValues.length === rowCount
    && salesValues.every((sales) => sales === 0);
}

async function countVisibleProductRows(page) {
  const { rowCount } = await readVisibleProductRowSales(page);
  return rowCount;
}

async function countSelectedProductRows(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const rows = Array.from(document.querySelectorAll(
      '.ant-table-tbody tr, .el-table__body tr, tbody tr, [role="row"]',
    ))
      .filter((row, index, allRows) => allRows.indexOf(row) === index)
      .filter((row) => isVisible(row)
        && !row.closest('thead')
        && !/\bant-table-placeholder\b/.test(row.className || '')
        && !/\bel-table__empty-row\b/.test(row.className || ''));

    return rows.filter((row) => (
      Array.from(row.querySelectorAll('input[type="checkbox"]')).some((input) => input.checked)
        || row.querySelector('.ant-checkbox-checked, .el-checkbox.is-checked')
    )).length;
  });
}

async function extractFailurePageRecords(page) {
  return page.evaluate(() => {
    const countrySuffix = /(.*?-\s*(?:菲律宾|马来|泰国|越南|新加坡|印尼))(?:\s|$)/;
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const looksLikeStoreName = (value) => {
      const text = normalize(value);
      if (!text || text.length > 80) {
        return false;
      }
      if (!/\b(PH|MY|TH|VN|SG|IDN|ID)\b\s*$/i.test(text)) {
        return false;
      }
      if (/发布失败|商店试用期|最多只能|产品ID|类目|主账号|子账号|\d{4}-\d{2}-\d{2}|编辑|删除|记录/.test(text)) {
        return false;
      }
      return /^[\w\s&'.-]+$/i.test(text);
    };

    return Array.from(document.querySelectorAll('tr, .ant-table-row, .el-table__row, [role="row"]'))
      .filter(isVisible)
      .map((row) => {
        const rawText = String(row.innerText || row.textContent || '').trim();
        const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        const cells = Array.from(row.querySelectorAll('td, [role="cell"]'))
          .filter(isVisible)
          .map((cell) => normalize(cell.innerText || cell.textContent))
          .filter(Boolean);
        const storeLine = lines.find((line) => countrySuffix.test(line)) || '';
        const match = storeLine.match(countrySuffix) || rawText.match(countrySuffix);
        const storeCandidate = match
          ? normalize(match[1])
          : [...cells, ...lines].reverse().find(looksLikeStoreName) || '';
        const storeOptionText = match ? normalize(match[1]) : '';
        return {
          storeName: storeCandidate || storeOptionText,
          storeOptionText,
          reason: rawText,
          failureReason: rawText,
          rawText,
        };
      })
      .filter((record) => record.rawText);
  });
}

async function clickCurrentPageSelectAllCheckbox(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dispatchMouseClick = (element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      for (const type of ['mousedown', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }));
      }
    };
    const checkboxSelectors = [
      'input[type="checkbox"]',
      '[role="checkbox"]',
      '.ant-checkbox',
      '.ant-checkbox-wrapper',
      '.el-checkbox',
      '.el-checkbox__input',
      '.next-checkbox',
      '.semi-checkbox',
      '.arco-checkbox',
      '.n-checkbox',
      '.t-checkbox',
      '[class*="checkbox"]',
      '[class*="Checkbox"]',
    ].join(', ');
    const clickableCheckboxElement = (element) => (
      element.closest('label, button, [role="checkbox"], .ant-checkbox-wrapper, .el-checkbox, .next-checkbox, .semi-checkbox, .arco-checkbox, .n-checkbox, .t-checkbox')
      || element
    );
    const findProductInfoHeaderBox = () => {
      const headers = Array.from(document.querySelectorAll([
        'th',
        '[role="columnheader"]',
        '.ant-table-cell',
        '.el-table__cell',
        'span',
        'div',
      ].join(', ')))
        .filter((element) => isVisible(element) && /产品信息/.test(textOf(element)))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const row = element.closest('tr, [role="row"], .ant-table-row, .el-table__row')
            || element.parentElement;
          const rowRect = row && row.getBoundingClientRect ? row.getBoundingClientRect() : rect;
          return {
            element,
            rect,
            rowRect,
            score: textOf(element).length + rect.top / 1000,
          };
        })
        .sort((left, right) => left.score - right.score);
      return headers[0] || null;
    };
    const headerCheckboxSelectors = [
      '.ant-table-thead th input[type="checkbox"]',
      '.ant-table-thead th .ant-checkbox',
      '.el-table__header th input[type="checkbox"]',
      '.el-table__header th .el-checkbox',
      'thead th input[type="checkbox"]',
      'thead th .ant-checkbox',
      'thead th .el-checkbox',
      '[role="columnheader"] input[type="checkbox"]',
      '[role="columnheader"] .ant-checkbox',
      '[role="columnheader"] .el-checkbox',
      '[role="columnheader"] [class*="checkbox"]',
      '[role="columnheader"] [class*="Checkbox"]',
    ].join(', ');
    const productInfoHeaderBox = findProductInfoHeaderBox();
    const candidates = Array.from(document.querySelectorAll(headerCheckboxSelectors))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = String((element.closest('th, [role="columnheader"], tr') || element).innerText || '')
          .replace(/\s+/g, ' ')
          .trim();
        const centerY = rect.top + rect.height / 2;
        const headerCenterY = productInfoHeaderBox
          ? productInfoHeaderBox.rect.top + productInfoHeaderBox.rect.height / 2
          : centerY;
        const nearProductInfoHeader = productInfoHeaderBox
          && centerY >= productInfoHeaderBox.rowRect.top - 20
          && centerY <= productInfoHeaderBox.rowRect.bottom + 20
          && rect.left < productInfoHeaderBox.rect.left + 12;
        return {
          element,
          top: rect.top,
          left: rect.left,
          text,
          nearProductInfoHeader,
          score: (nearProductInfoHeader ? -10000 : 0)
            + Math.abs(centerY - headerCenterY)
            + (productInfoHeaderBox ? Math.abs(rect.left - (productInfoHeaderBox.rect.left - 24)) / 100 : rect.left / 1000),
        };
      })
      .filter((entry) => !/操作|编辑|删除|复制|同步|下架/.test(entry.text))
      .sort((left, right) => left.score - right.score);
    let target = candidates[0] && candidates[0].element;
    if (!target && productInfoHeaderBox) {
      const headerCenterY = productInfoHeaderBox.rect.top + productInfoHeaderBox.rect.height / 2;
      const probePoints = [
        [productInfoHeaderBox.rect.left - 28, headerCenterY],
        [productInfoHeaderBox.rect.left - 20, headerCenterY],
        [productInfoHeaderBox.rowRect.left + 28, headerCenterY],
        [productInfoHeaderBox.rowRect.left + 36, headerCenterY],
      ];
      for (const [x, y] of probePoints) {
        const elements = document.elementsFromPoint(x, y);
        const checkboxElement = elements.find((element) => (
          element.matches && element.matches(checkboxSelectors)
        ));
        target = checkboxElement || elements.find((element) => {
          const className = String(element.className || '');
          return /checkbox|Checkbox/.test(className)
            || element.getAttribute('role') === 'checkbox'
            || element.closest(checkboxSelectors);
        });
        if (target) {
          break;
        }
      }
    }
    if (!target) {
      return false;
    }
    dispatchMouseClick(clickableCheckboxElement(target));
    return true;
  });

  if (!clicked) {
    throw new Error('没有找到当前页表头全选框，已跳过下架');
  }
  await sleep(300);

  let selectedProductCount = 0;
  try {
    selectedProductCount = await countSelectedProductRows(page);
  } catch (error) {
    selectedProductCount = 0;
  }
  return selectedProductCount || 1;
}

async function clickTopBulkMoreDropdown(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const sameToolbarRow = (left, right) => {
      const leftCenter = left.top + left.height / 2;
      const rightCenter = right.top + right.height / 2;
      return Math.abs(leftCenter - rightCenter) <= Math.max(18, Math.min(left.height, right.height));
    };
    const tableHeaderTop = Math.min(
      ...Array.from(document.querySelectorAll('thead, .ant-table-thead, .el-table__header, [role="columnheader"]'))
        .filter(isVisible)
        .map((element) => element.getBoundingClientRect().top),
      Number.POSITIVE_INFINITY,
    );
    const bulkToolbarLabels = ['批量编辑', '复制产品', '达人建联', '分组'];
    const bulkToolbarAnchors = Array.from(document.querySelectorAll('button, a, span, div'))
      .filter((element) => isVisible(element) && bulkToolbarLabels.includes(textOf(element)))
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter((entry) => !entry.element.closest('tbody, .ant-table-tbody, .el-table__body'));
    const candidates = Array.from(document.querySelectorAll('button, a, span, div'))
      .filter((element) => isVisible(element) && textOf(element) === '更多')
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const inTableBody = Boolean(element.closest('tbody, .ant-table-tbody, .el-table__body'));
        const nearestToolbarAnchor = bulkToolbarAnchors
          .filter((anchor) => sameToolbarRow(rect, anchor.rect))
          .map((anchor) => ({
            ...anchor,
            distance: Math.abs(rect.left - anchor.rect.right),
          }))
          .sort((left, right) => left.distance - right.distance)[0];
        const toolbarScore = nearestToolbarAnchor
          ? -12000 - Math.max(0, rect.left - nearestToolbarAnchor.rect.right) / 20
          : 0;
        const aboveTable = Number.isFinite(tableHeaderTop) ? rect.top < tableHeaderTop : true;
        return {
          element,
          top: rect.top,
          inTableBody,
          aboveTable,
          score: toolbarScore
            + (inTableBody ? 10000 : 0)
            + (aboveTable ? 0 : 1000)
            + Math.abs((Number.isFinite(tableHeaderTop) ? tableHeaderTop : rect.top) - rect.top),
        };
      })
      .sort((left, right) => left.score - right.score);
    const target = candidates[0] && candidates[0].element;
    if (!target || candidates[0].inTableBody || candidates[0].score > -1000) {
      return false;
    }
    target.click();
    return true;
  });

  if (!clicked) {
    throw new Error('没有找到顶部批量“更多”按钮，已跳过下架');
  }
  await sleep(300);
}

async function waitForDropdownActionVisible(page, labels = [], timeout = 5000) {
  try {
    await page.waitForFunction((actionLabels) => {
      const isVisible = (element) => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;
      };
      const textOf = (element) => String(element.innerText || element.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const dropdownRoots = Array.from(document.querySelectorAll([
        '.ant-dropdown:not(.ant-dropdown-hidden)',
        '.ant-dropdown-menu',
        '.el-dropdown-menu',
        '.el-popper',
        '.dropdown-menu',
        '[role="menu"]',
      ].join(', '))).filter(isVisible);
      return dropdownRoots.length > 0
        && dropdownRoots.some((root) => Array.from(root.querySelectorAll('li, button, a, span, div'))
          .some((element) => {
            if (!isVisible(element)) {
              return false;
            }
            const value = textOf(element);
            return actionLabels.some((label) => value === label || value.includes(label));
          }));
    }, { timeout }, labels);
  } catch (_error) {
    throw new Error(`没有找到已打开下拉菜单里的操作：${labels.join(' / ')}`);
  }
}

async function clickVisibleDropdownAction(page, labels = []) {
  await waitForDropdownActionVisible(page, labels);

  const clicked = await page.evaluate((actionLabels) => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const dropdownRoots = Array.from(document.querySelectorAll([
      '.ant-dropdown:not(.ant-dropdown-hidden)',
      '.ant-dropdown-menu',
      '.el-dropdown-menu',
      '.el-popper',
      '.dropdown-menu',
      '[role="menu"]',
    ].join(', '))).filter(isVisible);
    if (dropdownRoots.length === 0) {
      return false;
    }
    const actionLabelIndex = (text) => {
      const exactIndex = actionLabels.findIndex((label) => text === label);
      if (exactIndex >= 0) {
        return exactIndex;
      }
      const labelIndex = actionLabels.findIndex((label) => text.includes(label));
      return labelIndex >= 0 ? labelIndex + 100 : Number.POSITIVE_INFINITY;
    };
    const candidates = dropdownRoots.flatMap((root) => Array.from(root.querySelectorAll('li, button, a, span, div')))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        text: textOf(element),
      }))
      .filter((entry) => actionLabels.some((label) => entry.text === label || entry.text.includes(label)))
      .sort((left, right) => actionLabelIndex(left.text) - actionLabelIndex(right.text)
        || left.text.length - right.text.length);
    const target = candidates[0] && candidates[0].element;
    if (!target) {
      return false;
    }
    target.click();
    return true;
  }, labels);

  if (!clicked) {
    throw new Error(`没有找到已打开下拉菜单里的操作：${labels.join(' / ')}，已跳过下架`);
  }
}

async function clickNextFailurePage(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const disabled = (element) => (
      element.disabled
      || element.getAttribute('aria-disabled') === 'true'
      || /\bdisabled\b/.test(element.className || '')
    );

    const candidates = Array.from(document.querySelectorAll(
      '.ant-pagination-next, .el-pagination .btn-next, button, a, li',
    )).filter((element) => (
      isVisible(element)
        && !disabled(element)
        && (/下一页|next/i.test(element.getAttribute('aria-label') || '')
          || /下一页|›|>/i.test(String(element.innerText || element.textContent || '').trim())
          || /\bant-pagination-next\b/.test(element.className || '')
          || /\bbtn-next\b/.test(element.className || ''))
    ));

    const target = candidates[0];
    if (!target) {
      return false;
    }
    target.click();
    return true;
  });
}

async function scanProductLimitFailureStores(page, { maxPages = 5 } = {}) {
  const safeMaxPages = Math.max(1, Number.parseInt(maxPages, 10) || 5);
  const records = [];

  await openMiaoshouPageWithLogin(page, PUBLISH_HISTORY_URL, {
    readyText: '发布记录',
    pageLabel: '发布记录',
  });
  await clickByText(page, '发布失败');
  await waitForNetworkQuiet(page);

  for (let pageIndex = 0; pageIndex < safeMaxPages; pageIndex += 1) {
    const pageRecords = await extractFailurePageRecords(page);
    records.push(...pageRecords);
    const matchedStores = buildMatchedLimitStoreRecords(records);
    emitProgress({
      phase: 'scan',
      phaseLabel: `已扫描发布失败第 ${pageIndex + 1} 页`,
      scannedFailureRecords: records.length,
      matchedStores,
      total: matchedStores.length,
      totalCount: matchedStores.length,
    });

    if (pageIndex >= safeMaxPages - 1) {
      break;
    }

    const moved = await clickNextFailurePage(page);
    if (!moved) {
      break;
    }
    await waitForNetworkQuiet(page);
  }

  return {
    scannedFailureRecords: records.length,
    matchedStores: buildMatchedLimitStoreRecords(records),
  };
}

async function selectExactStore(page, store, explicitStoreOptionText = '') {
  const target = resolveStoreTarget(store, explicitStoreOptionText);
  const storeSearchText = target.storeOptionText || target.storeName;
  if (!storeSearchText) {
    throw new Error('没有可搜索的店铺名');
  }

  await waitForVisibleText(page, '店铺产品');
  await clearStoreSelectorAndFocusSearchInput(page);
  await removeExistingStoreSelections(page);
  await assertNoExistingStoreSelection(page);
  await clearStoreSelectorAndFocusSearchInput(page);
  await removeExistingStoreSelections(page);
  await assertNoExistingStoreSelection(page);
  await clearStoreSelectorAndFocusSearchInput(page);
  await clearFocusedTextInputWithKeyboard(page);
  await enterStoreSearchText(page, storeSearchText);
  await clickStoreDropdownOption(page, storeSearchText, { exact: Boolean(target.storeOptionText) });
  await waitForNetworkQuiet(page);
  await verifySelectedStoreTag(page, target);
  await assertSingleSelectedStoreSelection(page, target);
  await closeTransientMenus(page);

  emitProgress({
    phase: 'cleanup',
    storeName: target.storeName,
    storeOptionText: target.storeOptionText,
    phaseLabel: `已选择店铺 ${storeSearchText}`,
  });
}

async function setZeroSalesFilter(page) {
  await clickByText(page, '更多筛选');
  await waitForVisibleText(page, '销量');
  await fillInputsNearText(page, '销量', ['0', '0']);
  await assertZeroSalesFilterInputs(page, '无法确认销量 0 到 0');
  emitProgress({
    phase: 'cleanup',
    phaseLabel: '已确认销量 0 到 0',
  });
}

async function clickSearchProducts(page) {
  await assertZeroSalesFilterInputs(page, '搜索前无法确认销量 0 到 0');
  emitProgress({
    phase: 'cleanup',
    phaseLabel: '搜索前已确认销量 0 到 0',
  });
  await clickByText(page, '搜索', { exact: true });
  await waitForNetworkQuiet(page);
  emitProgress({
    phase: 'cleanup',
    phaseLabel: '已点击搜索',
  });
}

async function clickPageSizeDropdown(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const isDropdownOption = (element) => Boolean(element.closest([
      '.ant-select-dropdown',
      '.el-select-dropdown',
      '.ant-dropdown',
      '.el-popper',
      '[role="listbox"]',
    ].join(', ')));
    const textOf = (element) => String(
      element.innerText
        || element.textContent
        || element.value
        || element.getAttribute('title')
        || '',
    ).replace(/\s+/g, ' ').trim();
    const score = (element) => {
      let value = textOf(element).length;
      if (element.closest('.ant-pagination-options, .el-pagination__sizes')) {
        value -= 1000;
      }
      if (/^\d+\s*条\s*\/\s*页$/.test(textOf(element))) {
        value -= 200;
      }
      if (element.matches('input')) {
        value -= 100;
      }
      return value;
    };

    const candidates = Array.from(document.querySelectorAll([
      '.ant-pagination-options .ant-select-selector',
      '.ant-pagination-options .ant-select-selection-item',
      '.el-pagination__sizes .el-select',
      '.el-pagination__sizes input',
      '.el-pagination__sizes',
      '.ant-pagination-options',
      '.ant-select-selector',
      '.el-select',
      'span',
      'div',
      'input',
    ].join(', ')))
      .filter((element) => isVisible(element)
        && !isDropdownOption(element)
        && /\d+\s*条\s*\/\s*页/.test(textOf(element)))
      .sort((left, right) => score(left) - score(right));
    const target = candidates[0];
    if (!target) {
      return false;
    }
    target.click();
    return true;
  });

  if (!clicked) {
    throw new Error('没有找到分页条数选择器');
  }
}

async function readCurrentProductPageSize(page) {
  const candidates = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };
    const isDropdownOption = (element) => Boolean(element.closest([
      '.ant-select-dropdown',
      '.el-select-dropdown',
      '.ant-dropdown',
      '.el-popper',
      '[role="listbox"]',
    ].join(', ')));
    const textOf = (element) => String(
      element.innerText
        || element.textContent
        || element.value
        || element.getAttribute('title')
        || element.getAttribute('aria-label')
        || '',
    ).replace(/\s+/g, ' ').trim();
    const score = (element) => {
      let value = textOf(element).length;
      if (element.closest('.ant-pagination-options, .el-pagination__sizes')) {
        value -= 1000;
      }
      if (element.closest('.ant-pagination, .el-pagination')) {
        value -= 400;
      }
      if (/^\d+\s*条\s*\/\s*页$/.test(textOf(element))) {
        value -= 200;
      }
      if (element.matches('input')) {
        value -= 100;
      }
      return value;
    };

    return Array.from(document.querySelectorAll([
      '.ant-pagination-options .ant-select-selector',
      '.ant-pagination-options .ant-select-selection-item',
      '.el-pagination__sizes .el-select',
      '.el-pagination__sizes input',
      '.el-pagination__sizes',
      '.ant-pagination-options',
      '.ant-pagination',
      '.el-pagination',
      '.ant-select-selector',
      '.el-select',
      'span',
      'div',
      'input',
    ].join(', ')))
      .filter((element) => isVisible(element)
        && !isDropdownOption(element)
        && /\d+\s*条\s*\/\s*页/.test(textOf(element)))
      .map((element) => ({
        text: textOf(element),
        score: score(element),
      }))
      .sort((left, right) => left.score - right.score)
      .map((candidate) => candidate.text)
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 8);
  });

  return parseProductPageSizeFromTexts(candidates);
}

async function assertProductPageSize100(page, message = '没有确认分页 100条/页') {
  const currentPageSize = await readCurrentProductPageSize(page);
  if (currentPageSize !== 100) {
    throw new Error(`${message}，当前分页：${currentPageSize ? `${currentPageSize}条/页` : '未识别'}`);
  }
  return currentPageSize;
}

async function waitForProductPageSize100(page, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const currentPageSize = await readCurrentProductPageSize(page);
    if (currentPageSize === 100) {
      return currentPageSize;
    }
    await sleep(250);
  }
  return assertProductPageSize100(page, '改分页后无法确认 100条/页');
}

async function setPageSize100(page) {
  const currentPageSize = await readCurrentProductPageSize(page);
  if (currentPageSize !== 100) {
    await clickPageSizeDropdown(page);
    await clickByText(page, '100条/页', { exact: true });
  }
  await waitForNetworkQuiet(page);
  await waitForProductPageSize100(page);
  emitProgress({
    phase: 'cleanup',
    phaseLabel: '已确认分页 100条/页',
  });
}

function getPaginationStateFromItems(paginationInput = {}, positionalHasEnabledNextPage = false) {
  const paginationStateInput = Array.isArray(paginationInput)
    ? {
      numericPageItems: paginationInput,
      hasEnabledNextPage: positionalHasEnabledNextPage,
    }
    : paginationInput;
  const {
    numericPageItems = [],
    hasEnabledNextPage = false,
  } = paginationStateInput || {};
  const pageItems = (Array.isArray(numericPageItems) ? numericPageItems : [])
    .map((item) => ({
      pageNumber: Number.parseInt(item && item.pageNumber, 10),
      active: Boolean(item && item.active),
    }))
    .filter((item) => Number.isInteger(item.pageNumber));

  if (hasEnabledNextPage) {
    const activeItem = pageItems.find((item) => item.active);
    return {
      hasPagination: pageItems.length > 0,
      activePageNumber: activeItem
        ? activeItem.pageNumber
        : (pageItems.length === 1 ? pageItems[0].pageNumber : null),
      lastPageNumber: pageItems.length > 0
        ? Math.max(...pageItems.map((item) => item.pageNumber))
        : null,
      hasEnabledNextPage: true,
      isLastPage: false,
    };
  }

  if (pageItems.length === 0) {
    return {
      hasPagination: false,
      activePageNumber: 1,
      lastPageNumber: 1,
      hasEnabledNextPage: false,
      isLastPage: true,
    };
  }

  if (pageItems.length === 1) {
    return {
      hasPagination: true,
      activePageNumber: pageItems[0].pageNumber,
      lastPageNumber: pageItems[0].pageNumber,
      hasEnabledNextPage: Boolean(hasEnabledNextPage),
      isLastPage: true,
    };
  }

  const lastPageNumber = Math.max(...pageItems.map((item) => item.pageNumber));
  const activeItem = pageItems.find((item) => item.active);
  const activePageNumber = activeItem ? activeItem.pageNumber : null;

  return {
    hasPagination: true,
    activePageNumber,
    lastPageNumber,
    hasEnabledNextPage: Boolean(hasEnabledNextPage),
    isLastPage: activePageNumber === lastPageNumber,
  };
}

async function getProductPaginationState(page) {
  const paginationSignals = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const disabled = (element) => (
      element.disabled
      || element.getAttribute('aria-disabled') === 'true'
      || /\bdisabled\b/.test(String(element.className || ''))
    );

    const paginationRoots = Array.from(document.querySelectorAll([
      '.ant-pagination',
      '.el-pagination',
      '.ivu-page',
      '.arco-pagination',
      '.pagination',
      '[class*="pagination"]',
    ].join(', '))).filter(isVisible);
    const searchRoots = paginationRoots.length > 0 ? paginationRoots : [document.body];

    const uniqueElements = (elements) => elements.filter((element, index, all) => all.indexOf(element) === index);
    const classText = (element) => String(element.className || '');
    const isActivePageItem = (element) => (
      element.getAttribute('aria-current') === 'page'
      || element.classList.contains('active')
      || element.classList.contains('is-active')
      || /\bant-pagination-item-active\b/.test(classText(element))
      || /\bivu-page-item-active\b/.test(classText(element))
      || /\barco-pagination-item-active\b/.test(classText(element))
    );

    const numericPageItems = uniqueElements(searchRoots.flatMap((root) => Array.from(root.querySelectorAll([
      '.ant-pagination-item',
      '.el-pager li',
      '.ivu-page-item',
      '.arco-pagination-item',
      '[class*="pagination-item"]',
      'li',
    ].join(', ')))))
      .filter((element) => isVisible(element))
      .map((element) => ({
        pageNumber: Number.parseInt(String(element.innerText || element.textContent || '').trim(), 10),
        active: isActivePageItem(element),
      }))
      .filter((item) => Number.isInteger(item.pageNumber));

    const nextPageCandidates = uniqueElements(searchRoots.flatMap((root) => Array.from(root.querySelectorAll([
      '.ant-pagination-next',
      '.el-pagination .btn-next',
      '.ivu-page-next',
      '.arco-pagination-item-next',
      '.pagination-next',
      '[class*="pagination-next"]',
      '[aria-label="下一页"]',
      '[aria-label="Next"]',
      '[aria-label="Next Page"]',
      '[aria-label="next"]',
      '[aria-label="next page"]',
    ].join(', ')))))
      .filter((element) => isVisible(element))
      .map((element) => ({
        text: String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
        ariaLabel: String(element.getAttribute('aria-label') || ''),
        className: classText(element),
        disabled: disabled(element),
      }));
    const hasEnabledNextPage = nextPageCandidates.some((candidate) => !candidate.disabled);

    return {
      numericPageItems,
      hasEnabledNextPage,
      paginationStateDebug: {
        rootCount: paginationRoots.length,
        nextPageCandidates,
      },
    };
  });

  return {
    ...getPaginationStateFromItems(paginationSignals),
    paginationStateDebug: paginationSignals.paginationStateDebug,
  };
}

async function readVisibleProductResultCount(page) {
  const candidates = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const normalize = (value) => String(value || '').replace(/[,，]/g, '').replace(/\s+/g, ' ').trim();
    const statusCountCandidates = Array.from(document.querySelectorAll(
      '.ant-tabs-tab, .el-tabs__item, [role="tab"], .ant-radio-button-wrapper, button, a, li, label, span, div',
    ))
      .filter(isVisible)
      .map((element) => normalize(element.innerText || element.textContent))
      .filter((text) => /在售中\s*(?:[（(]\s*)?\d+/.test(text) && text.length <= 200);
    const paginationCandidates = Array.from(document.querySelectorAll(
      '.ant-pagination-total-text, .el-pagination__total, .ant-pagination, .el-pagination',
    ))
      .filter(isVisible)
      .map((element) => normalize(element.innerText || element.textContent))
      .filter(Boolean);
    return [
      ...statusCountCandidates,
      ...paginationCandidates,
    ].filter((text, index, all) => all.indexOf(text) === index);
  });
  const explicitCount = parseVisibleProductResultCountFromTexts(candidates);

  return Number.isFinite(Number(explicitCount)) ? Number(explicitCount) : null;
}

async function readZeroSalesProductCount(page) {
  const explicitCount = await readVisibleProductResultCount(page);
  if (Number.isFinite(Number(explicitCount))) {
    return Number(explicitCount);
  }

  const paginationState = await getProductPaginationState(page);
  if (Number.isFinite(Number(paginationState.lastPageNumber))) {
    return Number(paginationState.lastPageNumber) * 100;
  }

  return null;
}

async function clickLastNumericPage(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    };

    const candidates = Array.from(document.querySelectorAll(
      '.ant-pagination-item, .el-pager li',
    )).filter((element) => {
      const text = String(element.innerText || element.textContent || '').trim();
      return isVisible(element) && /^\d+$/.test(text);
    });
    const target = candidates[candidates.length - 1];
    if (!target) {
      return '';
    }
    const pageNumber = String(target.innerText || target.textContent || '').trim();
    target.click();
    return pageNumber;
  });
}

async function confirmLastProductPage(page) {
  const paginationState = await getProductPaginationState(page);
  return paginationState.isLastPage;
}

function formatPaginationStateForError(paginationState = {}) {
  const nextCandidates = (((paginationState || {}).paginationStateDebug || {}).nextPageCandidates || [])
    .map((candidate) => `${candidate.text || candidate.ariaLabel || candidate.className || '下一页'}:${candidate.disabled ? 'disabled' : 'enabled'}`)
    .join('；');
  return [
    `当前页=${paginationState.activePageNumber || '未识别'}`,
    `最后页=${paginationState.lastPageNumber || '未识别'}`,
    `下一页=${paginationState.hasEnabledNextPage ? '可点' : '不可点'}`,
    nextCandidates ? `下一页候选=${nextCandidates}` : '',
  ].filter(Boolean).join('，');
}

async function waitForLastProductPage(page, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let paginationState = await getProductPaginationState(page);
  while (Date.now() < deadline) {
    if (paginationState.isLastPage) {
      return paginationState;
    }
    await sleep(250);
    paginationState = await getProductPaginationState(page);
  }
  return paginationState;
}

async function goToLastProductPage(page) {
  await assertProductPageSize100(page, '翻到最后一页前没有确认分页 100条/页');
  const beforeState = await getProductPaginationState(page);
  if (beforeState.isLastPage) {
    emitProgress({
      phase: 'cleanup',
      phaseLabel: '已进入最后一页',
      pageNumber: beforeState.lastPageNumber,
    });
    return;
  }

  const pageNumber = await clickLastNumericPage(page);
  if (!pageNumber) {
    throw new Error('没有找到最后一页页码');
  }
  await waitForNetworkQuiet(page);
  const afterState = await waitForLastProductPage(page);
  if (!afterState.isLastPage) {
    throw new Error(`无法确认当前页是最后一页：${formatPaginationStateForError(afterState)}`);
  }
  emitProgress({
    phase: 'cleanup',
    phaseLabel: '已进入最后一页',
    pageNumber,
  });
}

async function verifySafeProductPage(page, store, explicitStoreOptionText = '') {
  const target = resolveStoreTarget(store, explicitStoreOptionText);
  const storeSearchText = target.storeOptionText || target.storeName;
  const text = await page.evaluate(() => String(document.body.innerText || document.body.textContent || ''));
  const storeVisible = Boolean(storeSearchText) && text.includes(storeSearchText);
  const currentPageSize = await readCurrentProductPageSize(page);
  const zeroSalesFilterInputs = await verifyZeroSalesFilterInputs(page);
  const lastProductPage = await confirmLastProductPage(page);
  const safe = storeVisible
    && currentPageSize === 100
    && text.includes('销量')
    && zeroSalesFilterInputs
    && lastProductPage;

  if (!safe) {
    const safeCheckDetails = [
      storeVisible ? '' : `店铺未确认：${storeSearchText || '空'}`,
      currentPageSize === 100 ? '' : `分页不是100条/页：${currentPageSize || '未识别'}`,
      text.includes('销量') ? '' : '页面未显示销量筛选',
      zeroSalesFilterInputs ? '' : '销量筛选不是0到0',
      lastProductPage ? '' : '当前页不是最后一页',
    ].filter(Boolean).join('；');
    emitProgress({
      phase: 'skip',
      storeName: target.storeName,
      storeOptionText: target.storeOptionText,
      phaseLabel: `安全校验失败：${safeCheckDetails || '未知原因'}，已跳过下架`,
    });
  }

  return safe;
}

async function unpublishCurrentPageProducts(page) {
  const selectedProductCount = await clickCurrentPageSelectAllCheckbox(page);
  await closeTransientMenus(page);
  await clickTopBulkMoreDropdown(page);
  await clickVisibleDropdownAction(page, ['下架产品', '下架商品', '下架']);
  await waitForVisibleText(page, '提示');
  if (await hasVisibleText(page, '确定', 1000)) {
    await clickByText(page, '确定', { exact: true });
  }
  await waitForVisibleText(page, '成功', 30000);

  return selectedProductCount;
}

async function openFilteredZeroSalesProducts(page, target) {
  await openCleanShopProductsPage(page);
  await selectExactStore(page, target);
  await setZeroSalesFilter(page);
  await clickSearchProducts(page);
  await setPageSize100(page);
}

async function cleanupLimitStoreProducts(page, store, { retainCount = DEFAULT_ZERO_SALES_RETAIN_COUNT } = {}) {
  const target = resolveStoreTarget(store);
  const zeroSalesRetainCount = normalizeZeroSalesRetainCount(retainCount);
  let totalUnpublishedCount = 0;
  let cleanupRound = 0;
  let finalZeroSalesProductCount = null;
  let previousZeroSalesProductCount = null;

  while (cleanupRound < MAX_ZERO_SALES_CLEANUP_ROUNDS) {
    await openFilteredZeroSalesProducts(page, target);

    let zeroSalesProductCount = await readZeroSalesProductCount(page);
    finalZeroSalesProductCount = zeroSalesProductCount;
    if (!Number.isFinite(Number(zeroSalesProductCount))) {
      const reason = totalUnpublishedCount > 0
        ? `已下架 ${totalUnpublishedCount} 个后无法确认零销量商品数，已停止`
        : '无法确认零销量商品数，已跳过下架';
      emitProgress({
        phase: 'skip',
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        zeroSalesProductCount,
        retainCount: zeroSalesRetainCount,
        phaseLabel: reason,
      });
      return {
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        zeroSalesProductCount,
        retainCount: zeroSalesRetainCount,
        skipped: totalUnpublishedCount === 0,
        reason,
        unpublishedCount: totalUnpublishedCount,
      };
    }

    if (
      previousZeroSalesProductCount !== null
      && Number(zeroSalesProductCount) >= previousZeroSalesProductCount
    ) {
      emitProgress({
        phase: 'cleanup',
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        zeroSalesProductCount,
        retainCount: zeroSalesRetainCount,
        phaseLabel: `下架后零销量商品数量暂未减少，等待重新确认（当前 ${zeroSalesProductCount} 个，上一轮 ${previousZeroSalesProductCount} 个）`,
        unpublishedCount: totalUnpublishedCount,
      });
      await sleep(3000);
      await openFilteredZeroSalesProducts(page, target);
      zeroSalesProductCount = await readZeroSalesProductCount(page);
      finalZeroSalesProductCount = zeroSalesProductCount;

      if (
        !Number.isFinite(Number(zeroSalesProductCount))
        || Number(zeroSalesProductCount) >= previousZeroSalesProductCount
      ) {
        const error = new Error(
          `下架后零销量商品数量没有减少，当前 ${zeroSalesProductCount || '未确认'} 个，上一轮 ${previousZeroSalesProductCount} 个，保留数量 ${zeroSalesRetainCount} 个`,
        );
        error.unpublishedCount = totalUnpublishedCount;
        error.zeroSalesProductCount = zeroSalesProductCount;
        throw error;
      }
    }

    if (shouldSkipUnpublishByZeroSalesCount(zeroSalesProductCount, zeroSalesRetainCount)) {
      if (totalUnpublishedCount > 0) {
        emitProgress({
          phase: 'cleanup',
          storeName: target.storeName,
          storeOptionText: target.storeOptionText,
          zeroSalesProductCount,
          retainCount: zeroSalesRetainCount,
          phaseLabel: `已完成下架，当前零销量商品 ${zeroSalesProductCount} 个，不超过保留数量 ${zeroSalesRetainCount} 个`,
          unpublishedCount: totalUnpublishedCount,
        });
        return {
          storeName: target.storeName,
          storeOptionText: target.storeOptionText,
          zeroSalesProductCount,
          retainCount: zeroSalesRetainCount,
          unpublishedCount: totalUnpublishedCount,
        };
      }

      const reason = `零销量商品不超过 ${zeroSalesRetainCount} 个（当前 ${zeroSalesProductCount} 个），已跳过下架`;
      emitProgress({
        phase: 'skip',
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        zeroSalesProductCount,
        retainCount: zeroSalesRetainCount,
        phaseLabel: reason,
      });
      return {
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        zeroSalesProductCount,
        retainCount: zeroSalesRetainCount,
        skipped: true,
        reason,
        unpublishedCount: 0,
      };
    }

    emitProgress({
      phase: 'cleanup',
      storeName: target.storeName,
      storeOptionText: target.storeOptionText,
      zeroSalesProductCount,
      retainCount: zeroSalesRetainCount,
      phaseLabel: `零销量商品 ${zeroSalesProductCount} 个，超过保留数量 ${zeroSalesRetainCount} 个，准备下架最后一页`,
      cleanupRound: cleanupRound + 1,
    });

    previousZeroSalesProductCount = Number(zeroSalesProductCount);

    await goToLastProductPage(page);

    const safe = await verifySafeProductPage(page, target);
    if (!safe) {
      return {
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        zeroSalesProductCount,
        retainCount: zeroSalesRetainCount,
        skipped: totalUnpublishedCount === 0,
        reason: '安全校验失败',
        unpublishedCount: totalUnpublishedCount,
      };
    }

    const unpublishedCount = await unpublishCurrentPageProducts(page);
    totalUnpublishedCount += unpublishedCount;
    cleanupRound += 1;
  }

  const error = new Error(`下架轮次超过 ${MAX_ZERO_SALES_CLEANUP_ROUNDS} 轮，当前零销量商品 ${finalZeroSalesProductCount || '未确认'} 个，保留数量 ${zeroSalesRetainCount} 个`);
  error.unpublishedCount = totalUnpublishedCount;
  error.zeroSalesProductCount = finalZeroSalesProductCount;
  throw error;
}

async function recoverAfterStoreCleanupFailure(page) {
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
    return;
  }

  try {
    await openCleanShopProductsPage(page);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    emitProgress({
      phase: 'cleanup',
      phaseLabel: isNavigationContextError(error)
        ? '店铺产品页面刚刷新，恢复失败，下一步会重新打开'
        : `店铺产品页面恢复失败：${message}`,
    });
  }
}

async function runProductLimitStoreCleanup({
  page,
  maxPages = 5,
  dryRun = false,
  stores = [],
  retainCount = DEFAULT_ZERO_SALES_RETAIN_COUNT,
} = {}) {
  if (!page) {
    throw new Error('runProductLimitStoreCleanup 需要传入 page。');
  }
  const zeroSalesRetainCount = normalizeZeroSalesRetainCount(retainCount);

  let scannedFailureRecords = 0;
  let matchedStores = [];

  if (Array.isArray(stores) && stores.length > 0) {
    matchedStores = resolveManualStoreTargets(stores);
    emitProgress({
      phase: 'scan',
      phaseLabel: `已记录 ${matchedStores.length} 个店铺`,
      matchedStores,
      total: matchedStores.length,
      totalCount: matchedStores.length,
    });
  } else {
    const scanResult = await scanProductLimitFailureStores(page, { maxPages });
    scannedFailureRecords = scanResult.scannedFailureRecords;
    matchedStores = scanResult.matchedStores;
  }

  if (dryRun) {
    const summary = buildLimitStoreSummary({
      scannedFailureRecords,
      matchedStores,
      results: [],
      failedItems: [],
      retainCount: zeroSalesRetainCount,
    });
    emitProgress({
      phase: 'complete',
      phaseLabel: '商品管理上限店铺下架 dry-run 完成',
      summary,
    });
    return summary;
  }

  const results = [];
  const failedItems = [];

  for (const matchedStore of matchedStores) {
    const target = resolveStoreTarget(matchedStore);
    try {
      results.push(await cleanupLimitStoreProducts(page, target, { retainCount: zeroSalesRetainCount }));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const failureReason = message.startsWith('当前店铺下架失败')
        ? message
        : `当前店铺下架失败：${message}`;
      const partialUnpublishedCount = Number.isFinite(Number(error && error.unpublishedCount))
        ? Number(error.unpublishedCount)
        : 0;
      const skippedResult = {
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        retainCount: zeroSalesRetainCount,
        skipped: true,
        reason: failureReason,
        error: failureReason,
        unpublishedCount: partialUnpublishedCount,
      };
      if (Object.prototype.hasOwnProperty.call(error || {}, 'zeroSalesProductCount')) {
        skippedResult.zeroSalesProductCount = error.zeroSalesProductCount;
      }
      results.push(skippedResult);
      failedItems.push({
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        reason: failureReason,
      });
      emitProgress({
        phase: 'skip',
        storeName: target.storeName,
        storeOptionText: target.storeOptionText,
        phaseLabel: `${failureReason}，继续处理下一个店铺`,
        unpublishedCount: partialUnpublishedCount,
      });
      await recoverAfterStoreCleanupFailure(page);
    }
  }

  const summary = buildLimitStoreSummary({
    scannedFailureRecords,
    matchedStores,
    results,
    failedItems,
    retainCount: zeroSalesRetainCount,
  });

  emitProgress({
    phase: 'complete',
    phaseLabel: '商品管理上限店铺下架完成',
    summary,
  });

  return summary;
}

module.exports = {
  DEFAULT_ZERO_SALES_RETAIN_COUNT,
  PRODUCT_LIMIT_REASON_PATTERNS,
  ZERO_SALES_UNPUBLISH_THRESHOLD,
  buildMatchedLimitStoreRecords,
  buildLimitStoreSummary,
  dedupeLimitStoreRecords,
  emitProgress,
  getPaginationStateFromItems,
  looksLikeSelectedStoreText,
  parseProductPageSizeFromTexts,
  parseVisibleProductResultCountFromTexts,
  scanProductLimitFailureStores,
  cleanupLimitStoreProducts,
  matchesProductLimitFailureReason,
  normalizeStoreName,
  normalizeStoreOptionText,
  normalizeZeroSalesRetainCount,
  resolveManualStoreTargets,
  runProductLimitStoreCleanup,
  shouldSkipUnpublishByZeroSalesCount,
};
