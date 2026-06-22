const {
  dedupeImageUrls,
  extractImageUrlsFromNotes,
} = require('./source_item_links');
const { cleanSkuPropertyList } = require('./sku_spec_text');

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

const DEFAULT_DESCRIPTION_IMAGE_COUNT = parsePositiveInteger(process.env.MAX_DESCRIPTION_IMAGE_COUNT, 20);
const HARD_MAX_DESCRIPTION_IMAGE_COUNT = 10;
const DEFAULT_MAIN_IMAGE_COUNT = parsePositiveInteger(process.env.MAX_MAIN_IMAGE_COUNT, 9);
const DEFAULT_MIN_MAIN_IMAGE_COUNT = parsePositiveInteger(process.env.MIN_MAIN_IMAGE_COUNT, 3);
const DEFAULT_MIN_DETAIL_IMAGE_COUNT = parsePositiveInteger(process.env.MIN_DETAIL_IMAGE_COUNT, 5);

function normalizeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return raw.split('#')[0].split('?')[0].trim();
  }
}

function getImageUrlExtension(url = '') {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  } catch (error) {
    const pathname = raw.split('#')[0].split('?')[0].trim();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }
}

function isMiaoshouSupportedMainImageUrl(url = '') {
  return /^(jpe?g|png)$/i.test(getImageUrlExtension(url));
}

function isLikelyNoisyDetailImageUrl(url = '') {
  const raw = String(url || '');
  return [
    /[?&]__r__=/i,
    /watermark/i,
    /trace/i,
    /x-oss-process/i,
  ].some((pattern) => pattern.test(raw));
}

function shouldForceMainImagesByImageSet(noteImageUrls = [], mainImageUrls = []) {
  const normalizedNotes = dedupeImageUrls(noteImageUrls);
  const normalizedMain = dedupeImageUrls(mainImageUrls);

  if (normalizedMain.length === 0) {
    return false;
  }

  if (normalizedNotes.length === 0) {
    return true;
  }

  if (normalizedNotes.length > Math.max(normalizedMain.length * 2, normalizedMain.length + 6)) {
    return true;
  }

  const noisyCount = noteImageUrls.filter((url) => isLikelyNoisyDetailImageUrl(url)).length;
  const noisyRatio = noteImageUrls.length > 0 ? noisyCount / noteImageUrls.length : 0;

  return noisyRatio >= 0.5;
}

function buildImageOnlyNotesHtml(imageUrls = []) {
  const maxDetailImageCount = Math.min(DEFAULT_DESCRIPTION_IMAGE_COUNT, HARD_MAX_DESCRIPTION_IMAGE_COUNT);
  return dedupeImageUrls(imageUrls)
    .slice(0, maxDetailImageCount)
    .map((url) => `<p><img src="${url}"></p>`)
    .join('\n');
}

