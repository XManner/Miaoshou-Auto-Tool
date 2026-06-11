const assert = require('assert');
const fs = require('fs');
const path = require('path');
const localImagePolicy = require('../lib/local_image_policy.js');
const { normalizeImageUrl } = require('../lib/image_policy.js');

const autoSource = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_auto.js'), 'utf8');

function buildBmpHeader({ width = 1, height = 1, bitsPerPixel = 24 } = {}) {
  const buffer = Buffer.alloc(54);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(bitsPerPixel, 28);
  return buffer;
}

async function main() {
  assert.strictEqual(
    typeof localImagePolicy.analyzeBmpForDisclaimer,
    'function',
    'BMP disclaimer analysis should live in lib/local_image_policy.js.',
  );
  assert.strictEqual(
    typeof localImagePolicy.buildLocalImagePolicyVerdictMap,
    'function',
    'Local image verdict map builder should live in lib/local_image_policy.js.',
  );

  assert.deepStrictEqual(
    localImagePolicy.analyzeBmpForDisclaimer(Buffer.from('not a bmp')),
    {
      isIrrelevant: false,
      reason: 'not_bmp',
    },
    'Non-BMP buffers should be ignored safely.',
  );
  assert.deepStrictEqual(
    localImagePolicy.analyzeBmpForDisclaimer(buildBmpHeader({ bitsPerPixel: 32 })),
    {
      isIrrelevant: false,
      reason: 'unsupported_bmp',
    },
    'Unsupported BMP formats should be ignored safely.',
  );

  let abortedSignal = null;
  const imagePayload = Buffer.from([1, 2, 3, 4]);
  const downloaded = await localImagePolicy.downloadImageBuffer('https://img.example.com/a.jpg', {
    fetchImpl: async (url, options = {}) => {
      abortedSignal = options.signal;
      return {
        ok: true,
        headers: {
          get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : ''),
        },
        arrayBuffer: async () => imagePayload,
      };
    },
    timeoutMs: 50,
    maxBytes: 10,
  });
  assert.deepStrictEqual(
    downloaded,
    {
      buffer: imagePayload,
      contentType: 'image/jpeg',
    },
    'Image download helper should return a small image buffer and content type.',
  );
  assert.ok(abortedSignal, 'Image download helper should pass an abort signal to fetch.');

  const notImage = await localImagePolicy.downloadImageBuffer('https://img.example.com/a.txt', {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'text/plain' },
      arrayBuffer: async () => Buffer.from('not-image'),
    }),
  });
  assert.strictEqual(notImage, null, 'Non-image responses should be ignored.');

  const tooLarge = await localImagePolicy.downloadImageBuffer('https://img.example.com/a.jpg', {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from([1, 2, 3, 4]),
    }),
    maxBytes: 2,
  });
  assert.strictEqual(tooLarge, null, 'Oversized image downloads should be ignored.');

  const couponUrl = 'https://img.example.com/factory-poster.jpg?x=1';
  const productUrl = 'https://img.example.com/product-main.jpg?size=large#hash';
  const tailUrl = 'https://img.example.com/tail-product.jpg';
  const checkedUrls = [];
  const verdictMap = await localImagePolicy.buildLocalImagePolicyVerdictMap([
    couponUrl,
    productUrl,
    'https://img.example.com/middle.jpg',
    tailUrl,
  ], {
    maxCheckCount: 3,
    detectContent: async (url) => {
      checkedUrls.push(url);
      return url.includes('tail-product')
        ? { isIrrelevant: true, reason: 'local_tail_notice', whiteRatio: 0.9 }
        : { isIrrelevant: false, reason: 'image_policy_passed', whiteRatio: 0.1 };
    },
  });

  assert.deepStrictEqual(
    verdictMap.get(normalizeImageUrl(couponUrl)),
    {
      isRelevant: false,
      reason: 'irrelevant_url_pattern',
    },
    'Known irrelevant URL patterns should be rejected without local content detection.',
  );
  assert.deepStrictEqual(
    checkedUrls,
    [
      normalizeImageUrl(productUrl),
      normalizeImageUrl(tailUrl),
    ],
    'Local image policy should check selected head and tail images after URL-pattern filtering.',
  );
  assert.deepStrictEqual(
    verdictMap.get(normalizeImageUrl(tailUrl)),
    {
      isRelevant: false,
      reason: 'local_tail_notice',
      visualProfile: {
        isIrrelevant: true,
        reason: 'local_tail_notice',
        whiteRatio: 0.9,
      },
    },
    'Local content verdicts should be preserved as visual profiles.',
  );

  assert.ok(
    autoSource.includes("require('./lib/local_image_policy')"),
    'miaoshou_auto.js should import local image policy helpers from lib/local_image_policy.js.',
  );
}

main()
  .then(() => {
    console.log('local image policy module checks passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
