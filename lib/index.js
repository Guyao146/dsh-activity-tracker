/**
 * dsh-activity-tracker（宿主侧）v1.0.0
 *
 * 解析 ~/.dsh/sessions 下所有 session.jsonl.zstd（多帧 zstd，每帧一条 JSON 事件），
 * 聚合出「活动事件」（用户输入 / 代码编辑 / 命令 / 检索 / 其他）与 token 消耗
 * （assistant/message.usage 为每步增量，已与 session_projcache.json 对账验证），
 * 按本地时区分桶到 天×小时×项目。
 *
 * 路由（同源，X-DSH-Activity 自定义头防 CSRF）：
 * - GET /dsh-activity/api/overview        → 全量聚合（项目列表、会话、按天/按小时桶）
 * - GET /dsh-activity/api/day?date=&project= → 某天的明细事件流 + token 流
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

export const inject = ['webServer']

const API = '/dsh-activity/api'
const zstdSync = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

// ---------------- zstd 多帧解压（按 magic 28 B5 2F FD 切帧） ----------------
function decompressSession(buf) {
  if (!zstdSync) throw new Error('当前 Node 运行时缺少 zstd 支持（需要 Node 22.15+/24+）')
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i)
  }
  if (!starts.length || starts[0] !== 0) throw new Error('无法识别的会话文件格式')
  const parts = []
  let pending = null
  for (let i = 0; i < starts.length; i++) {
    const slice = buf.subarray(starts[i], starts[i + 1] ?? buf.length)
    const chunk = pending === null ? slice : Buffer.concat([pending, slice])
    try {
      parts.push(zstdSync(chunk))
      pending = null
    } catch (e) {
      pending = chunk // 可能是压缩数据里出现的假 magic：与下一帧合并重试
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

// ---------------- 事件分类 ----------------
const RE_EDIT = /^(edit|write|multiedit|multi_edit|apply_?patch|str_replace|str_replace_based_edit_tool|notebook_edit)$/i
const RE_CMD = /^(pwsh|powershell|bash|sh|shell|cmd|terminal|run_command|command|job_start|job_output|bash_local|pwsh_local)$/i
const RE_READ = /^(read|view|grep|glob|ls|list|find|search|ripgrep|ugrep|list_files|search_files|read_file|open)$/i

function kindOfTool(name) {
  if (RE_EDIT.test(name)) return 'e'
  if (RE_CMD.test(name)) return 'c'
  if (RE_READ.test(name)) return 'r'
  return 'o'
}

/** 从 tool/call 的 arguments（JSON 字符串）里提取可读摘要。 */
function toolLabel(name, argsRaw) {
  let args = null
  if (typeof argsRaw === 'string') {
    try { args = JSON.parse(argsRaw) } catch (e) { args = null }
  } else if (argsRaw && typeof argsRaw === 'object') {
    args = argsRaw
  }
  if (!args) return ''
  const file = args.file_path || args.path || args.filePath || args.filename
  if (file) {
    const short = String(file).split(/[\\/]/).filter(Boolean).pop() || String(file)
    return short.slice(0, 60)
  }
  const cmd = args.command || args.cmd || args.script
  if (cmd) return String(cmd).replace(/\s+/g, ' ').slice(0, 70)
  const pat = args.pattern || args.query || args.url || args.keyword
  if (pat) return String(pat).replace(/\s+/g, ' ').slice(0, 60)
  return ''
}

