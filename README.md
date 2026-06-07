# Miaoshou Auto

妙手 TikTok 采集箱商品自动优化脚本，用于批量处理商品标题、SKU、重量、详情图、站点同步和可选发布。

## 功能

- 使用 DeepSeek 或 Kimi 优化商品英文标题。
- 清理标题和详情文本中的敏感词。
- SKU 规格英文化，并处理重复 SKU 名称，例如 `#1 Yellow`、`#2 Yellow`。
- 商品重量默认在原重量基础上增加 30g，已优化商品重复执行时不会反复累加。
- 清理详情和主图中的免责声明、工厂展示、店铺推荐、多商品推荐等无关图片。
- 默认支持 PH -> MY/TH 的站点同步。
- 支持 `--publish false` 只保存不发布，也支持确认后发布。

## 环境要求

- Node.js 18 或更高版本。
- 一个可用的妙手开放平台 `APP_ID` / `APP_SECRET`。
- DeepSeek 或 Kimi API Key。

## 安装

```bash
npm install
```

## 配置

复制示例配置：

```bash
cp .env.example .env
```

然后在 `.env` 里填写真实密钥：

```bash
MIAOSHOU_ACTIVE_ACCOUNT_INDEX=1
MIAOSHOU_ACCOUNT_1=你的妙手账号
MIAOSHOU_PASSWORD_1=你的妙手密码
MIAOSHOU_APP_ID_1=你的妙手AppId
MIAOSHOU_APP_SECRET_1=你的妙手AppSecret
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
```

不要把 `.env` 上传到 GitHub，项目里的 `.gitignore` 已经默认忽略它。

## 常用命令

检查语法：

```bash
npm run check
```

启动网页控制台：

```bash
npm run web
```

打开：

```text
http://127.0.0.1:3000
```

网页里可以直接填写妙手 `App ID` / `App Secret`，保存后会写入本机 `.env`。`App Secret` 不会在页面上回显明文。执行任务时，网页会显示实时进度、成功数、失败数、发布数和总用时。

如果 `.env` 里按手机号注释分组保存了多组妙手账号，网页会自动识别这些账号，并在“执行参数”里提供账号切换。启动任务时只会把选中的那组 `App ID` / `App Secret` 注入给本次编辑发布任务，不会在页面展示 Secret 明文。

如果要让局域网里的另一台电脑访问网页，把 `.env` 里的网页监听地址设为：

```bash
WEB_HOST=0.0.0.0
WEB_PORT=3000
```

重启 `npm run web` 后，在另一台电脑浏览器里打开启动日志里显示的局域网地址，例如：

```text
http://192.168.3.106:3000
```

查看采集箱前 10 个商品：

```bash
node miaoshou_auto.js --page-size 10
```

编辑优化 1 个商品，但不发布：

```bash
node miaoshou_auto.js --count 1 --publish false
```

编辑优化 10 个商品，但不发布：

```bash
node miaoshou_auto.js --count 10 --publish false
```

按指定商品 ID 单独编辑，不发布：

```bash
node miaoshou_auto.js edit-publish --detail-ids 1234567890 --apply --publish false
```

确认无误后编辑并发布 1 个商品：

```bash
node miaoshou_auto.js --count 1 --publish true
```

## 注意事项

- `--publish true` 会执行发布动作，批量发布前建议先用 `--publish false` 检查结果。
- DeepSeek 当前只用于文本优化，不做视觉审核；快速模式图片清理主要依赖本地规则。
- MiMo 主模型默认使用 `mimo-v2.5-pro`；图片审核和异常重量看图识别默认使用支持图片输入的 `mimo-v2.5`，运行日志会显示耗时和 token 消耗。
- MiMo、Kimi 和 DeepSeek 配置是分开的，不要把 `MIMO_BASE_URL` 或 `KIMI_BASE_URL` 改成 DeepSeek 地址。
- `shop_warehouse_mapping_report.json` 属于本地报告，可能包含店铺信息，默认不会上传。

## GitHub 上传前检查

```bash
npm run check
git status --short --ignored
```

确认 `.env`、`node_modules/` 和本地报告处于 ignored 状态后，再提交代码。
