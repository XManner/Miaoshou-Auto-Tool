# Amazon Browser Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Amazon.com browser-automation collection source and collect normalized Amazon product links through the existing Miaoshou common collect-box API.

**Architecture:** Add focused Amazon URL and browser-candidate modules, then route `collectSource: amazon` through `miaoshou_1688_collect.js`. The web server and UI expose Amazon options while preserving the existing 1688/Shopee paths.

**Tech Stack:** Node.js CommonJS, Puppeteer, existing Miaoshou Open API helpers, existing Vue/Ant Design frontend, Node test files under `tests/`.

---

### Task 1: Amazon URL Helpers

**Files:**
- Create: `lib/amazon_url.js`
- Test: `tests/amazon-url-module.test.js`

- [x] Write a failing test for extracting ASINs from raw ASINs and Amazon.com URL shapes.
- [x] Implement `extractAmazonAsin`, `normalizeAmazonProductUrl`, `normalizeAmazonProductInputs`, and `isLikelyAmazonProductUrl`.
- [x] Run `node tests/amazon-url-module.test.js`.

### Task 2: Amazon Candidate Parsing and Filtering

**Files:**
- Create: `lib/amazon_browser_collect.js`
- Test: `tests/amazon-browser-collect-module.test.js`

- [x] Write a failing test for parsing Amazon search-card HTML text into normalized candidates.
- [x] Write a failing test for filtering by price, rating, review count, excluded terms, and duplicate ASIN.
- [x] Implement browser-independent helpers first: `buildAmazonSearchUrl`, `parseAmazonPrice`, `parseAmazonRating`, `parseAmazonReviewCount`, `filterAmazonCandidates`, and `detectAmazonAccessBlock`.
- [x] Add Puppeteer-facing helpers for keyword extraction that use those pure helpers.
- [x] Run `node tests/amazon-browser-collect-module.test.js`.

### Task 3: Collection Script Routing

**Files:**
- Modify: `miaoshou_1688_collect.js`
- Test: `tests/1688-collection-filter.test.js`

- [x] Write failing tests proving `--source amazon` is accepted and Amazon flags are parsed.
- [x] Add `COLLECT_SOURCE_AMAZON`, Amazon option normalization, CLI parsing, and `runAmazonCollection`.
- [x] Route link/ASIN mode directly to `collectSourceLinksWithMiaoshouApi`.
- [x] Route keyword mode through `lib/amazon_browser_collect.js`, then collect normalized links.
- [x] Run `node tests/1688-collection-filter.test.js`.

### Task 4: Web Server Integration

**Files:**
- Modify: `web_server.js`
- Test: `tests/1688-collection-server.test.js`

- [x] Write failing tests proving server source normalization accepts `amazon` and passes Amazon CLI flags.
- [x] Extend collection option validation and command construction.
- [x] Include Amazon details in logs and serialized run metadata.
- [x] Run `node tests/1688-collection-server.test.js`.

### Task 5: Frontend Integration

**Files:**
- Modify: `public/app.js`
- Test: `tests/1688-collection-ui.test.js`

- [x] Write failing tests for Amazon source UI, payload fields, and Amazon task summary.
- [x] Add source selector and Amazon-specific form fields.
- [x] Keep 1688 link/keyword behavior unchanged.
- [x] Run `node tests/1688-collection-ui.test.js`.

### Task 6: Full Verification

**Files:**
- All changed files

- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Confirm the working tree diff only contains Amazon collection implementation and related docs/tests.
