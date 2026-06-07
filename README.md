# TikTok Shop 妙手自动化工作台

这是一个围绕 TikTok Shop 东南亚店铺的本地自动化工具，用来把 1688 / Shopee 选品、妙手采集箱、商品编辑发布和秒杀活动处理串成一套可执行流程。

项目提供网页工作台，也保留命令行脚本。日常使用建议直接启动网页工作台。

## 核心功能

- 首页：查看整套流程能做什么，并快速进入各功能页。
- 商品采集：从 1688 或 Shopee 选品，筛选后通过妙手 Open API 采集到公共采集箱，并认领到 TikTok 采集箱。
- 编辑商品：批量优化妙手采集箱商品标题、SKU、重量、主图、详情图和站点同步，可选择是否发布。
- 秒杀管理：处理进行中的秒杀活动，自动进入活动、添加商品并设置折扣。
- 账户配置：集中配置妙手账号、App ID、App Secret、DeepSeek、Kimi、MiMo 等密钥。

## 项目结构

```text
.
├── web_server.js              # 本地网页工作台服务
├── miaoshou_auto.js           # 商品编辑、优化、发布主流程
├── miaoshou_flash_sale.js     # 秒杀活动处理流程
├── miaoshou_1688_collect.js   # 1688 / Shopee 商品采集流程
├── public/                    # 网页界面
├── tests/                     # 回归测试
├── .env.example               # 配置模板
└── package.json               # 依赖和启动命令
```

本地运行时会生成 `.env`、`.captcha/`、`.miaoshou-browser/`、日志等文件，这些不会上传到 GitHub。

## 环境要求

- Node.js 18 或更高版本。
- Git。
- Google Chrome。
- 妙手 Open API 账号和对应 App ID / App Secret。
- 至少一个 AI 服务 Key，常用组合是 DeepSeek 文本模型 + MiMo 图片模型。

如果要使用 1688 / Shopee 网页自动采集，需要本机 Chrome 可以正常访问对应网站；这些网站可能触发登录、验证码或风控验证。

## 下载代码

```bash
git clone https://github.com/XManner/Miaoshou-Auto-Tool.git
cd Miaoshou-Auto-Tool
npm install
```

复制配置模板：

```bash
cp .env.example .env
```

然后打开 `.env` 填写真实账号和 Key。不要把 `.env` 上传到 GitHub。

## 启动网页工作台

```bash
npm run web
```

启动后会自动用 Google Chrome 打开：

```text
http://127.0.0.1:3000
```

如果不想自动打开浏览器：

```bash
WEB_OPEN_BROWSER=0 npm run web
```

如果要让局域网里的另一台电脑访问，把 `.env` 改成：

```bash
WEB_HOST=0.0.0.0
WEB_PORT=3000
```

本机仍然打开 `http://127.0.0.1:3000`；其它电脑打开启动日志里显示的局域网地址，例如 `http://192.168.x.x:3000`。

## 账户配置

网页的“账户配置”页可以配置整套流程需要的账号和 Key：

- 妙手 ERP 接口地址。
- 多个妙手账号、登录密码、App ID、App Secret。
- 默认使用的妙手账号。
- 默认 AI 服务。
- DeepSeek API Key、Base URL、模型。
- Kimi API Key、模型。
- MiMo API Key、Base URL、文本模型和图片模型。

“使用本地 .env”默认开启时，页面会读取本机 `.env` 并回填已有配置。密码、Secret 和 API Key 使用密码框显示；留空保存不会覆盖原值。

保存配置后会更新本机 `.env`，下一次商品采集、编辑商品和秒杀管理都会使用保存后的配置。

## 商品采集

商品采集支持三类常用流程。

### 1688 自动采集

输入关键词后，系统会打开 1688 首页搜索商品，读取候选商品信息，并按价格、评分、优先词、排除词和安全模式做过滤。合格商品会通过妙手 Open API 采集到公共采集箱，再认领到 TikTok 采集箱。

适合批量找一类货源，例如防晒帽、防晒袖、面罩等。

### 1688 链接采集

直接粘贴 1688 商品详情链接，每行一个。系统会按链接逐个处理，适合你已经人工挑好商品，只想批量送到妙手采集箱。

### Shopee 自动采集

