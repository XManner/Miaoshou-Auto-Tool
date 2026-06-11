const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { uniqueUrlList } = require('./source_item_links');
const {
  isLikelyIrrelevantImageUrl,
  normalizeImageUrl,
} = require('./image_policy');

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = parsePositiveInteger(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS, 12000);
const ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK = String(process.env.ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK || '1') !== '0';
const DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT = parsePositiveInteger(process.env.LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT, 20);
const DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES = parsePositiveInteger(process.env.LOCAL_IMAGE_POLICY_MAX_BYTES, 3500000);

async function downloadImageBuffer(url, {
  timeoutMs = DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
  maxBytes = DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES,
  fetchImpl = globalThis.fetch,
  abortControllerImpl = globalThis.AbortController,
} = {}) {
  if (!url || typeof fetchImpl !== 'function') {
    return null;
  }

  const controller = typeof abortControllerImpl === 'function'
    ? new abortControllerImpl()
    : null;
  const timer = controller && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!response || !response.ok || typeof response.arrayBuffer !== 'function') {
      return null;
    }

    const contentType = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type') || ''
      : '';
    if (contentType && !/^image\//i.test(contentType)) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || (maxBytes && buffer.length > maxBytes)) {
      return null;
    }

    return {
      buffer,
      contentType,
    };
  } catch (error) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function analyzeBmpForDisclaimer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') {
    return {
      isIrrelevant: false,
      reason: 'not_bmp',
    };
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitsPerPixel = buffer.readUInt16LE(28);

  if (width <= 0 || height <= 0 || bitsPerPixel !== 24) {
    return {
      isIrrelevant: false,
      reason: 'unsupported_bmp',
    };
  }

  const stride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  let yellowPixels = 0;
  let blackPixels = 0;
  let whitePixels = 0;
  let redPixels = 0;
  let tealPixels = 0;
  let grayLinePixels = 0;
  let lightMachineryPixels = 0;
  let goldTextPixels = 0;
  let blueTextPixels = 0;
  let topBandBluePixels = 0;
  let topBandRedPixels = 0;
  let topBandWhitePixels = 0;
  let topBandPixels = 0;
  let topTitleDarkPixels = 0;
  let topTitlePixels = 0;
  let lowerPanelTextPixels = 0;
  let lowerPanelPixels = 0;
  let whitePanelTextPixels = 0;
  let whitePanelPixels = 0;
  let sampledPixels = 0;
  const quadrantColorBuckets = [new Set(), new Set(), new Set(), new Set()];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 400));

  for (let y = 0; y < height; y += step) {
    const rowOffset = pixelOffset + (rawHeight > 0 ? (height - 1 - y) : y) * stride;
    for (let x = 0; x < width; x += step) {
      const offset = rowOffset + x * 3;
      const blue = buffer[offset];
      const green = buffer[offset + 1];
      const red = buffer[offset + 2];

      sampledPixels += 1;
      if (red > 185 && green > 165 && blue < 145) {
        yellowPixels += 1;
      }
      if (red < 80 && green < 80 && blue < 80) {
        blackPixels += 1;
      }
      if (red > 230 && green > 230 && blue > 230) {
        whitePixels += 1;
      }
      if (red > 170 && green < 95 && blue < 95) {
        redPixels += 1;
      }
      if (green > 80 && blue > 80 && red < 95 && green >= red + 30) {
        tealPixels += 1;
      }
      const isGoldTextPixel = red >= 135
        && green >= 95
        && green <= 185
        && blue <= 140
        && red >= blue + 30;
      const isBlueTextPixel = blue >= 85
        && red <= 160
        && green <= 170
        && blue >= red + 8;
      const isDarkTextPixel = red <= 120 && green <= 120 && blue <= 140;
      if (isGoldTextPixel) {
        goldTextPixels += 1;
      }
      if (isBlueTextPixel) {
        blueTextPixels += 1;
      }
      if (
        Math.abs(red - green) < 18
        && Math.abs(red - blue) < 18
        && red >= 125
        && red <= 225
      ) {
        grayLinePixels += 1;
      }
      if (
        red > 155
        && green > 155
        && blue > 155
        && Math.abs(red - green) < 45
        && Math.abs(red - blue) < 45
      ) {
        lightMachineryPixels += 1;
      }
      if (y < height * 0.28) {
        topBandPixels += 1;
        if (blue > 135 && green > 80 && red < 105 && blue >= red + 40) {
          topBandBluePixels += 1;
        }
        if (red > 145 && green < 95 && blue < 105) {
          topBandRedPixels += 1;
        }
        if (red > 220 && green > 220 && blue > 220) {
          topBandWhitePixels += 1;
        }
      }
      if (
        y >= height * 0.06
        && y <= height * 0.34
        && x >= width * 0.12
        && x <= width * 0.88
      ) {
        topTitlePixels += 1;
        if (isDarkTextPixel || isGoldTextPixel || isBlueTextPixel) {
          topTitleDarkPixels += 1;
        }
      }
      if (
        y >= height * 0.36
        && y <= height * 0.94
        && x >= width * 0.12
        && x <= width * 0.88
      ) {
        lowerPanelPixels += 1;
        if (isGoldTextPixel || isBlueTextPixel || isDarkTextPixel) {
          lowerPanelTextPixels += 1;
        }
      }
      if (
        y >= height * 0.12
        && y <= height * 0.94
        && x >= width * 0.08
        && x <= width * 0.92
      ) {
        whitePanelPixels += 1;
        if (isGoldTextPixel || isBlueTextPixel || isDarkTextPixel || (red > 160 && green < 90 && blue < 100)) {
          whitePanelTextPixels += 1;
        }
      }

      const quadrantIndex = (x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0);
      const colorBucket = `${Math.floor(red / 48)}-${Math.floor(green / 48)}-${Math.floor(blue / 48)}`;
      quadrantColorBuckets[quadrantIndex].add(colorBucket);
    }
  }

  const yellowRatio = sampledPixels > 0 ? yellowPixels / sampledPixels : 0;
  const blackRatio = sampledPixels > 0 ? blackPixels / sampledPixels : 0;
  const whiteRatio = sampledPixels > 0 ? whitePixels / sampledPixels : 0;
  const redRatio = sampledPixels > 0 ? redPixels / sampledPixels : 0;
  const tealRatio = sampledPixels > 0 ? tealPixels / sampledPixels : 0;
  const grayLineRatio = sampledPixels > 0 ? grayLinePixels / sampledPixels : 0;
  const lightMachineryRatio = sampledPixels > 0 ? lightMachineryPixels / sampledPixels : 0;
  const goldTextRatio = sampledPixels > 0 ? goldTextPixels / sampledPixels : 0;
  const blueTextRatio = sampledPixels > 0 ? blueTextPixels / sampledPixels : 0;
  const topBandBlueRatio = topBandPixels > 0 ? topBandBluePixels / topBandPixels : 0;
  const topBandRedRatio = topBandPixels > 0 ? topBandRedPixels / topBandPixels : 0;
  const topBandWhiteRatio = topBandPixels > 0 ? topBandWhitePixels / topBandPixels : 0;
  const topTitleDarkRatio = topTitlePixels > 0 ? topTitleDarkPixels / topTitlePixels : 0;
  const lowerPanelTextRatio = lowerPanelPixels > 0 ? lowerPanelTextPixels / lowerPanelPixels : 0;
  const whitePanelTextRatio = whitePanelPixels > 0 ? whitePanelTextPixels / whitePanelPixels : 0;
  const quadrantDiversity = quadrantColorBuckets
    .filter((bucketSet) => bucketSet.size >= 18)
    .length;
  const looksLikeYellowTextNotice = (
    width >= 500
    && height >= 500
    && yellowRatio >= 0.25
    && blackRatio >= 0.035
    && whiteRatio <= 0.25
  );
  const looksLikeShopRecommendationGrid = (
    width >= 600
    && height >= 600
    && whiteRatio >= 0.35
    && blackRatio >= 0.035
    && grayLineRatio >= 0.05
    && redRatio >= 0.005
    && quadrantDiversity >= 4
  );
  const looksLikeFactoryWorkshopPanel = (
    width >= 600
    && height >= 600
    && tealRatio >= 0.12
    && lightMachineryRatio >= 0.38
    && whiteRatio >= 0.18
    && (redRatio >= 0.01 || topBandRedRatio >= 0.03)
  );
  const looksLikeRedLegalStatementPanel = (
    width >= 500
    && height >= 500
    && redRatio >= 0.16
    && topBandRedRatio >= 0.24
    && topBandWhiteRatio >= 0.025
    && whiteRatio >= 0.10
    && lowerPanelTextRatio >= 0.018
    && (goldTextRatio >= 0.006 || blueTextRatio >= 0.006 || lowerPanelTextRatio >= 0.04)
  );
  const looksLikeRedDisclaimerCardPanel = (
    width >= 500
    && height >= 500
    && redRatio >= 0.25
    && lightMachineryRatio >= 0.075
    && blackRatio >= 0.008
    && whiteRatio <= 0.08
    && topBandRedRatio >= 0.45
    && lowerPanelTextRatio >= 0.07
    && whitePanelTextRatio >= 0.16
    && quadrantDiversity >= 3
  );
  const looksLikeRedCouponBanner = (
    width >= 450
    && height >= 180
    && width / height >= 1.5
    && redRatio >= 0.45
    && whiteRatio >= 0.035
    && yellowRatio >= 0.004
    && blackRatio <= 0.08
    && whitePanelTextRatio >= 0.25
    && quadrantDiversity >= 3
  );
  const looksLikePastelStatementPanel = (
    width >= 600
    && height >= 600
    && (whiteRatio >= 0.34 || lightMachineryRatio >= 0.62)
    && blackRatio >= 0.025
    && redRatio <= 0.035
    && topTitleDarkRatio >= 0.08
    && lowerPanelTextRatio >= 0.025
    && quadrantDiversity <= 4
  );
  const looksLikeLightTextNoticePanel = (
    width >= 500
    && height >= 500
    && lightMachineryRatio >= 0.84
    && whiteRatio <= 0.18
    && blackRatio >= 0.018
    && redRatio <= 0.025
    && topTitleDarkRatio >= 0.035
    && lowerPanelTextRatio >= 0.055
    && whitePanelTextRatio >= 0.045
    && quadrantDiversity <= 3
  );
  const looksLikeWideTextNoticePanel = (
    width >= 450
    && height >= 100
    && width / height >= 2.2
    && whiteRatio >= 0.55
    && blackRatio >= 0.035
    && redRatio >= 0.003
    && topTitleDarkRatio >= 0.08
    && whitePanelTextRatio >= 0.08
    && quadrantDiversity <= 2
  );
  const looksLikeRedTextReturnNoticePanel = (
    width >= 450
    && height >= 250
    && whiteRatio >= 0.55
    && redRatio >= 0.025
    && redRatio <= 0.12
    && blackRatio <= 0.02
    && lightMachineryRatio >= 0.70
    && lowerPanelTextRatio >= 0.025
    && whitePanelTextRatio >= 0.07
    && quadrantDiversity <= 4
  );
  const looksLikeBlackLegalStatementPanel = (
    width >= 450
    && height >= 280
    && blackRatio >= 0.75
    && grayLineRatio >= 0.05
    && (yellowRatio >= 0.0008 || whiteRatio >= 0.003)
  );
  const looksLikeWhiteStoreStatementPanel = (
    width >= 600
    && height >= 450
    && whiteRatio >= 0.45
    && blackRatio >= 0.008
    && redRatio >= 0.006
    && (goldTextRatio >= 0.006 || grayLineRatio >= 0.02)
    && whitePanelTextRatio >= 0.035
  );
  const looksLikeGovernmentFilingScreenshot = (
    width >= 700
    && height >= 450
    && topBandBlueRatio >= 0.18
    && whiteRatio >= 0.65
    && topTitleDarkRatio >= 0.10
    && whitePanelTextRatio >= 0.025
  );
  const looksLikeBlueServiceCapabilityPoster = (
    width >= 500
    && height >= 600
    && topBandBlueRatio >= 0.25
    && (tealRatio >= 0.18 || blueTextRatio >= 0.18)
    && topTitleDarkRatio >= 0.18
    && lowerPanelTextRatio >= 0.12
    && whitePanelTextRatio >= 0.12
  );
  const looksLikeCertificateGridPoster = (
    width >= 500
    && height >= 500
    && whiteRatio >= 0.50
    && goldTextRatio >= 0.015
    && grayLineRatio >= 0.04
    && topTitleDarkRatio >= 0.08
    && lowerPanelTextRatio >= 0.035
  );
  const looksLikeBusinessModePoster = (
    width >= 500
    && height >= 600
    && whiteRatio >= 0.20
    && blackRatio >= 0.035
    && topTitleDarkRatio >= 0.12
    && lowerPanelTextRatio >= 0.12
    && whitePanelTextRatio >= 0.16
    && (redRatio >= 0.02 || blueTextRatio >= 0.06 || goldTextRatio >= 0.015)
  );
  const looksLikeFactoryOemPoster = (
    width >= 500
    && height >= 650
    && lightMachineryRatio >= 0.35
    && blueTextRatio >= 0.06
    && blackRatio >= 0.035
    && topTitleDarkRatio >= 0.06
    && lowerPanelTextRatio >= 0.16
    && whitePanelTextRatio >= 0.14
  );
  const looksLikeFactoryStatsWorkshopPanel = (
    width >= 600
    && height >= 250
    && blackRatio >= 0.28
    && grayLineRatio >= 0.08
    && lightMachineryRatio >= 0.35
    && topTitleDarkRatio >= 0.18
    && lowerPanelTextRatio >= 0.25
    && whitePanelTextRatio >= 0.25
    && quadrantDiversity >= 3
  );

  let reason = 'image_policy_passed';
  if (looksLikeYellowTextNotice) {
    reason = `yellow_text_notice yellow=${yellowRatio.toFixed(3)} black=${blackRatio.toFixed(3)} white=${whiteRatio.toFixed(3)}`;
  } else if (looksLikeShopRecommendationGrid) {
    reason = `shop_recommendation_grid white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} red=${redRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)}`;
  } else if (looksLikeFactoryWorkshopPanel) {
    reason = `factory_workshop_panel teal=${tealRatio.toFixed(3)} red=${redRatio.toFixed(3)} topRed=${topBandRedRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)}`;
  } else if (looksLikeRedLegalStatementPanel) {
    reason = `red_legal_statement_panel red=${redRatio.toFixed(3)} topRed=${topBandRedRatio.toFixed(3)} topWhite=${topBandWhiteRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeRedDisclaimerCardPanel) {
    reason = `red_disclaimer_card_panel red=${redRatio.toFixed(3)} topRed=${topBandRedRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeRedCouponBanner) {
    reason = `red_coupon_banner red=${redRatio.toFixed(3)} white=${whiteRatio.toFixed(3)} yellow=${yellowRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikePastelStatementPanel) {
    reason = `pastel_statement_panel white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} title=${topTitleDarkRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeLightTextNoticePanel) {
    reason = `light_text_notice_panel light=${lightMachineryRatio.toFixed(3)} black=${blackRatio.toFixed(3)} title=${topTitleDarkRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeWideTextNoticePanel) {
    reason = `wide_text_notice_panel white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} red=${redRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeRedTextReturnNoticePanel) {
    reason = `red_text_return_notice_panel white=${whiteRatio.toFixed(3)} red=${redRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeBlackLegalStatementPanel) {
    reason = `black_legal_statement_panel black=${blackRatio.toFixed(3)} white=${whiteRatio.toFixed(3)} yellow=${yellowRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeWhiteStoreStatementPanel) {
    reason = `white_store_statement_panel white=${whiteRatio.toFixed(3)} red=${redRatio.toFixed(3)} gold=${goldTextRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeGovernmentFilingScreenshot) {
    reason = `government_filing_screenshot topBlue=${topBandBlueRatio.toFixed(3)} white=${whiteRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)} black=${blackRatio.toFixed(3)}`;
  } else if (looksLikeBlueServiceCapabilityPoster) {
    reason = `blue_service_capability_poster topBlue=${topBandBlueRatio.toFixed(3)} teal=${tealRatio.toFixed(3)} blue=${blueTextRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeCertificateGridPoster) {
    reason = `certificate_grid_poster white=${whiteRatio.toFixed(3)} gold=${goldTextRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)} title=${topTitleDarkRatio.toFixed(3)}`;
  } else if (looksLikeBusinessModePoster) {
    reason = `business_mode_poster white=${whiteRatio.toFixed(3)} black=${blackRatio.toFixed(3)} red=${redRatio.toFixed(3)} text=${whitePanelTextRatio.toFixed(3)}`;
  } else if (looksLikeFactoryOemPoster) {
    reason = `factory_oem_poster light=${lightMachineryRatio.toFixed(3)} blue=${blueTextRatio.toFixed(3)} black=${blackRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  } else if (looksLikeFactoryStatsWorkshopPanel) {
    reason = `factory_stats_workshop_panel black=${blackRatio.toFixed(3)} gray=${grayLineRatio.toFixed(3)} light=${lightMachineryRatio.toFixed(3)} text=${lowerPanelTextRatio.toFixed(3)}`;
  }

  return {
    isIrrelevant: looksLikeYellowTextNotice
      || looksLikeShopRecommendationGrid
      || looksLikeFactoryWorkshopPanel
      || looksLikeRedLegalStatementPanel
      || looksLikeRedDisclaimerCardPanel
      || looksLikeRedCouponBanner
      || looksLikePastelStatementPanel
      || looksLikeLightTextNoticePanel
      || looksLikeWideTextNoticePanel
      || looksLikeRedTextReturnNoticePanel
      || looksLikeBlackLegalStatementPanel
      || looksLikeWhiteStoreStatementPanel
      || looksLikeGovernmentFilingScreenshot
      || looksLikeBlueServiceCapabilityPoster
      || looksLikeCertificateGridPoster
      || looksLikeBusinessModePoster
      || looksLikeFactoryOemPoster
      || looksLikeFactoryStatsWorkshopPanel,
    reason,
    yellowRatio,
    blackRatio,
    whiteRatio,
    redRatio,
    tealRatio,
    grayLineRatio,
    lightMachineryRatio,
    goldTextRatio,
    blueTextRatio,
    topBandBlueRatio,
    topBandRedRatio,
    topBandWhiteRatio,
    topTitleDarkRatio,
    lowerPanelTextRatio,
    whitePanelTextRatio,
    quadrantDiversity,
  };
}

function execFileAsync(command, args = [], options = {}, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function detectDisclaimerImageByContent(url = '', {
  enabled = ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK,
  sipsPath = '/usr/bin/sips',
  fsImpl = fs,
  osImpl = os,
  pathImpl = path,
  execFileImpl = execFile,
  downloadImageBufferImpl = downloadImageBuffer,
  timeoutMs = DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
  maxBytes = DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES,
} = {}) {
  if (!enabled || !fsImpl || typeof fsImpl.existsSync !== 'function' || !fsImpl.existsSync(sipsPath)) {
    return null;
  }

  const downloaded = await downloadImageBufferImpl(url, {
    timeoutMs,
    maxBytes,
  });
  if (!downloaded) {
    return null;
  }

  const tempDir = fsImpl.mkdtempSync(pathImpl.join(osImpl.tmpdir(), 'autojs-image-policy-'));
  const sourcePath = pathImpl.join(tempDir, 'source-image.jpg');
  const bmpPath = pathImpl.join(tempDir, 'source-image.bmp');

  try {
    fsImpl.writeFileSync(sourcePath, downloaded.buffer);
    await execFileAsync(sipsPath, ['-s', 'format', 'bmp', sourcePath, '--out', bmpPath], {
      timeout: timeoutMs,
    }, execFileImpl);
    const bmpBuffer = fsImpl.readFileSync(bmpPath);
    return analyzeBmpForDisclaimer(bmpBuffer);
  } catch (error) {
    return null;
  } finally {
    fsImpl.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildLocalImagePolicyVerdictMap(imageUrls = [], {
  maxCheckCount = DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT,
  detectContent = detectDisclaimerImageByContent,
} = {}) {
  const verdictMap = new Map();
  const allUniqueUrls = uniqueUrlList(imageUrls);
  const uniqueUrls = [];
  const normalizedMaxCheckCount = Math.max(1, parsePositiveInteger(maxCheckCount, DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT));
  const appendUrl = (url) => {
    const normalizedUrl = normalizeImageUrl(url);
    if (!normalizedUrl || uniqueUrls.includes(normalizedUrl)) {
      return;
    }
    if (uniqueUrls.length < normalizedMaxCheckCount) {
      uniqueUrls.push(normalizedUrl);
    }
  };
  const headLimit = Math.max(1, Math.ceil(normalizedMaxCheckCount * 0.6));
  for (let index = 0; index < allUniqueUrls.length && uniqueUrls.length < headLimit; index += 1) {
    appendUrl(allUniqueUrls[index]);
  }
  for (let index = allUniqueUrls.length - 1; index >= 0 && uniqueUrls.length < normalizedMaxCheckCount; index -= 1) {
    appendUrl(allUniqueUrls[index]);
  }

  for (const url of uniqueUrls) {
    const normalizedUrl = normalizeImageUrl(url);
    if (!normalizedUrl) {
      continue;
    }

    if (isLikelyIrrelevantImageUrl(normalizedUrl)) {
      verdictMap.set(normalizedUrl, {
        isRelevant: false,
        reason: 'irrelevant_url_pattern',
      });
      continue;
    }

    const contentVerdict = await detectContent(normalizedUrl);
    if (contentVerdict) {
      verdictMap.set(normalizedUrl, {
        isRelevant: !contentVerdict.isIrrelevant,
        reason: contentVerdict.reason,
        visualProfile: contentVerdict,
      });
    }
  }

  return verdictMap;
}

module.exports = {
  DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_LOCAL_IMAGE_POLICY_MAX_BYTES,
  DEFAULT_LOCAL_IMAGE_POLICY_MAX_CHECK_COUNT,
  ENABLE_LOCAL_DISCLAIMER_IMAGE_CHECK,
  analyzeBmpForDisclaimer,
  buildLocalImagePolicyVerdictMap,
  detectDisclaimerImageByContent,
  downloadImageBuffer,
};
