# 📊 dsh-activity-tracker

[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c7dff)](https://github.com/deepseek-ai/deepseek-harness)
[![Version](https://img.shields.io/badge/version-1.4.5-2ea043)](./package.json)
[![Release](https://img.shields.io/github/v/release/Guyao146/dsh-activity-tracker?display_name=tag)](https://github.com/Guyao146/dsh-activity-tracker/releases/latest)
[![Package and Release](https://github.com/Guyao146/dsh-activity-tracker/actions/workflows/release.yml/badge.svg)](https://github.com/Guyao146/dsh-activity-tracker/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](./LICENSE)

`dsh-activity-tracker` 是一个面向 **DeepSeek Harness（DSH）Web** 的本地活动统计插件。它读取 DSH 已有的会话记录，将用户输入、代码编辑、命令执行、检索阅读、其他工具调用以及 Token 消耗按日期、小时和项目聚合，并在 DSH 侧栏中提供可视化统计面板。

> 所有统计均在运行 DSH 的本机完成。插件不会上传会话内容，也不依赖外部统计服务。

## ✨ 功能特性

- **统计概览**：展示输入 Token、输出 Token、缓存读取 Token、活动事件数和会话数。
- **活跃热力图**：以 GitHub Contributions 风格展示近 26 周的活动强度。
- **24 小时活动分布**：按小时查看不同类型事件的堆叠分布。
- **24 小时 Token 分布**：查看一天中各小时的 Token 使用情况。
- **当日事件时间线**：展示事件发生时间、事件类型、工具名称、内容摘要、项目和模型。
- **每日汇总表**：汇总近 31 个活跃日的事件数与 Token 消耗。
- **费用统计**：按项目、模型、项目 × 模型和日期查看 Sub2API 价格计算结果。
- **Sub2API 账号登录与价格同步**：支持账号密码登录、TOTP 二次验证、Token 自动续期、手动同步、每天首次启动自动同步和每日价格历史快照。
- **Sub2API 账户摘要**：登录后显示中转站名称、当前账号、余额以及已订阅分组的月度使用量/额度。
- **余额卡片**：账户余额直接并入活动概览卡片，不再单独占用顶部提示条。
- **可定制仪表盘**：在“总设置”中开关模块、选择小/中/大三档样式、拖拽模块排序，并拖动面板边缘或使用滑块调整宽度。
- **灵活日期范围**：支持今天、7 天、15 天、30 天、自定义日期和全部；热力图、概览、每日汇总会同步当前范围。
- **长范围翻页**：自定义范围超过 30 天时按 30 天窗口左右翻页。
- **卡片快捷设置**：每个仪表盘模块右上角都有三点菜单，可直接选择小、中、大或关闭。
- **宿主持久化**：模块开关、尺寸、顺序、宽度和筛选同时保存到 DSH 宿主机，重启后自动恢复。
- **容器响应式布局**：根据活动面板自身宽度而不是浏览器窗口宽度自动重排；窄面板会将模块切为整行，概览卡片自动切换为 3 / 2 / 1 列。
- **多项目过滤**：按 DSH 会话的工作目录区分项目，可查看全部或单个项目。
- **会话过滤**：可在全部项目或选定项目下继续选择单个会话，所有概览、图表、热力图和时间线同步过滤。
- **统一筛选栏**：项目、会话与日期选择器使用统一高度和响应式列宽；关闭按钮固定在标题栏右上角。
- **时间范围过滤**：支持今日、近 7 天、近 30 天和全部记录。
- **本地时区统计**：所有日期和小时均按照 DSH 宿主机的本地时区计算。
- **增量解析缓存**：根据会话文件的修改时间和大小复用解析结果，减少重复扫描开销。
- **侧栏入口自恢复**：通过 `MutationObserver` 在 DSH 页面更新后自动恢复“活动统计”入口。
- **明暗主题适配**：统计浮层可跟随浏览器的浅色或深色主题。

## 🖥️ 面板内容

预览：
<img width="1234" height="1269" alt="image" src="https://github.com/user-attachments/assets/46a91d7d-53e8-42bc-93c3-a3896e3701a0" />


活动事件分为以下五类：

| 类型 | 颜色 | 典型事件 |
| --- | --- | --- |
| 用户输入 | 绿色（`#2ea043`） | `user/message` |
| 代码编辑 | 🔵 蓝色 | `edit`、`write`、`apply_patch`、`str_replace` 等 |
| 命令执行 | 🟠 橙色 | `bash`、`pwsh`、`cmd`、`run_command` 等 |
| 检索阅读 | 🩵 青色 | `read`、`grep`、`glob`、`search_files`、`list_files` 等 |
| 其他工具 | 🟣 紫色 | 未归入以上分类的工具调用 |

热力图颜色主要依据当天的 Token 总量（输入 + 输出 + 缓存读取）计算；没有 Token 记录但存在活动事件的日期也会显示为活跃。

## 📋 环境要求

- 已安装并能够正常运行的 DSH Web 环境。
- DSH 能够加载本地插件和 Web 客户端扩展。
- **Node.js 22.15+ 或 24+**，且运行时需要提供 `node:zlib` 的 `zstdDecompressSync`。
- 本机存在可读取的 DSH 会话目录：`~/.dsh/sessions`。

Windows 默认对应：

```text
C:\Users\<用户名>\.dsh\sessions
```

如果设置了 `DSH_HOME` 环境变量，插件会改为读取：

```text
%DSH_HOME%\sessions
```

## 📦 安装

### 方式一：安装 GitHub Release 最新版本（推荐）

1. 从 [Releases](https://github.com/Guyao146/dsh-activity-tracker/releases/latest) 下载 `dsh-activity-tracker.tgz`。
2. 使用本地文件安装插件：

```bash
dsh plugin --profile web add "file:<安装包路径>/dsh-activity-tracker.tgz"
```

Windows 示例：

```powershell
dsh plugin --profile web add "file:C:\Downloads\dsh-activity-tracker.tgz"
```

### 方式二：从 GitHub 项目拉取并安装

如果只想直接下载发布包并安装，可以使用一行命令：

```bash
curl -fL https://github.com/Guyao146/dsh-activity-tracker/releases/latest/download/dsh-activity-tracker.tgz -o dsh-activity-tracker.tgz && dsh plugin --profile web add "file:./dsh-activity-tracker.tgz"
```

也可以使用 `wget` 下载 `main` 分支中的安装包：

```bash
wget -O dsh-activity-tracker.tgz https://github.com/Guyao146/dsh-activity-tracker/releases/latest/download/dsh-activity-tracker.tgz && dsh plugin --profile web add "file:./dsh-activity-tracker.tgz"
```

Windows PowerShell：

```powershell
Invoke-WebRequest -Uri "https://github.com/Guyao146/dsh-activity-tracker/releases/latest/download/dsh-activity-tracker.tgz" -OutFile "dsh-activity-tracker.tgz"; if ($?) { dsh plugin --profile web add "file:./dsh-activity-tracker.tgz" }
```

适合希望直接使用 GitHub 最新源码和安装包的场景：

```bash
git clone https://github.com/Guyao146/dsh-activity-tracker.git
cd dsh-activity-tracker
npm pack
dsh plugin --profile web add "file:./dsh-activity-tracker-1.4.5.tgz"
```

Windows PowerShell：

```powershell
git clone https://github.com/Guyao146/dsh-activity-tracker.git
Set-Location dsh-activity-tracker
npm pack
dsh plugin --profile web add "file:./dsh-activity-tracker-1.4.5.tgz"
```

如果项目中没有现成的 `.tgz`，或你希望使用最新源码重新打包：

```bash
npm pack
dsh plugin --profile web add "file:./dsh-activity-tracker-1.4.5.tgz"
```

安装后请**重启 DSH Web**。页面加载完成后，“新会话”按钮下方会出现 **📊 活动统计** 入口。

> `cordis.patch.yml` 会由 DSH 的插件安装流程读取，并自动添加 `activity-tracker` 插件配置。

## 🚀 使用方法

1. 启动或重启 DSH Web。
2. 在 DSH 左侧栏找到 **📊 活动统计**。
3. 点击入口打开统计浮层。
4. 使用顶部筛选器选择项目、会话和时间范围。
5. 点击热力图日期或每日汇总表中的日期，查看当天的小时分布和事件时间线。
6. 新会话产生数据后，点击右上角的 **刷新** 重新扫描。

## 📊 数据来源与统计口径

插件直接读取以下文件：

```text
~/.dsh/sessions/*/*/session.jsonl.zstd
```

这些文件是多帧 Zstandard 压缩的 JSON Lines 会话事件。宿主端会解析并聚合：

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 项目 | 会话中的 `cwd` | 使用工作目录最后一级作为项目名称，完整路径作为项目标识 |
| 会话标题 | `session/title` | 仅用于会话元数据 |
| 会话轮次 | `turn/start` | 每出现一次计为一轮 |
| 用户活动 | `user/message` | 计入“用户输入”事件 |
| 工具活动 | `tool/call` | 根据工具名称归类，并提取文件名、命令或查询作为摘要 |
| Token | `assistant/message.usage` | 分别累计输入、输出和缓存读取 Token |
| 时间 | 事件的 `time` | 按宿主机本地时区归入日期与小时 |

### Token 说明

- **输入 Token**：`inputTokens`，表示未命中缓存的输入增量。
- **输出 Token**：`outputTokens`，表示模型输出增量，可能包含思考内容。
- **缓存读取 Token**：`cacheReadTokens`，表示命中上下文缓存的部分。
- 面板展示的是各条 `assistant/message.usage` 的累计值，不代表实际账单金额。

## 🔐 隐私与安全

- 数据只从本机 DSH 会话目录读取，并在本机内存中聚合。
- 插件没有遥测或埋点。只有在用户配置 Sub2API 后，宿主端才会请求该地址完成登录、Token 续期、账户摘要和价格同步。
- 浏览器端只请求同源接口 `/dsh-activity/api`。
- API 要求请求头 `X-DSH-Activity: 1`，用于降低跨站请求伪造风险。
- API 响应包含活动摘要，例如用户文本片段、文件名、命令和查询。请勿将接口暴露给不受信任的访问者。
- 宿主端不会修改或删除 DSH 会话文件；配置、登录、同步和退出使用本地插件 API 的 `PUT`/`POST` 路由。

## 🏗️ 工作原理

```text
~/.dsh/sessions/*/*/session.jsonl.zstd
                    │
                    ▼
             lib/index.js
     解压 → 解析 → 分类 → 按日期/小时/项目聚合
                    │
                    ▼
       /dsh-activity/api/overview
       /dsh-activity/api/day
                    │
                    ▼
             lib/client.js
     侧栏入口 + React 浮层 + 图表与事件时间线
```

### 宿主端

`lib/index.js` 负责：

- 扫描 DSH 会话目录；
- 解压多帧 Zstandard 文件；
- 解析会话事件并分类；
- 根据文件 `mtime + size` 缓存解析结果；
- 按本地时区、项目、日期和小时聚合数据；
- 通过 DSH `webServer` 注册统计 API。

### 浏览器端

`lib/client.js` 负责：

- 注入侧栏“活动统计”按钮；
- 注册 `shell.overlay` 浮层；
- 请求宿主端统计 API；
- 渲染统计卡片、热力图、小时图、时间线和每日表格；
- 管理项目、日期和时间范围筛选状态。

## 🔌 API

API 主要供插件前端使用。所有请求都需要携带：

```http
X-DSH-Activity: 1
```

### 获取统计概览

```http
GET /dsh-activity/api/overview
```

返回项目列表、会话摘要、总览数据、按项目数据以及按日期和小时聚合的数据。

### 获取单日明细

```http
GET /dsh-activity/api/day?date=YYYY-MM-DD&project=<项目标识>&session=<会话 ID>
```

参数：

- `date`：必填，格式为 `YYYY-MM-DD`。
- `project`：可选，为项目完整工作目录的小写形式；不传时返回全部项目。
- `session`：可选，格式为 `session-...`；传入后只返回该会话的事件与 Token 明细。

为控制响应体积，单日事件和 Token 明细分别最多返回 8,000 条。

### 生活看板实时工作区接口

插件可以为 [Life Dashboard](https://github.com/Guyao146/Life-Dashboard) 提供只读工作区状态：

```http
GET /dsh-activity/api/workspaces
X-DSH-Dashboard-Token: <共享令牌>
```

状态按最后活动时间划分为：2 分钟内“工作中”、15 分钟内“活跃”、60 分钟内“最近活动”，其余为“空闲”。接口只返回项目名称、不透明工作区/会话 ID、时间和聚合计数，不返回完整工作目录、会话标题、用户输入或命令内容。

在运行 DSH 的主机创建：

```text
~/.dsh/dsh-activity-tracker-dashboard.json
```

内容如下，令牌至少 24 个字符，建议使用 32 字节随机值：

```json
{
  "token": "replace-with-a-random-32-byte-or-longer-secret"
}
```

也可以通过环境变量 `DSH_ACTIVITY_DASHBOARD_TOKEN` 配置；环境变量优先于 JSON 文件。修改后需要重启 DSH。Life Dashboard 服务器需要将可访问的 DSH 地址填入 `LIFE_HUB_DSH_URL`，并将同一令牌填入 `LIFE_HUB_DSH_TOKEN`。

### Sub2API 配置与同步

```http
GET /dsh-activity/api/pricing/config
PUT /dsh-activity/api/pricing/config
POST /dsh-activity/api/pricing/sync
GET /dsh-activity/api/costs
```

这些接口由插件前端使用：

- `GET /pricing/config`：读取已配置的地址、是否已配置用户 JWT、默认分组和最近同步状态，不返回 Token；
- `PUT /pricing/config`：保存 `baseUrl`、用户 JWT 和可选的 `groupId`；
- `GET /pricing/account`：使用当前登录会话读取中转站名称、账号余额和订阅额度摘要，不返回任何认证 Token；
- `POST /pricing/sync`：立即从 Sub2API 获取当天模型价格并保存快照；
- `GET /costs`：返回总费用以及按项目、模型、项目 × 模型和日期聚合的费用。

### UI 配置持久化

```http
GET /dsh-activity/api/ui/config
PUT /dsh-activity/api/ui/config
```

用于读取和保存模块开关、尺寸、顺序、面板宽度、项目/会话筛选和日期范围。配置保存在：

```text
DSH_HOME/dsh-activity-tracker-ui.json
```

### 总设置与仪表盘布局

打开 **📊 活动统计 → 总设置** 可以：

- 登录/退出 Sub2API，并查看当前中转站名称、余额和订阅摘要；
- 开关概览卡片、热力图、事件图例、小时图、Token 图、时间线和每日汇总等模块；
- 为每个模块选择 **小 / 中 / 大** 三档样式；
- 直接拖动模块列表排序，也可以使用上下按钮微调顺序；
- 使用宽度滑块或浮层左侧边缘拖动手柄调整面板宽度。
- 使用每个模块右上角的三点菜单直接选择小、中、大或关闭模块。

布局会同时保存在浏览器 `localStorage` 和 DSH 宿主机的 `DSH_HOME/dsh-activity-tracker-ui.json`。模块开关、大小、顺序、面板宽度、项目与日期筛选会在重启后自动恢复；升级插件不会覆盖已有布局。

## 📁 项目结构

```text
.
├─ cordis.patch.yml                 # DSH 插件激活补丁
├─ .github/workflows/release.yml   # 自动打包并发布 GitHub Release
├─ LICENSE                         # GNU AGPL v3.0 only 许可证全文
├─ package.json                     # 包信息及 DSH 扩展声明
├─ README.md                        # 项目文档
└─ lib/
   ├─ index.js                      # 宿主端扫描、聚合与 API
   └─ client.js                     # 浏览器端入口与统计面板
```

## 🛠️ 开发与打包

本项目当前发布的是可直接由 DSH 加载的 JavaScript 文件，不需要额外构建步骤，也没有第三方 npm 运行时依赖。

检查安装包内容：

```bash
npm pack --dry-run
```

生成安装包：

```bash
npm pack
```

### 自动发布 GitHub Release

向 `main` 推送后，`.github/workflows/release.yml` 会读取 `package.json` 中的版本号：

1. 校验 JavaScript 语法并执行 `npm pack --dry-run`；
2. 生成并核对安装包内容；
3. 创建 `v<version>` Git Tag 和 GitHub Release；
4. 上传版本化安装包、固定名 `dsh-activity-tracker.tgz` 和 `SHA256SUMS.txt`；
5. 如果对应版本 Release 已存在则安全跳过，不会覆盖已发布附件。

因此发布新版本只需修改 `package.json` 的 `version` 并推送到 `main`。也可以在 GitHub Actions 页面手动运行 **Package and Release**。构建产物不提交到 Git 仓库，最新版本始终可通过固定地址下载：

```text
https://github.com/Guyao146/dsh-activity-tracker/releases/latest/download/dsh-activity-tracker.tgz
```

根据 `package.json` 中的 `files` 字段，安装包只包含：

- `lib/`
- `cordis.patch.yml`
- `README.md`
- `LICENSE`
- npm 自动包含的 `package.json`

修改宿主端或浏览器端代码后，请重新打包、重新安装插件并重启 DSH Web。

## ❓ 常见问题

### 侧栏没有“活动统计”入口

1. 确认插件使用 `--profile web` 安装。
2. 安装后完整重启 DSH Web。
3. 刷新浏览器页面。
4. 检查 DSH 插件配置中是否存在 `activity-tracker`。

### 提示“当前 Node 运行时缺少 zstd 支持”

当前 Node.js 版本不支持 `zlib.zstdDecompressSync`。请将实际运行 DSH 的 Node.js 升级到 **22.15+ 或 24+**，然后重启 DSH。

### 面板中没有数据

- 先在 DSH 中完成至少一次会话交互，再点击“刷新”。
- 检查 `~/.dsh/sessions` 是否存在及当前用户是否有读取权限。
- 如果使用了 `DSH_HOME`，确认该变量指向正确的 DSH 数据目录。

### 某些会话没有被统计

- 损坏或格式无法识别的会话文件会被跳过，并在会话摘要中记录错误。
- 活动分类依赖工具名称；未知工具会归入“其他工具”。
- 项目名称取自会话工作目录的最后一级，同名但路径不同的项目仍使用完整路径分别聚合。

### 数据为什么和服务商账单不完全一致

插件累计的是 DSH 会话事件中的 Token usage，不计算价格、折扣、免费额度或服务端账单修正，因此仅用于活动分析和用量参考。

## 💰 Sub2API 费用统计

插件支持从自建的 [Sub2API](https://github.com/Wei-Shaw/sub2api) 获取模型价格，并根据 DSH 会话实际使用的模型计算费用。

### 配置

打开 **📊 活动统计 → 总设置** 可以：

- **API 地址**：Sub2API 部署地址，例如 `https://sub2api.example.com`；
- **登录邮箱和密码**：插件宿主直接调用 Sub2API 登录接口，密码仅用于本次登录，不会写入本地文件；
- 如果账号启用了 TOTP 二次验证，按提示继续输入 6 位动态验证码；
- **默认分组 ID**（可选）：同一模型存在多个可用分组时，指定要采用的分组。

配置后可以选择：

- **登录并自动同步**：登录成功后立即请求最新价格；
- **保存配置 / 保存并立即同步**：用于更改分组，或在高级选项中手动提供 JWT；
- 每天第一次加载插件时自动同步当天价格；
- 费用统计页打开时使用当天已有快照，避免重复请求。

登录成功后，插件保存 Sub2API 返回的 `access_token`、`refresh_token`、到期时间和脱敏用户信息；Access Token 临近到期或接口返回 401 时会自动刷新并重试一次。Token 只保存在 DSH 宿主机的 `DSH_HOME/dsh-activity-tracker-pricing.json`，不会返回给浏览器，也不会写入统计响应。密码和 TOTP 验证码不会落盘。

> 网站 API Key 页面生成的 `sk-...` 是模型调用 Key，可用于 `/v1/models`、对话等接口，但不能访问 `/api/v1/channels/available` 的价格信息。请使用插件内账号登录，不要把 `sk-...` 填入 JWT 输入框。

### 价格来源与计算方式

宿主端请求 Sub2API：

```http
GET /api/v1/channels/available
Authorization: Bearer <Sub2API 用户 access_token/JWT>
```

插件读取每个模型的：

- `input_price`：输入 Token 单价；
- `output_price`：输出 Token 单价；
- `cache_read_price`：缓存读取 Token 单价；
- 所属分组的 `rate_multiplier`：Sub2API 分组倍率。

费用计算公式为：

```text
输入 Token × 输入单价
+ 输出 Token × 输出单价
+ 缓存读取 Token × 缓存读取单价
```

最后将结果乘以分组倍率。Sub2API 返回的价格按每 Token 处理；如果你的部署返回的价格单位不同，请先确认 Sub2API 的计价配置。

### 历史快照

每天同步成功后，插件会按本地日期保存一份价格快照。历史 Token 会优先使用对应日期快照；如果该日期没有快照，则回退到最近的较早快照。这样修改今天的模型价格不会重算过去的费用。

费用统计页提供：

- 按项目统计；
- 按模型统计；
- 按项目 × 模型统计；
- 每日费用历史；
- 已匹配价格 Token 和缺少价格 Token 数量。

如果 DSH 使用的模型未在 Sub2API 返回结果中匹配到，Token 仍会统计，但费用显示为未计价，不会错误显示为 0 元。

> 如果同步提示认证失效，请回到设置页重新登录。高级模式仍支持填写纯 JWT 或带 `Bearer ` 前缀的 JWT，但不建议手工维护短期 Token。

## ⚠️ 已知限制

- 仅统计当前 DSH 数据目录中仍然存在的会话文件。
- 首次扫描大量历史会话时可能需要一定时间。
- 项目筛选标识基于完整工作目录；项目移动后会被视为不同项目。
- 工具分类采用名称匹配规则，新工具可能暂时显示为“其他工具”。
- 当前版本仅提供本地统计，不支持跨设备同步、费用换算或数据导出。

## 🤝 社区与支持

- DSH 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- 欢迎通过[本项目 Issues](https://github.com/Guyao146/dsh-activity-tracker/issues) 提交反馈或 Bug 报告，请不要前往 DSH 官方仓库反馈本插件的问题。
- 本仓库使用 [`dsh-plugin`](https://github.com/topics/dsh-plugin) Topic，便于在 GitHub 上发现 DSH 插件。
- 欢迎加入 [DeepSeek Harness Discord 社区](https://discord.gg/Ycq5dCaS4)。

## 📄 License

本项目使用 **GNU Affero General Public License v3.0 only**（SPDX：`AGPL-3.0-only`）。完整条款见 [LICENSE](./LICENSE)。

简要说明：你可以使用、研究、修改和再分发本项目，但分发修改版时必须继续以 AGPL v3 提供对应源代码；如果修改后的程序通过网络向用户提供功能，也必须向这些网络用户提供该修改版本的完整对应源代码。本段仅为便于理解的摘要，不替代正式许可证文本。
