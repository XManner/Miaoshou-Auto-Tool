# Product Management Limit-Store Unpublish Design

## Goal

Add a `商品管理` module to the local Miaoshou workbench. It keeps the existing product editing workflow and adds a new automation for taking down zero-sales products from stores that hit TikTok/Miaoshou trial-period product-list limits.

The new automation is a standalone product-management function, not a follow-up only for local edit failures.

## Scope

The top navigation changes from:

```text
首页 | 商品采集 | 编辑商品 | 秒杀管理 | 账户配置
```

to:

```text
首页 | 商品采集 | 商品管理 | 秒杀管理 | 账户配置
```

Inside `商品管理`, provide two tabs:

- `编辑商品`: the existing edit/publish workflow, unchanged except for its new location.
- `商品上限店铺下架`: the new workflow.

Existing `商品采集`, `秒杀管理`, account configuration, queue behavior, history, retry, diagnostics, and theme behavior must stay unchanged.

## Trigger Rule

The automation scans Miaoshou ERP `发布记录 > 发布失败` records and identifies stores whose failed publish reason contains both:

- `商店试用期`
- `最多只能使用1000个产品列表`

Only stores from records matching both phrases are eligible for cleanup. Store names are deduplicated before product cleanup.

## User Flow

The `商品上限店铺下架` tab provides:

- A scan button to find stores from failed publish records.
- A preview list showing matched store names, matched failure count, and source pages scanned.
- A start button for the take-down task after the user reviews the matched stores.
- Run status, logs, and recent records using the same workbench pattern as other task pages.

The default flow should be:

1. Scan failed publish records.
2. Preview matched stores.
3. User confirms cleanup.
4. Process each matched store.
5. Report processed stores, down-shelved products, skipped stores, and failures.

## Store Product Cleanup Rule

For each matched store, the automation must:

1. Open Miaoshou ERP `店铺产品`.
2. Select the exact matched store in the `店铺` selector.
3. Open `更多筛选`.
4. Set `销量` minimum to `0`.
5. Set `销量` maximum to `0`.
6. Click `搜索`.
7. After the zero-sales result list loads, change page size to `100条/页`.
8. Navigate to the last page of the filtered results.
9. Select all products on that last page.
10. Execute `下架`.
11. Wait for the confirmation/progress dialog to complete.

The search must happen before changing the page size. This preserves the intended filtering order and prevents changing pagination on an unfiltered product list.

## Safety Rules

The workflow must never down-shelve products that have sales.

Before taking down products, it must confirm the visible page is filtered to:

- The exact target store.
- `销量` from `0` to `0`.
- Page size `100条/页`.
- The last page of the filtered list.

If the UI cannot confirm the store, sales filter, page size, or last-page state, the workflow must skip that store and log the reason rather than continuing.

Do not use bulk delete actions. The only destructive action in this feature is `下架`.

## Automation Architecture

Add a focused product-management automation module instead of mixing this behavior into the existing edit or flash scripts.

Recommended structure:

- `miaoshou_product_management.js`: CLI entrypoint for product-management tasks.
- `lib/product_limit_store_cleanup.js`: browser automation and parsing helpers for the limit-store cleanup.
- Small pure helpers for matching failure reasons and deduplicating store names.

The script emits `MIAOSHOU_PROGRESS` events in the same format used by existing tasks so the web server can show progress consistently.

## CLI Behavior

The first CLI task is:

```text
node miaoshou_product_management.js --task unpublish-limit-stores
```

Optional flags can include:

- `--max-pages`: cap publish-record pages scanned.
- `--dry-run`: scan and preview stores without down-shelving products.
- `--stores`: process explicit store names, mainly for recovery or debugging.

The default UI should use scan/preview before execution, not an immediate destructive run.

## Web Server Integration

Extend `web_server.js` so product-management runs are first-class run types:

- Accept product-management payloads through `/api/run` or a small dedicated endpoint if cleaner.
- Track the current run with task metadata such as `{ productManagement: true, action: 'unpublish-limit-stores' }`.
- Start `miaoshou_product_management.js` with equivalent CLI args.
- Serialize product-management progress and summaries for the frontend.
- Keep current edit/collect/flash run routing intact.

The summary shape should include:

```js
{
  mode: 'product-limit-store-unpublish',
  scannedFailureRecords: 0,
  matchedStoreCount: 0,
  processedStoreCount: 0,
  unpublishedCount: 0,
  skippedStores: [],
  failedItems: [],
  results: []
}
```

## Frontend Integration

Update `public/app.js`:

- Rename the product nav item from `编辑商品` to `商品管理`.
- Keep the existing page key if practical, but render inner tabs for `编辑商品` and `商品上限店铺下架`.
- Keep the existing edit form visually and behaviorally unchanged inside the `编辑商品` tab.
- Add a new task panel for limit-store cleanup with scan, preview, confirm, and run controls.
- Show copy that makes the destructive scope clear: only stores with the trial-period 1000-product-list failure and only zero-sales products on the final filtered page.
- Route run status, logs, and history so product-management runs appear under `商品管理`.

## Error Handling

Stop or skip safely when:

- Miaoshou login is required.
- Publish records cannot be loaded.
- The failure reason text cannot be read reliably.
- Store selector cannot find the exact store.
- `销量 0 到 0` filters cannot be confirmed.
- Search results fail to load.
- Page-size change to `100条/页` fails.
- Last page cannot be identified.
- The `下架` action opens a confirmation/progress dialog with failures.

Every skip should include the store name and reason in logs and final summary.

## Skill Update

Revise the previously created skill so it triggers for the standalone `商品管理 > 商品上限店铺下架` workflow. The skill should describe:

- Matching publish failures by trial-period 1000-product-list text.
- Deduplicating store names.
- Filtering store products by exact store and `销量 0 到 0`.
- Searching before changing page size.
- Changing to `100条/页`.
- Going to the last page.
- Down-shelving only the last page of zero-sales products.

Remove language that frames the skill only as a duplicate `Color` failure cleanup.

## Testing

Add focused tests before implementation:

- Failure-reason matcher requires both `商店试用期` and `最多只能使用1000个产品列表`.
- Store-name dedupe preserves unique exact store names.
- Web server normalization accepts the product-management cleanup payload and rejects invalid actions.
- Product-management run routing does not break collect, edit, or flash page matching.
- Frontend navigation shows `商品管理` and no longer shows top-level `编辑商品`.
- Frontend product-management tabs include `编辑商品` and `商品上限店铺下架`.
- Frontend payload sends the selected product-management action.

The implementation must pass:

```text
npm run check
npm test
```
