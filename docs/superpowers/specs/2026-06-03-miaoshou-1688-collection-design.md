# Miaoshou 1688 Collection Design

## Goal

Build a Puppeteer-based 1688 product collection task that sources sunscreen-related low-risk beauty/personal-care products for TikTok Shop Malaysia, Philippines, and Thailand, collects qualified items through the Miaoshou ERP Chrome extension, and exposes the task from the local web console.

## Scope

Add a new `商品采集` workflow beside the existing edit and flash-sale workflows. The first version targets safe sunscreen-adjacent products under a configurable maximum purchase price. It must not collect regulated sunscreen cosmetics by default.

The navigation order is:

```text
首页 | 商品采集 | 编辑商品 | 秒杀管理
```

The old `商品管理` label becomes `编辑商品`; its existing editing behavior stays unchanged.

## User Inputs

The `商品采集` page provides:

- Keywords, defaulting to `防晒帽, 防晒冰袖, 防晒面罩, 防晒口罩, 遮阳伞`.
- Collection count, defaulting to `10`.
- Maximum purchase price in CNY, defaulting to `10`.
- Preferred terms, defaulting to safe sunscreen accessories such as `防晒帽, 冰袖, 面罩, 遮阳伞`.
- Excluded terms, defaulting to high-risk or unsuitable terms such as `防晒霜, 防晒喷雾, 防晒乳, 美白, 祛斑, 儿童, 大牌同款`.
- Minimum score, defaulting to `75`.
- Safe mode, enabled by default.

## Selection Rules

The task combines user-defined page rules with built-in safety rules.

Safe mode always rejects sunscreen cosmetics and high-risk claims even if the user removes them from the custom excluded terms. It rejects products involving sunscreen cream, spray, lotion, whitening, spot removal, medical claims, counterfeit cues, children/pregnancy positioning, aerosols, liquids, and obvious brand imitation.

Safe mode prefers accessories and tools: sunscreen hats, ice sleeves, face covers, masks, umbrellas, shawls, and travel/storage accessories.

Products must be at or below the maximum purchase price when a visible 1688 price can be parsed. Products without parseable price are skipped in the first version.

## Scoring

After hard rejects, candidates are scored out of 100:

- Demand fit, 20.
- TikTok content fit, 20.
- Margin and logistics, 20.
- Supplier quality, 20.
- Differentiation, 20.

The first version uses deterministic text and listing signals. It does not call an AI model for scoring.

## Automation Architecture

Create `miaoshou_1688_collect.js`.

The script uses `puppeteer-core`, launches Chrome through the same executable/profile pattern used by the existing Miaoshou scripts, opens 1688 search pages, evaluates candidate cards, opens qualified details, then clicks the Miaoshou ERP / 跨境ERP floating `采集此商品` control.

The script emits progress events with `MIAOSHOU_PROGRESS` using the existing `MIAOSHOU_PROGRESS` stderr format. It writes one final JSON summary to stdout, matching the existing web server parsing pattern.

## Web Server Integration

Extend `web_server.js` so `/api/run` accepts:

```json
{
  "tasks": { "collect": true },
  "collectKeywords": "防晒帽,防晒冰袖",
  "collectCount": 10,
  "collectMaxPriceCny": 10,
  "collectPreferredTerms": "防晒帽,冰袖,面罩,遮阳伞",
  "collectExcludedTerms": "防晒霜,防晒喷雾,防晒乳,美白,祛斑,儿童,大牌同款",
  "collectMinScore": 75,
  "collectSafeMode": true
}
```

The server starts `node miaoshou_1688_collect.js` with equivalent CLI arguments, tracks it as a normal run, and shows progress/logs on the `商品采集` page only.

## Frontend Integration

Extend `public/app.js` with:

- New page key `collect`.
- Navigation order `home`, `collect`, `products`, `flash`.
- Page title `商品采集`.
- Existing product page title changed to `编辑商品`.
- Collection form and task summary.
- Start button that posts collection payload to `/api/run`.
- Run matching logic so collection logs and status only show on `商品采集`.

## Error Handling

If 1688 login, extension login, CAPTCHA, anti-bot checks, or plugin authorization blocks the task, the script stops with a clear error message. It does not attempt to bypass verification.

If the Miaoshou floating control cannot be found on a candidate detail page, that candidate is recorded as a plugin failure and the task continues until the target count or candidate limit is reached.

Duplicates are recorded separately from failures when the plugin result indicates a duplicate collection.

## Testing

Add focused tests for:

- The filter rejecting high-risk sunscreen cosmetics and accepting safe accessories.
- CLI argument parsing and defaults.
- Web server collection option validation.
- Web server command construction for collection runs.
- Frontend navigation labels/order and default collection form values.

The implementation must pass `npm run check` plus the new tests.
