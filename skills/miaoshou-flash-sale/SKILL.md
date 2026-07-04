---
name: miaoshou-flash-sale
description: Operate the Miaoshou ERP TikTok "限时秒杀" workflow in Chrome or the in-app browser. Use when the user asks Codex to process ongoing flash-sale activities, click "管理产品" instead of "编辑", add searchable products, compare popup/list product counts, filter products without flash-sale prices, apply the discount from the activity title, submit, and retry failed products until the failure count is zero.
---

# Miaoshou Flash Sale

## Scope

Automate the Miaoshou ERP TikTok "限时秒杀" activity-product workflow from a live logged-in browser session.

Use Chrome automation when the user mentions `@chrome` or is already working in Google Chrome. Otherwise use the current available browser tool. Do not inspect cookies, tokens, passwords, or local storage. If the user is not logged in, ask only for the minimum login help needed.

## Core Rules

- Process one activity at a time, even when the user asks for multiple activities.
- Use `管理产品` to edit activity products. Never use `编辑` for this workflow.
- Use the `进行中` tab unless the user says otherwise.
- For "继续按倒序", "倒数第 N 个", or "继续处理几个活动", preserve the queue by activity ID before processing. Counts and ordering can change after submission.
- Before each activity, record activity title, activity ID, site, shop, current list product count, existing add-failure count, and parsed discount.
- When the user or local web UI specifies a Miaoshou account, verify the currently logged-in Miaoshou browser account matches the selected phone number before changing flash-sale products. If it does not match, switch/login to the matching account first using the corresponding local `.env` credential, without exposing the password in chat or logs.
- Extract the discount from the first clear number followed by `%` in the activity title, such as `620 泰国 75%` -> `75`.
- If the activity title has no clear discount or has ambiguous discounts, stop and ask.
- Do not click destructive actions such as `终止`, `批量终止`, or delete/remove actions unless the user explicitly requests them.

## List Setup And Queueing

1. Open `https://erp.91miaoshou.com/tiktok/marketing/flashSale`.
2. Click `进行中`.
3. Set the list page size to `100条/页` when available.
4. Read the target rows in the visible/order context the user requested.
5. If the user is continuing a previous reverse-order batch, identify the next rows before the last completed activity ID.
6. If virtual scrolling hides rows, scroll and read row text from `.pro-virtual-table__row` / `.pro-virtual-scroll__row` rather than relying only on `<tr>`.
7. Prefer opening an activity by searching its activity ID, then clicking that row's `管理产品`. This avoids clicking the wrong row after counts change.

## Open Activity

1. Search the exact activity ID on the list page.
2. Click that row's `管理产品`.
3. Verify the detail page contains `管理活动产品` and the expected activity title.
4. If a new tab opens, operate in that detail tab. Return to the list after completion.

## Add Products Decision

1. Click `添加产品`.
2. Read the popup product count from the popup pagination, for example `217条`.
3. Compare the popup count with the outer activity-list product count:
   - If popup count is less than or equal to the outer list product count, the activity has no new products to add. Close/cancel the popup and return to the activity list.
   - If popup count is greater than the outer list product count, continue.
4. Click `一键全选搜索结果产品`.
5. Click popup footer `确定`.
6. If the popup remains open but products are selected, wait briefly and click `确定` again.

## Price Only Unpriced Products

Follow this exact order after adding products:

1. Change the activity product list page size to `1000条/页`.
2. Then check `仅展示未设置秒杀价产品`.
3. If changing page size clears the checkbox, check it again.
4. If the filtered list shows `暂无数据` or `0条`, there is nothing to price. Return to the list and report that state.
5. Click the table header checkbox at the left of `产品信息` to select all filtered products.
6. Verify the page shows `已选 N /N条` or equivalent.

The actual checkbox input is often hidden; click the visible label/box area by coordinates if a DOM checkbox action fails.

## Apply Discount

1. Click `批量秒杀价格`.
2. In `批量设置秒杀价`, select `统一折扣`.
3. Enter only the discount number from the activity title, without `%`.
4. Click `应用至选中`.
5. Verify the dialog closes and rows show generated prices. Rounding can display ranges such as `65~66%OFF`; accept that when the input was correct.

If text typing fails because the browser clipboard bridge is unavailable, type numeric values with keypresses one character at a time.

## Submit And Confirm

1. Click the bottom `提交` button.
2. Wait for the `提示` progress/result dialog.
3. A completed submission must show `未完成：0`.
4. If `失败：0`, click `确认` and verify the page returns to the flash-sale list.
5. Report the activity title, filtered count, discount, submit rounds, and final failure count.

## Failure Retry

If the result dialog shows failures:

1. Click `失败列表`.
2. In the failure popup, change page size to `500条/页`.
3. Select all failures using the header checkbox.
4. Click `继续编辑`.
5. Click the bottom `提交` button again.
6. Repeat whole-set retries until the result shows `失败：0`.

Do not continue to the next activity while the current activity has a nonzero final failure count.

## Stuck Progress Recovery

Sometimes TikTok rate limiting causes the progress dialog to freeze, for example `1%` with many `未完成` items and no buttons.

When progress is stuck for several minutes:

1. Reload the detail tab.
2. Reopen `添加产品`.
3. Add all searchable products again.
4. Set `1000条/页`.
5. Check `仅展示未设置秒杀价产品`.
6. Select all remaining unpriced products.
7. Apply the same discount and submit again.
8. Continue normal failure retry until `失败：0`.

This works because successfully submitted products keep their prices; the unpriced filter exposes only the remaining items.

## Browser Cleanup

At the end of Chrome browser work, finalize browser tabs and keep only the list/detail tab needed for handoff. Treat finalization as the last browser action.