function isLikelyIrrelevantImageUrl(url = '') {
  const raw = String(url || '');
  return [
    /O1CN015dbW3f1CHhDi0fQr1/i,
    /O1CN01llVOCf1Bs2tNqzflL/i,
    /O1CN01qJOsBO2E1KWfs7uU8/i,
    /O1CN01K7ftFR2E1KWf2xSK0/i,
    /O1CN01VdF0Vr2E1KWgQzmWY/i,
    /factory|workshop|manufacturer/i,
    /gongchang|chejian|workshopshow|factoryshow|shengchanxian/i,
    /company|aboutus|contact/i,
    /wechat|whatsapp|line[-_]?id/i,
    /banner|poster|promotion|advert/i,
    /coupon|voucher|follow[-_ ]?gift|follow[-_ ]?shop|gift[-_ ]?coupon/i,
    /guanzhu[-_ ]?youli|youhuiquan|lingquan|guanzhu[-_ ]?dianpu|fan[-_ ]?coupon/i,
    /recommend|recommended|hot[-_ ]?items|related[-_ ]?products|shop[-_ ]?recommend/i,
    /dianpu|tuijian|redian|rexiao|guanlian/i,
    /\u5e97\u94fa|\u63a8\u8350|\u70ed\u5356|\u7206\u6b3e|\u5173\u8054\u5546\u54c1|\u642d\u914d\u63a8\u8350/,
    /\u5173\u6ce8\u6709\u793c|\u5173\u6ce8\u5e97\u94fa|\u4f18\u60e0\u5238|\u9886\u5238|\u9996\u5355|\u5143\u4f18\u60e0/,
    /disclaimer|statement|notice|announcement|terms/i,
    /price[-_ ]?notice|about[-_ ]?price|warm[-_ ]?tips|purchase[-_ ]?tips|invoice[-_ ]?notice/i,
    /mianshengming|shengming|goumaixuzhi|wenxintishi|guanyujiage|jiage[-_ ]?shuoming|huaxianjiage|weihuaxianjiage|guanggaofa|guanggao[-_ ]?law|ad[-_ ]?law|legal[-_ ]?statement/i,
    /\u5173\u4e8e\u4ef7\u683c|\u4ef7\u683c\u8bf4\u660e|\u5212\u7ebf\u4ef7\u683c|\u672a\u5212\u7ebf\u4ef7\u683c|\u6e29\u99a8\u63d0\u793a|\u8d2d\u4e70\u9009\u9879|\u5f00\u7968|\u5ba2\u670d|\u9000\u8d27|\u4e0d\u9000\u6362\u8d27|\u5927\u8d27|\u6837\u54c1|\u7ea0\u7eb7|\u614e\u62cd|\u8de8\u5883\u5e73\u53f0|\u5e7f\u544a\u6cd5|\u65b0\u5e7f\u544a\u6cd5|\u58f0\u660e|\u7edd\u5bf9\u5316\u7528\u8bcd|\u529f\u80fd\u6027\u7528\u8bed/,
    /beian|filing|nmpa|export[-_ ]?notice|shop[-_ ]?statement|store[-_ ]?statement/i,
    /\u5e97\u94fa\u58f0\u660e|\u6cd5\u5f8b\u58f0\u660e|\u514d\u8d23\u58f0\u660e|\u91c7\u8d2d\u4e13\u7528|\u6279\u53d1\u91c7\u8d2d|\u81ea\u52a8\u9000\u6b3e|\u4e0d\u542b\u4e2d\u6587|\u56fd\u5185\u9500\u552e|\u5907\u6848|\u56fd\u4ea7\u666e\u901a\u5316\u5986\u54c1|\u836f\u54c1\u76d1\u7763|\u5546\u4e13\u4f9b\u51fa\u53e3|\u4ec5\u4f9b\u8de8\u5883/,
    /oem|odm|cfda|patent|certificate|certificates|import[-_ ]?certificate|procurement|dropship|drop[-_ ]?shipping/i,
    /zhuanli|zhengshu|jinkou|jinkouzhengshu|caigou|daifa|daili|lingfengxian|shiti[-_ ]?fahuo|pinpai[-_ ]?jiagong/i,
    /\u4e13\u5229|\u8bc1\u4e66|\u8fdb\u53e3\u8bc1\u4e66|\u5907\u6848\u901f\u5ea6|\u8bbe\u8ba1\u901f\u5ea6|\u51fa\u8d27\u901f\u5ea6|\u4e00\u7ad9\u5f0f\u91c7\u8d2d|\u4ee3\u53d1|\u7f51\u7edc\u4ee3\u9500|\u54c1\u724c\u4ee3\u52a0\u5de5|\u6210\u719f\u76840\u98ce\u9669\u5546\u4e1a\u6a21\u5f0f|\u8d85\u7ea7\u5de5\u5382|\u5de5\u5382\u5b9e\u529b|\u5382\u623f\u9762\u79ef|\u516c\u53f8\u5458\u5de5|\u751f\u4ea7\u7ebf|\u6708\u4ea7\u91cf|\u751f\u4ea7\u7ecf\u9a8c|\u4ea7\u54c1\u6b3e\u5f0f|\u7814\u53d1\u8f66\u95f4|\u751f\u4ea7\u8f66\u95f4|\u52a0\u5de5\u8f66\u95f4/,
    /factory[-_ ]?(building|exterior|campus|tour|photo)|workshop[-_ ]?(photo|interior|scene)|production[-_ ]?(workshop|room|base)|source[-_ ]?factory|cross[-_ ]?border[-_ ]?factory/i,
    /pinpai[-_ ]?shouquan|brand[-_ ]?authorization|authorized[-_ ]?brand|platform[-_ ]?authorization|quanbu[-_ ]?shouquan|qixia[-_ ]?pinpai|kuajing[-_ ]?yuantou[-_ ]?changjia|waimao[-_ ]?kuajing/i,
    /jingdong|taobao|tmall|pinduoduo|douyin|kuaishou|amazon|aliexpress|lazada|shopee|ebay|wish/i,
    /\u5382\u623f\u5916\u89c2|\u5de5\u5382\u5916\u89c2|\u5382\u533a|\u5382\u623f\u5b9e\u62cd|\u8f66\u95f4\u5b9e\u62cd|\u751f\u4ea7\u8f66\u95f4\u5b9e\u62cd|\u751f\u4ea7\u57fa\u5730|\u751f\u4ea7\u73af\u5883/,
    /\u65d7\u4e0b\u54c1\u724c|\u54c1\u724c\u6388\u6743|\u5747\u53ef\u6388\u6743|\u53ef\u6388\u6743|\u5e73\u53f0\u6388\u6743|\u5916\u8d38\u8de8\u5883|\u54c1\u6e90\u5934\u5382\u5bb6|\u6e90\u5934\u5382\u5bb6|\u5168\u82f1\u6587\u7248|\u5c0f\u6279\u91cf|\u8d34\u724c|\u4ee3\u52a0\u5de5|\u5b9a\u5236/,
    /\u4eac\u4e1c|\u6dd8\u5b9d|\u5929\u732b|\u62fc\u591a\u591a|\u6296\u97f3|\u5feb\u624b|\u4e9a\u9a6c\u900a|\u901f\u5356\u901a|\u56fd\u9645\u963f\u91cc/,
    /porn|nsfw|erotic|explicit[-_ ]?nudity|adult[-_ ]?content|sex[-_ ]?toy|sexy[-_ ]?lingerie|lingerie[-_ ]?sexy|naked[-_ ]?girl|xxx/i,
    /qingqu|chengren|xingyongpin|seqing|luodian|luoluo|luozhao|feijibei|tiaodan|zhendongbang|ziwei|biyeyuntao/i,
    /\u8272\u60c5|\u6210\u4eba\u7528\u54c1|\u60c5\u8da3\u7528\u54c1|\u60c5\u8da3|\u6027\u7528\u54c1|\u88f8\u9732|\u88f8\u7167|\u9732\u70b9|\u6027\u7231|\u6027\u6697\u793a|\u98de\u673a\u676f|\u8df3\u86cb|\u9707\u52a8\u68d2|\u81ea\u6170|\u907f\u5b55\u5957|\u4f4e\u4fd7/,
    /certificate|certification/i,
    /hot[-_ ]?sale|best[-_ ]?seller/i,
    /logo/i,
  ].some((pattern) => pattern.test(raw));
}

