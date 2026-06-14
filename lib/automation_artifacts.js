const fs = require('fs');
const path = require('path');

const DEFAULT_ARTIFACT_DIR = path.join(__dirname, '..', '.diagnostics');

function safeArtifactPart(value = '') {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'artifact';
}

function safeRunId(value = '') {
  return String(value || 'manual')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 160) || 'manual';
}

function runArtifactDir(runId = '', options = {}) {
  return path.join(options.dir || DEFAULT_ARTIFACT_DIR, safeRunId(runId));
}

function artifactUrl(runId = '', fileName = '') {
  return `/api/diagnostics/${encodeURIComponent(safeRunId(runId))}/artifacts/${encodeURIComponent(path.basename(fileName))}`;
}

function artifactFilePath(runId = '', fileName = '', options = {}) {
  const safeName = path.basename(String(fileName || ''));
  return safeName ? path.join(runArtifactDir(runId, options), safeName) : '';
}

function timestampPart(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function readPageValue(page, methodName, fallback = '') {
  try {
    if (!page || typeof page[methodName] !== 'function') {
      return fallback;
    }
    const value = page[methodName]();
    return await Promise.resolve(value);
  } catch (error) {
    return fallback;
  }
}

function writeTruncatedHtml(filePath, html = '', maxChars = 500000) {
  const text = String(html || '');
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Number(maxChars) : 500000;
  const truncated = text.length > limit;
  const body = truncated
    ? `${text.slice(0, limit)}\n<!-- HTML truncated: original length ${text.length}, kept ${limit} chars -->\n`
    : text;
  fs.writeFileSync(filePath, body, 'utf8');
  return { truncated, originalLength: text.length, writtenLength: body.length };
}

async function capturePageArtifact(page, options = {}) {
  if (!page) {
    return null;
  }

  const runId = safeRunId(options.runId);
  const stage = safeArtifactPart(options.stage || 'page');
  const label = String(options.label || '').trim();
  const index = Number.isFinite(Number(options.index)) ? Number(options.index) : 0;
  const capturedAt = new Date();
  const baseName = `${timestampPart(capturedAt)}-${stage}-${index}`;
  const dir = runArtifactDir(runId, options);
  fs.mkdirSync(dir, { recursive: true });

  const screenshotName = `${baseName}.png`;
  const htmlName = `${baseName}.html`;
  const metadataName = `${baseName}.json`;
  const screenshotPath = path.join(dir, screenshotName);
  const htmlPath = path.join(dir, htmlName);
  const metadataPath = path.join(dir, metadataName);
  const errors = [];

  try {
    if (typeof page.screenshot === 'function') {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }
  } catch (error) {
    errors.push(`screenshot: ${error.message || String(error)}`);
  }

  let htmlInfo = { truncated: false, originalLength: 0, writtenLength: 0 };
  try {
    const html = await readPageValue(page, 'content', '');
    htmlInfo = writeTruncatedHtml(htmlPath, html, options.htmlMaxChars);
  } catch (error) {
    errors.push(`html: ${error.message || String(error)}`);
  }

  const pageUrl = await readPageValue(page, 'url', '');
  const title = await readPageValue(page, 'title', '');
  const metadata = {
    runId,
    capturedAt: capturedAt.toISOString(),
    stage,
    label,
    index,
    url: pageUrl,
    title,
    html: htmlInfo,
    errors,
    files: {
      screenshot: {
        name: screenshotName,
        path: screenshotPath,
        url: artifactUrl(runId, screenshotName),
      },
      html: {
        name: htmlName,
        path: htmlPath,
        url: artifactUrl(runId, htmlName),
      },
      metadata: {
        name: metadataName,
        path: metadataPath,
        url: artifactUrl(runId, metadataName),
      },
    },
  };

  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

async function captureBrowserArtifacts(browser, options = {}) {
  const runId = safeRunId(options.runId);
  const dir = runArtifactDir(runId, options);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 3;
  const artifacts = [];
  if (!browser || typeof browser.pages !== 'function') {
    return { runId, dir, artifacts };
  }

  const pages = await browser.pages().catch(() => []);
  for (const [index, page] of pages.slice(-limit).entries()) {
    const artifact = await capturePageArtifact(page, {
      ...options,
      runId,
      index,
      label: options.label || `page-${index + 1}`,
    });
    if (artifact) {
      artifacts.push(artifact);
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({
    runId,
    capturedAt: new Date().toISOString(),
    stage: options.stage || '',
    error: options.error ? String(options.error.message || options.error) : '',
    artifacts,
  }, null, 2)}\n`, 'utf8');

  return { runId, dir, artifacts };
}

function loadRunArtifacts(runId = '', options = {}) {
  const safeId = safeRunId(runId);
  const dir = runArtifactDir(safeId, options);
  if (!fs.existsSync(dir)) {
    return { runId: safeId, dir, artifacts: [] };
  }

  const indexPath = path.join(dir, 'index.json');
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      return {
        runId: safeId,
        dir,
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
      };
    } catch (error) {
      return { runId: safeId, dir, artifacts: [] };
    }
  }

  const artifacts = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json') && file !== 'index.json')
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

  return { runId: safeId, dir, artifacts };
}

module.exports = {
  DEFAULT_ARTIFACT_DIR,
  safeArtifactPart,
  safeRunId,
  runArtifactDir,
  artifactUrl,
  artifactFilePath,
  capturePageArtifact,
  captureBrowserArtifacts,
  loadRunArtifacts,
};
