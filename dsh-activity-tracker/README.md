# 📊 dsh-activity-tracker

DeepSeek Harness（DSH）活动统计插件：看你在 dsh 里**什么时候干活/改代码**（彩色时间线），以及**每天花了多少 token**，支持**分项目 / 分日期 / 分小时**查看。

## 功能

- **活跃热力图**（GitHub contributions 风格，近 26 周）：颜色深浅 = 当日 token 消耗，点击任意日期查看当日明细
- **24 小时活动分布**：按类型分色的堆叠柱状图
  - 🟢 用户输入　🔵 代码编辑（write/edit）　🟠 命令执行（pwsh/bash）
  - 🔵 检索阅读（read/grep/glob）　🟣 其他工具
- **当日时间线**：每条事件的精确时刻 + 类型 + 内容摘要（编辑了哪个文件、跑了什么命令、每步 token 增量与模型）
- **每日汇总表**：近 31 个活跃日的输入/输出/缓存读 token 与各类事件数
- **过滤器**：项目（全部/单个 workspace）、时间范围（今日/近7天/近30天/全部）

## 数据源

直接解析 `~/.dsh/sessions/*/*/session.jsonl.zstd`（多帧 zstd，每帧一条 JSON 事件）：

- 活动时间取各事件的 `time`；token 取 `assistant/message.usage`（每步增量，已与 `session_projcache.json` 对账验证）
- 按宿主本地时区分桶到 天 × 小时 × 项目；文件按 mtime+size 缓存，增量重扫

## 安装

```bash
dsh plugin --profile web add "file:<本目录打包出的 tgz>"
# 重启 dsh web 后，侧栏「新会话」下方出现「📊 活动统计」
```

## 架构

- 宿主侧 `lib/index.js`：扫描+解压+聚合，注册 `/dsh-activity/api/{overview,day}`（自定义头 `X-DSH-Activity: 1` 防 CSRF）
- 浏览器侧 `lib/client.js`：React + `shell.overlay` 浮层 + 克隆侧栏按钮（MutationObserver 自愈）

License: MIT