function decideImageRelevant(url = '', verdictMap = new Map()) {
  const normalizedUrl = normalizeImageUrl(url);
  const verdict = normalizedUrl ? verdictMap.get(normalizedUrl) : null;

  if (verdict && typeof verdict.isRelevant === 'boolean') {
    return verdict.isRelevant;
  }

  if (isLikelyNoisyDetailImageUrl(url) || isLikelyIrrelevantImageUrl(url)) {
    return false;
  }

  return true;
}

function strictShouldUseMainImagesForNotes(notes = '') {
  return [
    /跨境热卖/,
    /海外商机/,
    /已售[:：]/,
    /工厂|厂家|宣传|联系/i,
    /关注有礼|关注店铺|优惠券|领券|首单|领券立减|粉丝/,
    /广告法|新广告法|绝对化用词|功能性用语|不作为赔付理由|赔付理由|页面声明/,
    /关于价格|价格说明|划线价格|未划线价格|活动预热|温馨提示|开票|购买选项|联系客服|客服咨询|订购|退货|不退换货|大货|样品|纠纷|慎拍|跨境平台|免责说明|采购专用|批发采购|自动退款|不含中文|国内销售/,
    /特此声明|店铺声明|法律声明|商专供出口|仅供跨境|国产普通化妆品备案|国家药品监督|NMPA/i,
    /OEM|ODM|CFDA|专利|证书|进口证书|一站式采购|代发|网络代销|品牌代加工|零风险商业模式|超级工厂|工厂实力|备案速度|设计速度|出货速度/i,
    /厂房面积|公司员工|生产线|月产量|生产经验|产品款式|研发车间|生产车间|加工车间/,
    /厂房外观|工厂外观|厂区|厂房实拍|车间实拍|生产车间实拍|生产基地|生产环境|仓库实拍/,
    /旗下品牌|品牌授权|均可授权|可授权|平台授权|外贸跨境|品源头厂家|源头厂家|全英文版|小批量|贴牌|代加工|定制/,
    /京东|淘宝|天猫|拼多多|抖音|快手|亚马逊|速卖通|Lazada|Shopee|eBay|Wish|国际阿里/i,
    /色情|成人用品|情趣用品|性用品|裸露|裸照|露点|性爱|性暗示|飞机杯|跳蛋|震动棒|自慰|避孕套|低俗/,
    /porn|nsfw|erotic|explicit\s+nudity|adult\s+content|sex\s+toy|sexy\s+lingerie/i,
    /\u5de5\u5382\u8f66\u95f4\u5c55\u793a/,
    /factory\s*workshop|production\s*line|manufacturing\s*process/i,
    /facemask/i,
    /LAIKOUFENYIQUIYUM/i,
  ].some((pattern) => pattern.test(String(notes || '')));
}

