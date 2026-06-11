const {
  DEFAULT_DEEPSEEK_MAX_RETRIES,
  DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS,
  DEFAULT_MIMO_MAX_RETRIES,
  DEFAULT_MIMO_MODEL,
  DEFAULT_MIMO_REQUEST_TIMEOUT_MS,
  buildDeepSeekApiUrl,
  buildMimoApiUrl,
  getMimoApiKey,
} = require('./ai_provider_config');

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJsonText(text = '') {
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    return { raw: text };
  }
}

function buildDeepSeekChatCompletionRequestBody(requestBody = {}) {
  if (requestBody.thinking) {
    return requestBody;
  }
  const thinkingType = String(process.env.DEEPSEEK_THINKING || 'disabled').toLowerCase() === 'enabled'
    ? 'enabled'
    : 'disabled';

  return {
    ...requestBody,
    thinking: { type: thinkingType },
  };
}

function isRetryableDeepSeekError(error = {}) {
  const statusCode = Number(error.statusCode || error.status || 0);
  const code = String(error.code || '');
  const message = String(error.message || '');

  return statusCode === 503
    || code === 'ETIMEDOUT'
    || /DeepSeek request timed out/i.test(message)
    || /^503\b/.test(message)
    || /Service is too busy/i.test(message);
}

async function createMimoChatCompletion(requestBody = {}, {
  apiKey = getMimoApiKey(),
  fetchImpl = fetch,
  logMimoCallMetrics = () => {},
  maxRetries = DEFAULT_MIMO_MAX_RETRIES,
  sleepImpl = defaultSleep,
  taskLabel = 'MiMo 视觉调用',
  timeoutMs = DEFAULT_MIMO_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!apiKey) {
    throw new Error('Missing Mimo_API_KEY. Set it in .env before using MiMo image optimization.');
  }

  let lastError;
  const maxAttempts = maxRetries + 1;
  const requestPayload = {
    ...requestBody,
    model: requestBody.model || DEFAULT_MIMO_MODEL,
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(buildMimoApiUrl('/chat/completions'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });
      const payload = parseJsonText(await response.text());

      if (!response.ok) {
        const message = payload && payload.error && payload.error.message
          ? payload.error.message
          : (payload && payload.message ? payload.message : response.statusText);
        const apiError = new Error(`MiMo API ${response.status}: ${message}`);
        apiError.statusCode = response.status;
        throw apiError;
      }

      logMimoCallMetrics({
        taskLabel,
        durationMs: Date.now() - startedAt,
        usage: payload && payload.usage ? payload.usage : {},
      });

      return payload;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        lastError = new Error(`MiMo request timed out after ${timeoutMs}ms`);
        lastError.code = 'ETIMEDOUT';
      } else {
        lastError = error;
      }

      if (attempt + 1 >= maxAttempts) {
        throw lastError;
      }

      await sleepImpl(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('MiMo request failed.');
}

async function createDeepSeekChatCompletion(requestBody = {}, {
  apiKey = process.env.DEEPSEEK_API_KEY,
  fetchImpl = fetch,
  maxRetries = DEFAULT_DEEPSEEK_MAX_RETRIES,
  sleepImpl = defaultSleep,
  timeoutMs = DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY. Set it in .env before optimizing titles with DeepSeek.');
  }

  let lastError;
  const maxAttempts = maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(buildDeepSeekApiUrl('/chat/completions'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildDeepSeekChatCompletionRequestBody(requestBody)),
        signal: controller.signal,
      });
      const payload = parseJsonText(await response.text());

      if (!response.ok) {
        const message = payload && payload.error && payload.error.message
          ? payload.error.message
          : (payload && payload.message ? payload.message : response.statusText);
        const apiError = new Error(`${response.status} ${message}`);
        apiError.statusCode = response.status;
        throw apiError;
      }

      return payload;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        lastError = new Error(`DeepSeek request timed out after ${timeoutMs}ms`);
        lastError.code = 'ETIMEDOUT';
      } else {
        lastError = error;
      }

      if (attempt + 1 >= maxAttempts || !isRetryableDeepSeekError(lastError)) {
        throw lastError;
      }

      await sleepImpl(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('DeepSeek request failed.');
}

module.exports = {
  buildDeepSeekChatCompletionRequestBody,
  createDeepSeekChatCompletion,
  createMimoChatCompletion,
  defaultSleep,
  isRetryableDeepSeekError,
  parseJsonText,
};
