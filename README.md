# dsh-activity-tracker

[![樱落生态成员](https://raw.githubusercontent.com/Guyao146/Sakura-EcoSystem-wiki/main/assets/ConnectEcoSystem.svg)](https://mcylyr.cn)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c7dff)](https://github.com/deepseek-ai/deepseek-harness)
[![已编写Wiki](https://raw.githubusercontent.com/Guyao146/Sakura-EcoSystem-wiki/main/assets/sakura-wiki.svg)](https://wiki.mcylyr.cn/)

`dsh-activity-tracker` 是一个面向 **DeepSeek Harness（DSH）Web** 的本地活动统计插件。它读取 DSH 已有的会话记录，将用户输入、代码编辑、命令执行、检索阅读、其他工具调用以及 Token 消耗按日期、小时和项目聚合，并在 DSH 侧栏中提供可视化统计面板。

> 所有统计均在运行 DSH 的本机完成。插件不会上传会话内容，也不依赖外部统计服务。

## 樱落生态Wiki
该项目已编写Wiki，了解插件更多细节 https://wiki.mcylyr.cn

## 功能特性

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
- **生活看板双向会话**：可选将授权工作区的会话快照通过 HMAC 签名 HTTPS 推送到生活看板；管理员可向当前运行中的 DSH 会话发送后续消息。
- **六位码一键配对**：在生活看板生成一次性验证码后，直接在 DSH「活动统计 → 总设置」完成连接，无需手动创建或编辑 JSON 配置文件。

## 面板内容

预览：
<img width="1234" height="1269" alt="image" src="https://github.com/user-attachments/assets/46a91d7d-53e8-42bc-93c3-a3896e3701a0" />

## 环境要求

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

## 安装

Web版本 DSH
```bash
dsh plugin --profile web add dsh-activity-tracker@latest
```

Desktop版本 DSH
```bash
dsh plugin --profile web add dsh-activity-tracker@latest
```

安装后请**重启 DSH **。页面加载完成后，“新会话”按钮下方会出现 **📊 活动统计** 入口。

> `cordis.patch.yml` 会由 DSH 的插件安装流程读取，并自动添加 `activity-tracker` 插件配置。

## 使用方法

1. 启动或重启 DSH Web。
2. 在 DSH 左侧栏找到 **活动统计**。
3. 点击入口打开统计浮层。
4. 使用顶部筛选器选择项目、会话和时间范围。
5. 点击热力图日期或每日汇总表中的日期，查看当天的小时分布和事件时间线。
6. 新会话产生数据后，点击右上角的 **刷新** 重新扫描。

## 已知限制

- 仅统计当前 DSH 数据目录中仍然存在的会话文件。
- 首次扫描大量历史会话时可能需要一定时间。
- 项目筛选标识基于完整工作目录；项目移动后会被视为不同项目。
- 工具分类采用名称匹配规则，新工具可能暂时显示为“其他工具”。
- 当前版本仅提供本地统计，不支持跨设备同步、费用换算或数据导出。