function buildStrictCleanImagePlan(itemInfo = {}, verdictMap = new Map()) {
  const maxDetailImageCount = Math.min(DEFAULT_DESCRIPTION_IMAGE_COUNT, HARD_MAX_DESCRIPTION_IMAGE_COUNT);
  const notes = String(itemInfo.notes || '');
  const originalNoteImageUrls = dedupeImageUrls(extractImageUrlsFromNotes(notes));
  const originalMainImageUrls = dedupeImageUrls(Array.isArray(itemInfo.imgUrls) ? itemInfo.imgUrls : []);
  const supportedOriginalMainImageUrls = originalMainImageUrls
    .filter((url) => isMiaoshouSupportedMainImageUrl(url));
  const supportedOriginalNoteImageUrls = originalNoteImageUrls
    .filter((url) => isMiaoshouSupportedMainImageUrl(url));
  const filteredMainImageUrls = supportedOriginalMainImageUrls
    .filter((url) => decideImageRelevant(url, verdictMap));
  const filteredNoteImageUrls = originalNoteImageUrls
    .filter((url) => decideImageRelevant(url, verdictMap));
  const supportedFilteredNoteImageUrls = filteredNoteImageUrls
    .filter((url) => isMiaoshouSupportedMainImageUrl(url));
  const relevantMainPool = dedupeImageUrls([...filteredMainImageUrls, ...supportedFilteredNoteImageUrls]);

  let mainImageUrls = filteredMainImageUrls.length > 0
    ? filteredMainImageUrls
    : (relevantMainPool.length > 0 ? relevantMainPool : supportedOriginalMainImageUrls);
  if (mainImageUrls.length === 0) {
    mainImageUrls = supportedOriginalNoteImageUrls;
  }

  const supplementMainPool = dedupeImageUrls([
    ...supportedOriginalMainImageUrls,
    ...supportedFilteredNoteImageUrls,
    ...supportedOriginalNoteImageUrls,
  ]);
  for (const url of supplementMainPool) {
    if (mainImageUrls.length >= DEFAULT_MIN_MAIN_IMAGE_COUNT) {
      break;
    }
    if (!mainImageUrls.includes(url) && decideImageRelevant(url, verdictMap)) {
      mainImageUrls.push(url);
    }
  }
  mainImageUrls = dedupeImageUrls(mainImageUrls)
    .filter((url) => isMiaoshouSupportedMainImageUrl(url))
    .slice(0, DEFAULT_MAIN_IMAGE_COUNT);
  if (mainImageUrls.length === 0) {
    throw new Error('没有可用的 JPG/JPEG/PNG 主图，已停止保存该商品。');
  }

  let detailImageUrls = strictShouldUseMainImagesForNotes(notes)
    || shouldForceMainImagesByImageSet(originalNoteImageUrls, mainImageUrls)
    ? [...mainImageUrls]
    : filteredNoteImageUrls;

  if (detailImageUrls.length === 0) {
    detailImageUrls = filteredMainImageUrls.length > 0
      ? [...filteredMainImageUrls]
      : [...mainImageUrls];
  }

  const supplementDetailPool = dedupeImageUrls([
    ...filteredNoteImageUrls,
    ...mainImageUrls,
  ]);
  for (const url of supplementDetailPool) {
    if (detailImageUrls.length >= DEFAULT_MIN_DETAIL_IMAGE_COUNT) {
      break;
    }
    if (!detailImageUrls.includes(url) && decideImageRelevant(url, verdictMap)) {
      detailImageUrls.push(url);
    }
  }

  detailImageUrls = dedupeImageUrls(detailImageUrls)
    .slice(0, maxDetailImageCount);

  return {
    mainImageUrls,
    detailImageUrls,
    removedMainImageCount: Math.max(0, originalMainImageUrls.length - mainImageUrls.length),
    removedDetailImageCount: Math.max(0, originalNoteImageUrls.length - detailImageUrls.length),
  };
}

