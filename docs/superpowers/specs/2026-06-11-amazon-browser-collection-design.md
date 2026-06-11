# Amazon Browser Collection Design

## Goal

Add an Amazon.com browser-automation collection source to the existing Miaoshou local tool. The first version collects Amazon product links through the already-verified Miaoshou common collect-box API path, then claims the generated common collect-box details into the TikTok collect box.

The user has verified that Miaoshou supports Amazon product links through the current collection API, so this feature does not need to recreate product data manually.

## Scope

The first version targets only `amazon.com` in the US marketplace.

It supports two collection modes:

- Link/ASIN mode: users paste Amazon product links or ASINs.
- Keyword mode: users enter Amazon search keywords and the browser extracts candidate product links from search results.

The feature is added as a third collection source beside the existing `1688` and `Shopee` sources. Existing 1688, Shopee, edit, publish, and flash-sale behavior must stay unchanged.

## Out of Scope

The first version does not include:

- Amazon marketplace switching beyond `amazon.com`.
- Amazon SP-API, Product Advertising API, Creators API, or Amazon Ads API integration.
- CAPTCHA bypassing, anti-bot circumvention, proxy rotation, or stealth scraping.
- Full Amazon catalog crawling or broad pagination harvesting.
- Deep product-detail reconstruction for manual import if Miaoshou collection fails.
- Variation-level collection beyond the product URL Amazon and Miaoshou resolve from the normalized ASIN link.

## User Inputs

The collection page adds an Amazon source option.

For Amazon link/ASIN mode:

- Amazon product links or ASINs, one per line or separated by whitespace.
- Collection count, capped by the number of normalized unique ASIN links.

For Amazon keyword mode:

- Keywords.
- Collection count, defaulting to a small conservative value such as `5`.
- Maximum product display price in USD.
- Minimum rating.
- Minimum review count.
- Excluded terms.
- Candidate scan limit, to avoid excessive browsing.

## Data Model

Amazon candidates are normalized to:

```js
{
  source: 'amazon',
  marketplace: 'US',
  asin: 'B0...',
  url: 'https://www.amazon.com/dp/B0...',
  title: '...',
  priceUsd: 12.99,
  rating: 4.5,
  reviewCount: 1234,
  imageUrl: 'https://...',
  keyword: '...',
  reason: '...'
}
```

Only `url` is required for Miaoshou collection. Other fields support filtering, logging, and user-facing collection history.

## URL and ASIN Handling

Create `lib/amazon_url.js` with small, testable helpers:

- Detect Amazon.com product URLs.
- Extract ASINs from common URL forms such as `/dp/{ASIN}`, `/gp/product/{ASIN}`, and `/exec/obidos/ASIN/{ASIN}`.
- Accept raw ASIN input when it matches Amazon ASIN shape.
- Normalize every product to `https://www.amazon.com/dp/{ASIN}`.
- Deduplicate candidates by ASIN.

Invalid links are skipped with clear reasons in the final summary.

## Browser Automation

Create `lib/amazon_browser_collect.js`.

Keyword mode launches the existing local Chrome pattern used by the current collection script. It opens Amazon search result pages on `amazon.com`, waits for result cards, and extracts visible product candidates.

The extractor should:

- Prefer organic result cards with ASIN-like `data-asin` values.
- Avoid obvious sponsored result blocks when detectable.
- Extract title, product URL, price, rating, review count, and main image.
- Normalize each candidate through `lib/amazon_url.js`.
- Stop after enough filtered candidates or after the configured candidate scan limit.

The browser automation must use conservative pacing:

- Wait for body text and result cards.
- Scroll in small steps.
- Add short waits between page actions.
- Stop and report when Amazon shows CAPTCHA, robot checks, blocked access, or login-only states.

It must not attempt to bypass verification. If Amazon asks for manual verification, the run should stop with an actionable error and save diagnostic artifacts using the existing artifact helpers where practical.

## Filtering

Link/ASIN mode only validates and deduplicates links, then submits them to Miaoshou.

Keyword mode filters extracted candidates:

