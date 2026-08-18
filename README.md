# 📊 dsh-activity-tracker

[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c7dff)](https://github.com/deepseek-ai/deepseek-harness)
[![Version](https://img.shields.io/badge/version-1.0.0-2ea043)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-blue)](./package.json)

`dsh-activity-tracker` 是一个面向 **DeepSeek Harness（DSH）Web** 的本地活动统计插件。它读取 DSH 已有的会话记录，将用户输入、代码编辑、命令执行、检索阅读、其他工具调用以及 Token 消耗按日期、小时和项目聚合，并在 DSH 侧栏中提供可视化统计面板。

> 所有统计均在运行 DSH 的本机完成。插件不会上传会话内容，也不依赖外部统计服务。

## ✨ 功能特性

- **统计概览**：展示输入 Token、输出 Token、缓存读取 Token、活动事件数和会话数。
- **活跃热力图**：以 GitHub Contributions 风格展示近 26 周的活动强度。
- **24 小时活动分布**：按小时查看不同类型事件的堆叠分布。
- **24 小时 Token 分布**：查看一天中各小时的 Token 使用情况。
- **当日事件时间线**：展示事件发生时间、事件类型、工具名称、内容摘要、项目和模型。
- **每日汇总表**：汇总近 31 个活跃日的事件数与 Token 消耗。
- **多项目过滤**：按 DSH 会话的工作目录区分项目，可查看全部或单个项目。
- **时间范围过滤**：支持今日、近 7 天、近 30 天和全部记录。
- **本地时区统计**：所有日期和小时均按照 DSH 宿主机的本地时区计算。
- **增量解析缓存**：根据会话文件的修改时间和大小复用解析结果，减少重复扫描开销。
- **侧栏入口自恢复**：通过 `MutationObserver` 在 DSH 页面更新后自动恢复“活动统计”入口。
- **明暗主题适配**：统计浮层可跟随浏览器的浅色或深色主题。

## 🖥️ 面板内容

预览：
<img width="1110" height="1344" alt="image" src="https://github.com/user-attachments/assets/c1a2c7ee-2aaa-4d4f-8cdc-08f0dce12415" />


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

### 方式一：使用仓库中的安装包

1. 下载仓库根目录中的 `dsh-activity-tracker-1.0.0.tgz`。
2. 使用本地文件安装插件：

```bash
dsh plugin --profile web add "file:<安装包路径>/dsh-activity-tracker-1.0.0.tgz"
```

Windows 示例：

```powershell
dsh plugin --profile web add "file:C:\Downloads\dsh-activity-tracker-1.0.0.tgz"
```

### 方式二：从源码打包安装

```bash
git clone https://github.com/Guyao146/dsh-activity-tracker.git
cd dsh-activity-tracker
npm pack
dsh plugin --profile web add "file:./dsh-activity-tracker-1.0.0.tgz"
```

安装后请**重启 DSH Web**。页面加载完成后，“新会话”按钮下方会出现 **📊 活动统计** 入口。

> `cordis.patch.yml` 会由 DSH 的插件安装流程读取，并自动添加 `activity-tracker` 插件配置。

## 🚀 使用方法

1. 启动或重启 DSH Web。
2. 在 DSH 左侧栏找到 **📊 活动统计**。
3. 点击入口打开统计浮层。
4. 使用顶部筛选器选择项目和时间范围。
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
- 插件没有遥测、埋点或第三方网络请求。
- 浏览器端只请求同源接口 `/dsh-activity/api`。
- API 要求请求头 `X-DSH-Activity: 1`，用于降低跨站请求伪造风险。
- API 响应包含活动摘要，例如用户文本片段、文件名、命令和查询。请勿将接口暴露给不受信任的访问者。
- 宿主端仅注册 `GET` 查询能力，不会修改或删除 DSH 会话文件。

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
GET /dsh-activity/api/day?date=YYYY-MM-DD&project=<项目标识>
```

参数：

- `date`：必填，格式为 `YYYY-MM-DD`。
- `project`：可选，为项目完整工作目录的小写形式；不传时返回全部项目。

为控制响应体积，单日事件和 Token 明细分别最多返回 8,000 条。

## 📁 项目结构

```text
.
├─ cordis.patch.yml                 # DSH 插件激活补丁
├─ dsh-activity-tracker-1.0.0.tgz  # 可直接安装的插件包
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

根据 `package.json` 中的 `files` 字段，安装包只包含：

- `lib/`
- `cordis.patch.yml`
- `README.md`
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

## ⚠️ 已知限制

- 仅统计当前 DSH 数据目录中仍然存在的会话文件。
- 首次扫描大量历史会话时可能需要一定时间。
- 项目筛选标识基于完整工作目录；项目移动后会被视为不同项目。
- 工具分类采用名称匹配规则，新工具可能暂时显示为“其他工具”。
- 当前版本仅提供本地统计，不支持跨设备同步、费用换算或数据导出。

## 🤝 社区与支持

- DSH 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- 欢迎通过 [DeepSeek Harness GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 Bug 报告。
- 本仓库使用 [`dsh-plugin`](https://github.com/topics/dsh-plugin) Topic，便于在 GitHub 上发现 DSH 插件。
- 欢迎加入 [DeepSeek Harness Discord 社区](https://discord.gg/Ycq5dCaS4)。

## 📄 License

本项目使用 MIT License。