function getImagePolicyVerdict(url = '', verdictMap = new Map()) {
  const normalizedUrl = normalizeImageUrl(url);
  return normalizedUrl && verdictMap instanceof Map ? verdictMap.get(normalizedUrl) : null;
}

function getImageWhiteRatio(url = '', verdictMap = new Map()) {
  const verdict = getImagePolicyVerdict(url, verdictMap);
  const visualProfile = verdict && verdict.visualProfile ? verdict.visualProfile : verdict;
  return parsePositiveNumber(visualProfile && visualProfile.whiteRatio, 0) || 0;
}

function buildSkuImageReplacementPool({
  itemInfo = {},
  imagePlan = {},
  verdictMap = new Map(),
} = {}) {
  const mainImageUrls = dedupeImageUrls([
    ...(Array.isArray(imagePlan.mainImageUrls) ? imagePlan.mainImageUrls : []),
    ...(Array.isArray(itemInfo.imgUrls) ? itemInfo.imgUrls : []),
    ...(Array.isArray(itemInfo.mainImageUrls) ? itemInfo.mainImageUrls : []),
  ]);
  const detailImageUrls = dedupeImageUrls([
    ...(Array.isArray(imagePlan.detailImageUrls) ? imagePlan.detailImageUrls : []),
    ...(Array.isArray(itemInfo.detailImageUrls) ? itemInfo.detailImageUrls : []),
    ...(Array.isArray(itemInfo.productImages) ? itemInfo.productImages : []),
    ...extractImageUrlsFromNotes(itemInfo.notes),
  ]);
  const candidates = dedupeImageUrls([
    ...mainImageUrls,
    ...detailImageUrls,
  ])
    .filter((url) => isMiaoshouSupportedMainImageUrl(url))
    .filter((url) => decideImageRelevant(url, verdictMap));

  return candidates
    .map((url, index) => {
      const mainIndex = mainImageUrls.indexOf(url);
      const detailIndex = detailImageUrls.indexOf(url);
      const whiteRatio = getImageWhiteRatio(url, verdictMap);
      const sourceScore = mainIndex >= 0
        ? 300 - mainIndex
        : (detailIndex >= 0 ? 120 - detailIndex : 0);
      const whiteScore = whiteRatio >= 0.68
        ? 1000
        : (whiteRatio >= 0.5 ? 700 : (whiteRatio >= 0.35 ? 400 : whiteRatio * 100));

      return {
        url,
        score: sourceScore + whiteScore,
        index,
      };
    })
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((item) => item.url);
}