- Reject missing ASIN or missing normalized URL.
- Reject titles containing excluded terms.
- Reject prices above the configured maximum when a price is parsed.
- Reject ratings below the configured minimum when a rating is parsed.
- Reject review counts below the configured minimum when a count is parsed.
- Deduplicate by ASIN.

Candidates without parseable optional fields are allowed only when the corresponding filter is disabled or set to a permissive value. This keeps the first version from throwing away good candidates simply because Amazon changes text formatting.

## Miaoshou Integration

Reuse the existing `collectSourceLinksWithMiaoshouApi()` flow:

```text
Amazon normalized links
→ /open/v1/product/common_collect_box/common_collect_box/fetch_item
→ common collect-box IDs
→ /open/v1/product/common_collect_box/common_collect_box/claimed
→ TikTok collect box
```

The collection script returns the same summary shape used by current collection runs:

- `collected`
- `skipped`
- `failed`
- `duplicates`
- `reviewedCount`
- `source: 'amazon'`

For each successful item, include ASIN, normalized Amazon URL, parsed title, parsed price, rating, review count, common collect-box ID, and platform collect-box mapping when available.

## CLI Integration

Extend `miaoshou_1688_collect.js` to accept:

- `--source amazon`
- `--amazon-mode links|keyword`
- `--amazon-marketplace us`
- `--amazon-max-price-usd`
- `--amazon-min-rating`
- `--amazon-min-review-count`

Existing generic flags remain usable:

- `--keywords`
- `--links`
- `--count`
- `--excluded-terms`
- `--max-candidates`
- `--headless`

The script should route `source === 'amazon'` to the Amazon browser collection path. Existing 1688 and Shopee branches remain unchanged.

## Web Server Integration

Extend `web_server.js` collection normalization and command construction:

- Accept `collectSource: 'amazon'`.
- Accept Amazon-specific options.
- Pass equivalent CLI args to `miaoshou_1688_collect.js`.
- Include Amazon source details in run metadata, resume metadata, and logs.

The web server must continue to reject invalid counts and malformed numeric filters before starting the child process.

## Frontend Integration

Update `public/app.js` collection UI:

- Add a collection source selector with `1688`, `Shopee`, and `Amazon`.
- Show Amazon-specific fields only when Amazon is selected.
- Keep the current 1688 link and keyword modes unchanged.
- Provide Amazon link/ASIN input and keyword input.
- Show a task summary such as `使用 账号A，Amazon.com 关键词采集 5 个商品。`

The UI should not promise that Amazon can be fully crawled. Copy should describe it as small-batch candidate collection.

## Error Handling

Amazon browser errors:

- CAPTCHA/robot check: stop with `Amazon 要求人工验证，请在自动化 Chrome 中完成验证后重试。`
- No result cards: record keyword as skipped and continue with the next keyword.
- Link/ASIN parsing failure: record each bad input as skipped.

Miaoshou errors:

- Reuse current service retry behavior for 502/503/504.
- If fetch succeeds but claim fails, report generated common collect-box IDs.
- If Miaoshou rejects an Amazon link, record the item as failed with the raw API message.

The run should not silently continue after an Amazon access-block page because doing so would collect empty or wrong data.

## Testing

Add focused tests before implementation:

- Amazon URL helper extracts ASINs and normalizes supported links.
- Invalid Amazon links and malformed ASINs are rejected.
- Collection option normalization accepts `amazon` and preserves existing `1688` and `Shopee` behavior.
- CLI parsing supports Amazon-specific flags.
- Amazon candidate filtering rejects excluded terms and honors price/rating/review filters.
- Web server command construction passes Amazon flags.
- Frontend payload sends Amazon source and fields.

The implementation must pass:

```text
npm run check
npm test
```

## Acceptance Criteria

The first version is complete when:

- A user can paste Amazon.com product links or ASINs and collect them through Miaoshou.
- A user can enter Amazon.com keywords and collect a small filtered batch.
- Amazon candidates are deduplicated by ASIN.
- The run stops clearly on Amazon CAPTCHA or robot checks.
- Existing 1688 and Shopee collection tests still pass.
- All new Amazon behavior has focused tests.
