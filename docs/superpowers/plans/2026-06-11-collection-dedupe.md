# Collection Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip source products that were successfully collected within the last 7 days.

**Architecture:** Add a focused local dedupe store that records successful source item keys in `.collection-dedupe.json`. Collection flows ask the store to filter recent duplicates before calling Miaoshou, then mark items only after successful collection/claim.

**Tech Stack:** Node.js CommonJS, local JSON persistence, existing collection script tests.

---

### Task 1: Local Dedupe Store

**Files:**
- Create: `lib/collection_dedupe_store.js`
- Create: `tests/collection-dedupe-store.test.js`

- [ ] Write tests for Amazon ASIN, 1688 offer ID, and Shopee item ID keys.
- [ ] Write tests for 7-day duplicate filtering and pruning old records.
- [ ] Implement load/save/filter/mark helpers.
- [ ] Run `node tests/collection-dedupe-store.test.js`.

### Task 2: Collection Flow Integration

**Files:**
- Modify: `miaoshou_1688_collect.js`
- Modify: `tests/1688-collection-filter.test.js`

- [ ] Add source-code checks proving the collection script imports and uses the dedupe store.
- [ ] Filter Amazon candidates before batch submit.
- [ ] Filter 1688 and Shopee candidates before detail/API collection.
- [ ] Mark only successfully collected items.
- [ ] Run `node tests/1688-collection-filter.test.js`.

### Task 3: Runtime Hygiene

**Files:**
- Modify: `.gitignore`
- Verify: all tests

- [ ] Ignore `.collection-dedupe.json`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Restart the local web service.