function resolveSafeSkuImageUrl(
  url = '',
  {
    verdictMap = new Map(),
    replacementPool = [],
    preferredReplacements = [],
  } = {},
) {
  const normalizedUrl = normalizeImageUrl(url);
  if (!normalizedUrl) {
    return '';
  }

  if (isMiaoshouSupportedMainImageUrl(normalizedUrl) && decideImageRelevant(normalizedUrl, verdictMap)) {
    return normalizedUrl;
  }

  return dedupeImageUrls([
    ...(Array.isArray(preferredReplacements) ? preferredReplacements : []),
    ...(Array.isArray(replacementPool) ? replacementPool : []),
  ]).find((candidateUrl) => (
    candidateUrl !== normalizedUrl
    && isMiaoshouSupportedMainImageUrl(candidateUrl)
    && decideImageRelevant(candidateUrl, verdictMap)
  )) || '';
}

function applySkuImagePolicyToPropertyList(
  skuPropertyList = [],
  {
    itemInfo = {},
    imagePlan = {},
    verdictMap = new Map(),
  } = {},
) {
  const replacementPool = buildSkuImageReplacementPool({ itemInfo, imagePlan, verdictMap });
  const fallbackReplacement = replacementPool[0] || '';

  return cleanSkuPropertyList(skuPropertyList).map((property) => ({
    ...property,
    attrValueList: (Array.isArray(property && property.attrValueList) ? property.attrValueList : []).map((value) => {
      const nextValue = { ...value };
      const normalizedImgUrl = normalizeImageUrl(value && value.imgUrl);
      const originalUrls = dedupeImageUrls(value && value.supplementarySkuImageUrls);
      const keptUrls = originalUrls
        .filter((url) => isMiaoshouSupportedMainImageUrl(url))
        .filter((url) => decideImageRelevant(url, verdictMap));
      const safeImgUrl = resolveSafeSkuImageUrl(normalizedImgUrl, {
        verdictMap,
        replacementPool,
        preferredReplacements: keptUrls,
      });

      if (normalizedImgUrl) {
        if (safeImgUrl) {
          nextValue.imgUrl = safeImgUrl;
        } else {
          delete nextValue.imgUrl;
        }
      }

      if (originalUrls.length === 0) {
        return {
          ...nextValue,
          supplementarySkuImageUrls: [],
        };
      }

      if (keptUrls.length === originalUrls.length) {
        return {
          ...nextValue,
          supplementarySkuImageUrls: keptUrls,
        };
      }

      const replacementUrl = replacementPool.find((url) => !keptUrls.includes(url))
        || fallbackReplacement;
      const nextUrls = keptUrls.length > 0
        ? keptUrls
        : (replacementUrl ? [replacementUrl] : []);

      return {
        ...nextValue,
        supplementarySkuImageUrls: nextUrls,
      };
    }),
  }));
}

function buildStrictCleanNotesHtml(itemInfo = {}, imagePlan = null) {
  const selectedImageUrls = imagePlan && Array.isArray(imagePlan.detailImageUrls)
    ? imagePlan.detailImageUrls
    : buildStrictCleanImagePlan(itemInfo).detailImageUrls;
  return buildImageOnlyNotesHtml(selectedImageUrls);
}

module.exports = {
  DEFAULT_DESCRIPTION_IMAGE_COUNT,
  DEFAULT_MAIN_IMAGE_COUNT,
  DEFAULT_MIN_DETAIL_IMAGE_COUNT,
  DEFAULT_MIN_MAIN_IMAGE_COUNT,
  HARD_MAX_DESCRIPTION_IMAGE_COUNT,
  applySkuImagePolicyToPropertyList,
  buildImageOnlyNotesHtml,
  buildSkuImageReplacementPool,
  buildStrictCleanImagePlan,
  buildStrictCleanNotesHtml,
  decideImageRelevant,
  getImagePolicyVerdict,
  getImageUrlExtension,
  getImageWhiteRatio,
  isLikelyIrrelevantImageUrl,
  isLikelyNoisyDetailImageUrl,
  isMiaoshouSupportedMainImageUrl,
  normalizeImageUrl,
  shouldForceMainImagesByImageSet,
  strictShouldUseMainImagesForNotes,
};
