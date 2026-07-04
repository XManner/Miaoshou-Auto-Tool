---
name: miaoshou-1688-collection
description: Use when the user asks Codex to source, select, or collect beauty and personal-care products from 1688 using the Miaoshou ERP or 跨境ERP Chrome extension for TikTok Shop Malaysia, Philippines, or Thailand, including keyword search, product risk filtering, selection scoring, clicking the floating 采集此商品 control, and verifying collection into the Miaoshou collection box.
---

# Miaoshou 1688 Collection

## Scope

Automate product discovery and collection from a live logged-in Chrome session on 1688, using the Miaoshou ERP / 跨境ERP browser extension to collect qualified products into the Miaoshou collection box.

Use this for selection plus collection, not for merely clicking a visible collection button. The workflow must decide whether a product is worth collecting before using the plugin.

## Core Rules

- Use Google Chrome when operating 1688 because the Miaoshou collection extension lives there. Do not substitute the in-app browser unless the extension is confirmed available there.
- Do not inspect cookies, passwords, tokens, local storage, or extension internals. If login or extension authorization is needed, ask the user for the minimum browser-side help.
- Do not bypass CAPTCHAs, account verification, anti-bot checks, or platform rate limits.
- Default target markets are TikTok Shop Malaysia, Philippines, and Thailand unless the user says otherwise.
- Default category is beauty and personal care. Prefer low-regulation tools and accessories, not cosmetics with active ingredients or strong claims.
- If the user does not give a quantity, review up to 20 search-result candidates and collect up to 5 high-confidence products in one run.
- Record every collected product URL, title, 1688 price, score, and collection result. Record skipped products only by reason group unless the user asks for a full audit trail.

## Collection Modes

### Safe Mode

Use Safe Mode by default. Collect only products that are mostly tools, accessories, containers, organizers, or disposable personal-care supplies:

- Makeup tools: 化妆刷, 美妆蛋, 粉扑, 睫毛夹, 修眉刀, 眉夹, 化妆镜.
- Storage and travel: 化妆包, 化妆品收纳盒, 旅行收纳, 分装瓶, 洗漱包.
- Nail accessories: 穿戴甲, 美甲贴纸, 指甲锉, 美甲工具套装, 甲片收纳.
- Personal-care tools: 洗脸巾, 头皮按摩梳, 气垫梳, 浴球, 浴帽, 搓澡巾.

### Qualification Mode

Use Qualification Mode only when the user explicitly asks to source regulated cosmetics or confirms they have local documents. Require a visible or user-provided qualification path before collecting:

- Malaysia: cosmetic notification or supplier documentation suitable for NPRA compliance.
- Philippines: FDA cosmetic product notification or equivalent import/seller documentation.
- Thailand: Thai FDA/cosmetic notification or equivalent documentation.
- Any target market: product label, ingredients, claims, manufacturer/importer information, and authorization documents where needed.

If documents are not visible or provided, mark the product `requires qualification` and do not collect automatically.

## Hard Rejects

Reject without collecting when any of these appear in title, image, detail text, or shop material:

- Brand infringement: big-brand names, copied packaging, celebrity/IP images, logo imitation, "同款" for known brands, or obvious counterfeit cues.
- Medical or strong functional claims: 祛痘, 美白, 淡斑, 防脱, 生发, 丰胸, 瘦身, 修复疤痕, 治疗, 抗菌除螨 as the main selling point.
- High-regulation forms in Safe Mode: serum, cream, lotion, mask liquid, sunscreen, deodorant, perfume, lash glue, nail gel, oral care, supplements, eye drops, contact-lens liquid.
- Risky users or use cases: baby/children, pregnancy, intimate care, invasive tools, needles, blades beyond common eyebrow razors, electrical heating devices without clear safety proof.
- Logistics risk: liquid leakage, fragile glass, batteries, magnet-heavy products, aerosol, powder leakage, or SKU sets too complex to edit reliably.
- Weak supplier signal: no clear product images, no wholesale price, no buyer protection/return support, shop looks abandoned, or detail page is mostly AI/stock filler.

When policy status matters or the user asks for regulated cosmetics, verify current official TikTok Shop and local regulator rules before approving collection. These policies change.

## Scoring

