# Electron Cloud Account, Admin, and Billing Design

## Goal

Turn Miaoshou Auto Tool from a local-only workbench into a commercial desktop product.

The Electron app stays responsible for local browser automation, while a cloud service controls account login, subscription status, Token billing, feature permissions, model configuration, task records, and software updates.

The first version should support both Mac and Windows clients, cloud accounts, subscription access, and Token-based billing for AI-heavy product editing.

## Product Shape

The commercial product has three surfaces:

- `Electron 客户端`: the software customers install on their computer. It runs local automation, opens Chrome, shows task progress, and communicates with the cloud API.
- `用户中心`: the customer-facing web portal. It shows subscription status, Token balance, consumption records, software downloads, invoices or payment records, and device binding.
- `运营管理后台`: the internal admin portal for the product owner. It manages users, plans, Token grants, feature switches, model pricing, task diagnostics, announcements, and software version rules.

The current local web workbench can be reused inside Electron as the client UI, but sensitive commercial state must move to the cloud.

## Billing Model

Use a hybrid billing model:

- Subscription controls whether the software can be used.
- AI-heavy editing consumes business Tokens.
- Automation workflows that do not rely on large-model processing can be included in the subscription.

Recommended first-version rules:

| Feature | Billing |
| --- | --- |
| 秒杀管理 | Subscription included, no Token charge |
| 上限店铺商品下架 | Subscription included, no Token charge |
| 商品采集 | Subscription included at first, with future rate limits |
| 快速编辑商品 | 1 Token per successfully saved product |
| 精细编辑商品 | 3 Tokens per successfully saved product |
| Future image translation/redraw | Separate image-based Token charge |

Do not expose raw model tokens as the customer-facing billing unit. Customers should see business Tokens tied to clear actions, such as successfully editing one product.

Internally, the cloud service still records model usage and estimated cost for each task so pricing and margin can be reviewed later.

## Token Settlement

The client should not decide billing on its own.

The cloud API owns all Token balance changes:

1. Before a paid task starts, the client requests a billing quote.
2. The cloud checks subscription status, feature permission, and available Token balance.
3. The cloud reserves the estimated maximum Token amount.
4. The Electron app runs the task locally.
5. The client reports per-product success, skip, and failure results.
6. The cloud settles only successful paid units.
7. Unused reserved Tokens are released.

Failed, skipped, or blocked products should not be charged.

If the client disconnects during a reserved task, the reservation should expire automatically after a timeout and return unused Tokens.

## Cloud Modules

The first cloud version should include these modules:

- `Auth`: user registration, login, password reset, session refresh, and optional social login later.
- `Subscription`: active plan, expiration time, renewal status, and feature entitlement.
- `Token Ledger`: immutable Token grants, reservations, deductions, refunds, and manual adjustments.
- `Feature Flags`: enable or disable functions per plan, user, or rollout group.
- `Model Pricing`: provider, model name, input price, output price, image price, currency, and effective date.
- `Task Records`: task type, user, device, status, summary, error reason, Token cost, and selected logs.
- `Device Binding`: installed device list, activation limit, revoke action, and last seen time.
- `Version Update`: latest version, minimum allowed version, download URL, update notes, and forced-upgrade flag.
- `Announcements`: customer-facing messages in the client and user center.

## Admin Portal

The internal admin portal should start small and practical.

Required first-version pages:

- `用户管理`: search users, view status, disable account, view devices, view subscription and Token balance.
- `订阅管理`: edit plan, expiration time, renewal status, and manually grant trial access.
- `Token 管理`: grant Tokens, refund Tokens, inspect ledger records, and add adjustment notes.
- `功能权限`: enable or disable features by plan or individual user.
- `任务记录`: inspect task status, success count, failure count, error reason, and key logs.
- `模型配置`: configure model providers, model names, unit prices, and whether a model is active.
- `软件版本`: configure latest version, minimum version, download URL, and forced update.
- `公告设置`: publish maintenance notices and release notes.

Advanced features such as coupon codes, reseller accounts, team seats, invoice automation, and role-based admin permissions can wait until after the first paid version.

## User Center

The customer-facing user center should include:

- Account profile and password management.
- Current subscription plan and expiration time.
- Token balance.
- Token consumption records.
- Payment or recharge records.
- Activated devices and revoke device action.
- Software downloads for Mac and Windows.
- Basic help, update notes, and customer service entry.

The user center does not need complex dashboards in the first version. Its main job is to let customers understand whether they can use the software and how their Tokens were consumed.

