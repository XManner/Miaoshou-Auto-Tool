const fs = require('fs');
const path = require('path');
const ENV_ONLY_KEYS = new Set([
  // Add keys here only when they must be supplied by the shell environment
  // and should be ignored if present in .env.
]);

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }

  return value;
}

function loadDotEnv(filePath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));

    if (ENV_ONLY_KEYS.has(key)) {
      continue;
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requireConfig(name, value) {
  if (!value) {
    throw new Error(`Missing required config: ${name}. Set it in .env or environment variables.`);
  }

  return value;
}

loadDotEnv();

const APP_ID = requireConfig('MIAOSHOU_APP_ID', process.env.MIAOSHOU_APP_ID || process.env.APP_ID);
const APP_SECRET = requireConfig(
  'MIAOSHOU_APP_SECRET',
  process.env.MIAOSHOU_APP_SECRET || process.env.APP_SECRET,
);
const MS_URL = process.env.MIAOSHOU_MS_URL || process.env.MS_URL || 'https://openapi-erp.91miaoshou.com';

module.exports = { APP_ID, APP_SECRET, MS_URL };