系统先在 Shopee 指定站点搜索关键词，找到商品后下载主图，再拿主图到 1688 以图搜款。如果 1688 找到同款或近似货源，并且符合价格、起批量等要求，就通过妙手 Open API 采集 Shopee 商品链接。

这个流程更容易受到 Shopee 登录、流量验证和 1688 图片搜索风控影响。遇到验证时，需要先在自动化 Chrome 窗口里完成登录或验证。

## 编辑商品

编辑商品页用于处理妙手 TikTok 采集箱里的商品。

主要能力：

- 优化英文标题。
- 清理敏感词和不适合跨境上架的词。
- SKU 规格英文化。
- 处理重复 SKU 名称。
- 修正来源价和重量。
- 按设置给 SKU 重量额外加克重。
- 审核主图和详情图，移除免责声明、工厂展示、店铺推荐、多商品推荐等不合适图片。
- 支持快速模式和精细模式。
- 支持只保存不发布，也支持编辑后发布。
- 支持编辑完成后继续执行秒杀活动。

快速模式主要依赖本地规则，速度更快。精细模式会调用 MiMo 图片模型，识别更细，但耗时和 token 消耗更高。

## 秒杀管理

秒杀管理页用于处理进行中的限时秒杀活动。

可以选择：

- 处理指定数量的秒杀活动。
- 处理全部秒杀活动。

流程会进入活动管理页，按活动标题匹配商品，自动添加可用商品并设置折扣。执行时可能遇到妙手登录验证码，网页会显示验证码截图和输入框，输入后流程会继续。

## 命令行用法

日常建议用网页工作台。需要排查问题时，可以直接运行脚本。

检查语法：

```bash
npm run check
```

编辑 1 个商品但不发布：

```bash
node miaoshou_auto.js --count 1 --publish false
```

编辑全部商品但不发布，最多扫描 500 个：

```bash
node miaoshou_auto.js --count 0 --item-selection-mode all --publish false
```

编辑并发布 1 个商品：

```bash
node miaoshou_auto.js --count 1 --publish true
```

处理 3 个秒杀活动：

```bash
node miaoshou_flash_sale.js --count 3
```

处理全部秒杀活动：

```bash
node miaoshou_flash_sale.js --all
```

1688 链接采集：

```bash
node miaoshou_1688_collect.js --links "https://detail.1688.com/offer/123456.html" --count 1
```

1688 自动采集：

```bash
node miaoshou_1688_collect.js --source 1688 --keywords "防晒帽,防晒冰袖" --count 10 --max-price 10 --min-score 75
```

Shopee 自动采集：

```bash
node miaoshou_1688_collect.js --source shopee --shopee-site my --keywords "sun protection hat" --count 5 --shopee-max-price 25 --shopee-max-moq 3
```

## 常见问题

### 打开 `0.0.0.0:3000` 是 502

`0.0.0.0` 是服务监听地址，不是浏览器访问地址。本机请打开：

```text
http://127.0.0.1:3000
```

### 提示没有 Git

Mac 可以执行：

```bash
xcode-select --install
```

Windows 可以从 Git 官网安装：

```text
https://git-scm.com/download/win
```

### 3000 端口被占用

可以改 `.env`：

```bash
WEB_PORT=3001
```

然后重新执行：

```bash
npm run web
```

### 1688 或 Shopee 采集失败

常见原因是网页触发登录、验证码、流量验证或反爬限制。优先尝试链接采集，或先在自动化 Chrome 窗口里完成登录和验证。

如果妙手 Open API 返回 502，程序会停止本次采集，避免继续高频请求。

### 为什么 `.env` 没有上传到 GitHub

`.env` 里有账号、密码、App Secret 和 API Key，必须只保存在本机。项目会上传 `.env.example` 作为模板，但不会上传真实 `.env`。

## GitHub 上传前检查

提交前建议执行：

```bash
npm run check
git status --short --ignored
```

确认 `.env`、`.captcha/`、`.miaoshou-browser/`、`node_modules/` 和日志文件都处于 ignored 状态后，再提交代码。

## 重要提醒

这个项目是本地自动化工具，依赖妙手、1688、Shopee、TikTok Shop 和 AI 服务的页面或接口状态。第三方页面、风控策略、接口返回格式发生变化时，采集或自动化流程可能需要同步调整。