// ---------------- 单会话解析 ----------------
function parseSession(id, text) {
  const info = { id, cwd: '', createdAt: 0, title: '', turns: 0, events: [], tokens: [] }
  for (const line of text.split('\n')) {
    if (!line) continue
    let j
    try { j = JSON.parse(line) } catch (e) { continue }
    if (!j || !j.type) continue
    const d = j.data || {}
    const t = j.time || 0
    if (j.type === 'session') {
      info.cwd = j.cwd || d.cwd || ''
      info.createdAt = j.createdAt || d.createdAt || 0
    } else if (j.type === 'session/title') {
      if (!info.title && d.title) info.title = String(d.title)
    } else if (j.type === 'turn/start') {
      info.turns++
    } else if (j.type === 'user/message') {
      let label = ''
      const c = Array.isArray(d.content) ? d.content : []
      for (const part of c) {
        if (part && part.type === 'text' && part.text) { label = String(part.text); break }
      }
      info.events.push({ t, k: 'u', label: label.replace(/\s+/g, ' ').slice(0, 80) })
    } else if (j.type === 'tool/call') {
      const name = String(d.name || '')
      info.events.push({ t, k: kindOfTool(name), label: toolLabel(name, d.arguments), tool: name })
    } else if (j.type === 'assistant/message') {
      const u = d.usage
      if (u) {
        const src = (d.message && d.message.source) || {}
        info.tokens.push({
          t,
          in: u.inputTokens || 0,
          out: u.outputTokens || 0,
          cache: u.cacheReadTokens || 0,
          model: String(src.model || ''),
        })
      }
    }
  }
  return info
}

// ---------------- 会话文件缓存（mtime+size 失效） ----------------
const parseCache = new Map()

function listSessionFiles() {
  const root = join(dshHome(), 'sessions')
  const out = []
  let wsDirs = []
  try { wsDirs = readdirSync(root, { withFileTypes: true }) } catch (e) { return out }
  for (const ws of wsDirs) {
    if (!ws.isDirectory()) continue
    let sess = []
    try { sess = readdirSync(join(root, ws.name), { withFileTypes: true }) } catch (e) { continue }
    for (const sd of sess) {
      if (!sd.isDirectory()) continue
      const file = join(root, ws.name, sd.name, 'session.jsonl.zstd')
      if (existsSync(file)) out.push({ id: sd.name, file })
    }
  }
  return out
}

function getParsed(entry) {
  let mtimeMs = 0
  let size = 0
  try {
    const st = statSync(entry.file)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch (e) {
    return null
  }
  const hit = parseCache.get(entry.file)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.parsed
  let parsed = null
  try {
    parsed = parseSession(entry.id, decompressSession(readFileSync(entry.file)))
  } catch (e) {
    parsed = { id: entry.id, cwd: '', createdAt: 0, title: '', turns: 0, events: [], tokens: [], error: String((e && e.message) || e) }
  }
  parseCache.set(entry.file, { mtimeMs, size, parsed })
  return parsed
}

function allParsed() {
  const out = []
  for (const entry of listSessionFiles()) {
    const p = getParsed(entry)
    if (p) out.push(p)
  }
  return out
}

// ---------------- 时间分桶（宿主本地时区） ----------------
const p2 = (n) => (n < 10 ? '0' + n : String(n))
function dayHour(ts) {
  const d = new Date(ts)
  return [d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), d.getHours()]
}
function projNameOf(cwd) {
  const seg = String(cwd || '').split(/[\\/]/).filter(Boolean)
  return seg.length ? seg[seg.length - 1] : 'unknown'
}

function newDay() {
  const hours = []
  for (let i = 0; i < 24; i++) hours.push({ u: 0, e: 0, c: 0, r: 0, o: 0, ti: 0, to: 0, tc: 0 })
  return { u: 0, e: 0, c: 0, r: 0, o: 0, ti: 0, to: 0, tc: 0, hours }
}
function dayOf(map, date) {
  let d = map.get(date)
  if (!d) { d = newDay(); map.set(date, d) }
  return d
}
function addEvent(map, t, k) {
  const [date, h] = dayHour(t)
  const d = dayOf(map, date)
  d[k]++
  d.hours[h][k]++
}
function addToken(map, tk) {
  const [date, h] = dayHour(tk.t)
  const d = dayOf(map, date)
  d.ti += tk.in
  d.to += tk.out
  d.tc += tk.cache
  d.hours[h].ti += tk.in
  d.hours[h].to += tk.out
  d.hours[h].tc += tk.cache
}
function daysToObj(map) {
  const out = {}
  for (const [k, v] of map) {
    out[k] = { u: v.u, e: v.e, c: v.c, r: v.r, o: v.o, ti: v.ti, to: v.to, tc: v.tc, hours: v.hours }
  }
  return out
}