Score each candidate out of 100 after passing the hard-reject screen. Collect only products scoring at least 75 unless the user explicitly lowers the threshold.

- Demand fit, 20: suitable for humid Southeast Asian daily use, gift/bundle potential, frequent repurchase or impulse-buy behavior.
- TikTok content fit, 20: easy visual demonstration, before/after or problem/solution angle, compact enough for short-video hooks.
- Margin and logistics, 20: low unit cost, low weight, small size, low breakage, simple SKU choices, plausible 2.5x+ retail markup after fees and shipping.
- Supplier quality, 20: good store rating, repeat-buyer signal, stable stock, clear specifications, real product images/video, return or after-sale support.
- Differentiation, 20: not pure commodity unless bundled, has a clear design, color, portability, set composition, or scenario advantage.

## Keyword Strategy

Use user-provided keywords first. If the user asks for open-ended sourcing, start with low-risk seed pools and rotate keywords to avoid collecting near-duplicates:

- Tools: `化妆刷套装`, `美妆蛋粉扑`, `睫毛夹`, `修眉刀`, `眉夹套装`.
- Storage: `化妆包`, `化妆品收纳盒`, `旅行洗漱包`, `桌面化妆品收纳`.
- Hair and bath: `头皮按摩梳`, `气垫梳`, `浴球`, `浴帽`, `洗脸巾`.
- Nails: `穿戴甲`, `美甲贴纸`, `美甲工具套装`, `指甲锉`.

For each keyword, prefer the first one or two result pages. Change keyword rather than going deep into low-quality pages.

## 1688 Search Workflow

1. Open Chrome and go to `https://www.1688.com`.
2. Confirm the Miaoshou ERP / 跨境ERP floating control or extension state is available after the page loads.
3. Search the keyword. If a 1688 product page is already open and the user wants to start there, evaluate that product, then continue with related/search results only if batch collection is requested.
4. On search results, quickly skip products with hard-reject cues from the title, thumbnail, or price.
5. Open promising candidates in new tabs. Keep a small queue, usually no more than 5 tabs at once.
6. On each detail page, read title, main image, price tiers, MOQ, shipping hints, shop name, shop rating, repeat-buyer or transaction signals, specifications, and visible after-sale/support terms.
7. Apply the scoring model. Collect only approved candidates.

## Plugin Collection Workflow

1. On an approved 1688 detail page, find the floating Miaoshou control, often near the lower-right page area and labeled `跨境ERP`, `采集此商品`, or similar.
2. If the control is collapsed, expand it. If it is hidden, scroll slightly, wait, then reload once.
3. Click `采集此商品` only after the product passes selection.
4. Wait for the plugin result. Treat success as a visible success toast, success dialog, changed button state, or confirmation that the product entered the collection box.
5. If the plugin asks for target platform, store, or collection destination, keep existing/default selections when they are clearly correct for Miaoshou collection. If target store or marketplace is ambiguous, stop and ask.
6. If the plugin reports duplicate collection, record it as duplicate and skip to the next candidate.
7. If the plugin fails, retry the same product once after reload. If it still fails, record failure reason and continue with other candidates.

## Batch Control

- Process one keyword at a time.
- Stop when the target collection count is reached.
- Stop early if 10 consecutive reviewed candidates fail hard-reject or score below threshold; switch to a new keyword if available.
- Avoid collecting multiple listings that are clearly the same product from different weak suppliers. Prefer the supplier with better price, images, support, and store signal.
- Do not collect more than the user requested. If the user asks for "a few", collect 3. If the user asks for "一批", collect 10 unless they specify another count.

## Handoff To Miaoshou Editing

At the end, report:

- Target markets and keywords used.
- Number of candidates reviewed, collected, duplicates, plugin failures, and rejected-risk products.
- For each collected item: title, 1688 URL, price, score, and the main reason it was selected.
- Any products that require qualification and were intentionally not collected.

If the user wants to continue into editing, use the existing Miaoshou editing/publishing workflow. Do not assume collection success means the item is publish-ready.

## Browser Cleanup

After finishing Chrome work, close only temporary 1688 candidate tabs that were opened for this run. Keep the collection result page or the last relevant 1688 page available for handoff when useful.