## Electron Client Integration

On startup, the Electron client should:

1. Ask the user to log in.
2. Register or refresh the current device.
3. Pull subscription status and feature permissions.
4. Pull client configuration such as API endpoint, feature flags, and model behavior policy.
5. Check whether the current client version is allowed.

Before running a paid task, the client must request permission and a Token reservation from the cloud.

The client should keep local automation secrets, such as the user's Miaoshou account and local browser profile, on the user's computer. It should not upload Miaoshou password, browser cookies, local storage, or third-party session data to the cloud.

## Configuration Ownership

Commercial configuration should live in the cloud, not inside the Electron package.

Cloud-owned settings:

- Subscription plan definitions.
- Feature permissions.
- Token deduction rules.
- AI model provider choices.
- AI model unit prices.
- App version policy.
- Announcements.
- Admin manual grants or refunds.

Client-owned settings:

- Local browser profile.
- Local Miaoshou login state.
- User-entered Miaoshou account configuration unless the user explicitly opts into future cloud sync.
- Local task runtime files and temporary captcha screenshots.

## Security Rules

The cloud must never receive or store:

- Miaoshou passwords.
- Browser cookies.
- Browser local storage.
- Third-party platform session Tokens.
- Captcha images unless the user explicitly submits them for support diagnostics.

The client should authenticate to the cloud using a short-lived access token plus refresh token. Device identity should be revocable from the user center or admin portal.

Admin actions that change subscription, Tokens, feature permissions, or user status must be audit-logged.

## Data Model Draft

Core tables or collections:

- `users`: account profile and status.
- `devices`: user devices, activation state, platform, version, last seen time.
- `plans`: subscription plan definitions.
- `subscriptions`: user plan, start time, end time, status.
- `feature_entitlements`: plan-level and user-level feature permissions.
- `token_ledger`: grants, reservations, deductions, refunds, and adjustments.
- `token_reservations`: active reservations with expiration.
- `tasks`: task metadata and summary.
- `task_events`: selected progress, errors, and billing events.
- `model_price_rules`: model pricing by provider and effective date.
- `app_versions`: release metadata and minimum version policy.
- `announcements`: client and user-center notices.
- `admin_audit_logs`: admin actions and reasons.

## API Draft

First-version cloud APIs:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /devices/activate`
- `GET /me`
- `GET /me/subscription`
- `GET /me/tokens`
- `GET /me/token-ledger`
- `GET /client/config`
- `GET /client/version`
- `POST /billing/quote`
- `POST /billing/reserve`
- `POST /billing/settle`
- `POST /billing/release`
- `POST /tasks`
- `PATCH /tasks/:id`
- `POST /tasks/:id/events`

Admin APIs should be separated under `/admin/*` and require an admin role.

## Deployment Approach

Recommended first-version stack:

- API service: Node.js with a clear REST API.
- Database: PostgreSQL.
- Cache or queue: optional at first; Redis can be added when reservations, task events, or async billing grow.
- File storage: object storage for Electron installers and release assets.
- Admin/user web apps: can be one web project with separate routes and permissions.

The current local Node scripts can remain mostly unchanged at first. The Electron wrapper and cloud API should be introduced around them instead of rewriting the automation logic immediately.

## Rollout Plan

Build in this order:

1. Cloud account login and device activation.
2. Subscription state and feature permission checks.
3. Token ledger and reservation/settlement flow.
4. Electron login and cloud authorization.
5. Product-editing billing integration.
6. User center for subscription, Tokens, and downloads.
7. Internal admin portal.
8. Version update and announcements.
9. Payment provider integration.

Payment can be added after manual subscription and Token grants work reliably. This lowers first-version risk.

## Testing

Add tests for:

- Subscription expiry blocks paid and subscription-only features.
- Feature flags enable or disable each workflow correctly.
- Token reservation succeeds only with enough balance.
- Successful edited products settle Tokens.
- Failed or skipped products release reserved Tokens.
- Reservation timeout returns unused Tokens.
- Admin Token grants and refunds write immutable ledger records.
- Device limit blocks extra activations and allows revoked devices to be replaced.
- Old client versions are blocked when minimum version is raised.

## Open Decisions

These decisions can be finalized before implementation planning:

- Payment provider for the first paid version.
- Whether user center and admin portal share one frontend project.
- Whether Miaoshou account settings remain local-only in version one.
- Exact subscription plan names and prices.
- Exact included monthly Token allowance per plan.