// ---------------- 聚合：overview / day ----------------
export function buildOverview() {
  const parsed = allParsed()
  const allDays = new Map()
  const byProject = new Map()
  const sessions = []
  for (const p of parsed) {
    const key = String(p.cwd || 'unknown').toLowerCase()
    const name = projNameOf(p.cwd)
    let proj = byProject.get(key)
    if (!proj) { proj = { key, name, path: p.cwd || '', sessions: 0, days: new Map() }; byProject.set(key, proj) }
    proj.sessions++
    let lastAt = p.createdAt || 0
    for (const ev of p.events) {
      addEvent(allDays, ev.t, ev.k)
      addEvent(proj.days, ev.t, ev.k)
      if (ev.t > lastAt) lastAt = ev.t
    }
    for (const tk of p.tokens) {
      addToken(allDays, tk)
      addToken(proj.days, tk)
      if (tk.t > lastAt) lastAt = tk.t
    }
    sessions.push({
      id: p.id,
      short: p.id.replace(/^session-/, '').slice(0, 8),
      project: name,
      projectKey: key,
      path: p.cwd || '',
      title: p.title || '',
      createdAt: p.createdAt || 0,
      lastAt,
      turns: p.turns,
      events: p.events.length,
      error: p.error || null,
    })
  }
  sessions.sort((a, b) => (b.lastAt || b.createdAt) - (a.lastAt || a.createdAt))
  const dateKeys = [...allDays.keys()].sort()
  const projObj = {}
  for (const [k, v] of byProject) {
    projObj[k] = { name: v.name, path: v.path, sessions: v.sessions, days: daysToObj(v.days) }
  }
  let tz = ''
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { tz = '' }
  return {
    ok: true,
    generatedAt: Date.now(),
    tz,
    home: dshHome(),
    range: { first: dateKeys[0] || null, last: dateKeys[dateKeys.length - 1] || null },
    projects: [...byProject.values()].map((v) => ({ key: v.key, name: v.name, path: v.path, sessions: v.sessions })),
    sessions,
    all: { days: daysToObj(allDays) },
    byProject: projObj,
  }
}

export function buildDay(date, projectKey) {
  const events = []
  const tokens = []
  for (const p of allParsed()) {
    const key = String(p.cwd || 'unknown').toLowerCase()
    if (projectKey && key !== projectKey) continue
    const name = projNameOf(p.cwd)
    for (const ev of p.events) {
      if (ev.t && dayHour(ev.t)[0] === date) {
        events.push({ t: ev.t, k: ev.k, p: name, label: ev.label || '', tool: ev.tool || '', s: p.id.replace(/^session-/, '').slice(0, 8) })
      }
    }
    for (const tk of p.tokens) {
      if (tk.t && dayHour(tk.t)[0] === date) {
        tokens.push({ t: tk.t, p: name, in: tk.in, out: tk.out, cache: tk.cache, model: tk.model })
      }
    }
  }
  events.sort((a, b) => a.t - b.t)
  tokens.sort((a, b) => a.t - b.t)
  return { ok: true, date, project: projectKey || 'all', events: events.slice(0, 8000), tokens: tokens.slice(0, 8000) }
}

// ---------------- 路由 ----------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const disposer = webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      if (req.headers['x-dsh-activity'] !== '1') return sendJson(res, 403, { ok: false, error: 'forbidden' })
      let url
      try { url = new URL(req.url, 'http://127.0.0.1') } catch (e) { return sendJson(res, 400, { ok: false, error: 'bad url' }) }
      try {
        if (url.pathname === API + '/overview') {
          return sendJson(res, 200, buildOverview())
        }
        if (url.pathname === API + '/day') {
          const date = String(url.searchParams.get('date') || '').trim()
          const project = String(url.searchParams.get('project') || '').trim()
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { ok: false, error: 'date 参数需要 YYYY-MM-DD' })
          if (project && !/^[a-z0-9_\\:.\-]+$/i.test(project)) return sendJson(res, 400, { ok: false, error: 'project 参数不合法' })
          return sendJson(res, 200, buildDay(date, project || null))
        }
        return sendJson(res, 404, { ok: false, error: 'unknown api' })
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    },
  })
  ctx.on('dispose', () => disposer())
}
