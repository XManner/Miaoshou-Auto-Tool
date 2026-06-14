const {
  getDefaultAiModel,
  isDeepSeekModel,
} = require('./ai_provider_config');

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_AI_JSON_PARSE_RETRY_COUNT = Math.max(
  0,
  Math.floor(parseNumber(process.env.AI_JSON_PARSE_RETRY_COUNT, 1)),
);

function extractFirstJsonObject(text = '') {
  const source = String(text || '');
  const start = source.indexOf('{');

  if (start === -1) {
    return '';
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return '';
}

function parseKimiJsonContent(content, {
  allowPlainTextFallback = true,
  allowJsonObjectExtraction = true,
} = {}) {
  const text = String(content || '').trim();

  if (!text) {
    throw new Error('AI returned an empty JSON response.');
  }

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstJsonObject = allowJsonObjectExtraction ? extractFirstJsonObject(cleaned) : '';

    if (firstJsonObject) {
      try {
        return JSON.parse(firstJsonObject);
      } catch (jsonError) {
        throw new Error(
          `Failed to parse AI JSON response: ${jsonError.message}. Raw response preview: ${cleaned.slice(0, 300)}`,
        );
      }
    }

    if (allowPlainTextFallback) {
      return { optimizedTitle: cleaned };
    }

    throw new Error(
      `Failed to parse AI JSON response: response is not a standalone JSON object. Raw response preview: ${cleaned.slice(0, 300)}`,
    );
  }
}

function getChatCompletionMessageContent(completion = {}) {
  return completion
    && completion.choices
    && completion.choices[0]
    && completion.choices[0].message
    && completion.choices[0].message.content;
}

function buildInvalidJsonRetryMessages(messages = [], invalidContent = '') {
  return [
    ...messages,
    {
      role: 'assistant',
      content: String(invalidContent || '').slice(0, 2000),
    },
    {
      role: 'user',
      content: [
        '上一次回复不是合法 JSON，请重新输出。',
        '只输出一个能被 JSON.parse 直接解析的 JSON 对象。',
        '不要输出 Markdown、解释、注释、代码表达式、条件表达式、字符串拼接或多余文本。',
        '字符串值必须是最终文本，不能包含变量、函数调用、+ 号拼接或三元表达式。',
        '必须保持前面要求的 JSON schema。',
      ].join('\n'),
    },
  ];
}

async function createAiJsonChatCompletion(requestBody = {}, {
  createChatCompletion,
  getDefaultModel = getDefaultAiModel,
  isDeepSeekModelFn = isDeepSeekModel,
  retryCount = DEFAULT_AI_JSON_PARSE_RETRY_COUNT,
  retryTemperature = 0,
} = {}) {
  if (typeof createChatCompletion !== 'function') {
    throw new Error('createChatCompletion is required for AI JSON completion.');
  }

  const model = requestBody.model || getDefaultModel();
  const shouldRetryInvalidJson = isDeepSeekModelFn(model) && retryCount > 0;
  const parseOptions = {
    allowPlainTextFallback: !shouldRetryInvalidJson,
    allowJsonObjectExtraction: !shouldRetryInvalidJson,
  };

  const completion = await createChatCompletion(requestBody);
  const content = getChatCompletionMessageContent(completion);

  try {
    return {
      payload: parseKimiJsonContent(content, parseOptions),
      content,
      retried: false,
    };
  } catch (firstError) {
    if (!shouldRetryInvalidJson) {
      throw firstError;
    }

    let lastError = firstError;
    let lastContent = content;
    let retryMessages = buildInvalidJsonRetryMessages(requestBody.messages || [], content);

    for (let attempt = 0; attempt < retryCount; attempt += 1) {
      const retryCompletion = await createChatCompletion({
        ...requestBody,
        temperature: retryTemperature,
        messages: retryMessages,
      });
      const retryContent = getChatCompletionMessageContent(retryCompletion);

      try {
        return {
          payload: parseKimiJsonContent(retryContent, parseOptions),
          content: retryContent,
          retried: true,
        };
      } catch (retryError) {
        lastError = retryError;
        lastContent = retryContent;
        retryMessages = buildInvalidJsonRetryMessages(requestBody.messages || [], retryContent);
      }
    }

    throw new Error(
      `DeepSeek returned invalid JSON after ${retryCount} retry: ${lastError.message}. `
      + `Last raw response preview: ${String(lastContent || '').trim().slice(0, 300)}`,
    );
  }
}

module.exports = {
  DEFAULT_AI_JSON_PARSE_RETRY_COUNT,
  buildInvalidJsonRetryMessages,
  createAiJsonChatCompletion,
  extractFirstJsonObject,
  getChatCompletionMessageContent,
  parseKimiJsonContent,
};
