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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

export const inject = ['webServer']

const API = '/dsh-activity/api'
const zstdSync = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

const pricingFile = () => join(dshHome(), 'dsh-activity-tracker-pricing.json')
const uiFile = () => join(dshHome(), 'dsh-activity-tracker-ui.json')
const emptyPricingState = () => ({
  config: { baseUrl: '', apiKey: '', refreshToken: '', expiresAt: 0, user: null, groupId: '' },
  account: { siteName: '', fetchedAt: 0, user: null, subscriptions: { active_count: 0, total_used_usd: 0, subscriptions: [] } },
  snapshots: {}, lastSync: null, error: null,
})
function readPricingState() {
  try {
    const raw = JSON.parse(readFileSync(pricingFile(), 'utf8'))
    const empty = emptyPricingState()
    return { ...empty, ...raw, config: { ...empty.config, ...(raw.config || {}) }, account: { ...empty.account, ...(raw.account || {}) }, snapshots: raw.snapshots || {} }
  } catch (e) { return emptyPricingState() }
}
function writePricingState(state) {
  mkdirSync(dshHome(), { recursive: true })
  writeFileSync(pricingFile(), JSON.stringify(state, null, 2), 'utf8')
}
function readUiState() {
  try {
    const value = JSON.parse(readFileSync(uiFile(), 'utf8'))
    return { layout: value && value.layout && typeof value.layout === 'object' ? value.layout : null, filters: value && value.filters && typeof value.filters === 'object' ? value.filters : null }
  } catch (e) { return { layout: null, filters: null } }
}
function writeUiState(next) {
  const current = readUiState()
  const state = {
    layout: next.layout && typeof next.layout === 'object' ? next.layout : current.layout,
    filters: next.filters && typeof next.filters === 'object' ? next.filters : current.filters,
  }
  mkdirSync(dshHome(), { recursive: true })
  writeFileSync(uiFile(), JSON.stringify(state, null, 2), 'utf8')
  return state
}
function publicPricingState(state) {
  const token = normalizeBearerToken(state.config.apiKey)
  const credentialType = token.startsWith('sk-') ? 'api_key' : (token.split('.').length === 3 ? 'jwt' : (token ? 'unknown' : 'none'))
  return {
    config: { baseUrl: state.config.baseUrl, configured: Boolean(state.config.baseUrl && token), loggedIn: Boolean(state.config.refreshToken), credentialType, user: state.config.user || null, expiresAt: Number(state.config.expiresAt) || 0, groupId: state.config.groupId || '' },
    account: state.account || emptyPricingState().account,
    snapshots: state.snapshots, lastSync: state.lastSync, error: state.error,
  }
}
let pricingSyncPromise = null

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

// ---------------- Sub2API 价格同步与费用计算 ----------------
function dateKey(ts = Date.now()) { return dayHour(ts)[0] }
function normalizeModel(name) {
  const value = String(name || '').trim().toLowerCase()
  return value.includes('/') ? value.split('/').pop() : value
}
function validateBaseUrl(value) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Sub2API 地址只支持 http/https')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}
function normalizeBearerToken(value) {
  const raw = String(value || '').trim()
  return /^bearer\s+/i.test(raw) ? raw.replace(/^bearer\s+/i, '').trim() : raw
}
function sub2Message(json, status) {
  return String((json && (json.message || json.error || json.reason)) || ('HTTP ' + status))
}
async function sub2Request(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(15000) })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { throw new Error('Sub2API 返回了非 JSON 响应') }
  return { response, json, data: json && json.data !== undefined ? json.data : json }
}
function saveTokenPair(state, data) {
  if (!data || !data.access_token) throw new Error('Sub2API 登录响应缺少 access_token')
  state.config.apiKey = normalizeBearerToken(data.access_token)
  if (data.refresh_token) state.config.refreshToken = String(data.refresh_token)
  state.config.expiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0
  if (data.user) state.config.user = {
    id: data.user.id, email: data.user.email || '', username: data.user.username || data.user.name || '', role: data.user.role || '',
    balance: numberOrZero(data.user.balance), frozenBalance: numberOrZero(data.user.frozen_balance),
  }
  state.error = null
  writePricingState(state)
}
async function loginSub2API(baseUrlValue, email, password) {
  const baseUrl = validateBaseUrl(baseUrlValue)
  if (!email || !password) throw new Error('请输入 Sub2API 登录邮箱和密码')
  const got = await sub2Request(baseUrl, '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: String(email).trim(), password: String(password) }) })
  if (!got.response.ok || (got.json && got.json.code !== undefined && Number(got.json.code) !== 0)) throw new Error(sub2Message(got.json, got.response.status))
  if (got.data && got.data.requires_2fa) return { ok: true, requires2FA: true, tempToken: got.data.temp_token, userEmailMasked: got.data.user_email_masked || '' }
  const state = readPricingState()
  state.config.baseUrl = baseUrl
  saveTokenPair(state, got.data)
  return { ok: true, requires2FA: false, ...(await refreshSub2Account(state)) }
}
async function loginSub2API2FA(baseUrlValue, tempToken, totpCode) {
  const baseUrl = validateBaseUrl(baseUrlValue)
  if (!tempToken || !/^\d{6}$/.test(String(totpCode || '').trim())) throw new Error('请输入有效的 6 位动态验证码')
  const got = await sub2Request(baseUrl, '/api/v1/auth/login/2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temp_token: tempToken, totp_code: String(totpCode).trim() }) })
  if (!got.response.ok || (got.json && got.json.code !== undefined && Number(got.json.code) !== 0)) throw new Error(sub2Message(got.json, got.response.status))
  const state = readPricingState()
  state.config.baseUrl = baseUrl
  saveTokenPair(state, got.data)
  return { ok: true, requires2FA: false, ...(await refreshSub2Account(state)) }
}
async function refreshSub2APIToken(state) {
  if (!state.config.refreshToken) throw new Error('Sub2API 登录已失效，请重新登录')
  const baseUrl = validateBaseUrl(state.config.baseUrl)
  const got = await sub2Request(baseUrl, '/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: state.config.refreshToken }) })
  if (!got.response.ok || (got.json && got.json.code !== undefined && Number(got.json.code) !== 0)) {
    state.config.apiKey = ''; state.config.refreshToken = ''; state.config.expiresAt = 0; state.config.user = null
    writePricingState(state)
    throw new Error('Sub2API 会话续期失败，请重新登录：' + sub2Message(got.json, got.response.status))
  }
  saveTokenPair(state, got.data)
  return state.config.apiKey
}
async function validAccessToken(state) {
  const token = normalizeBearerToken(state.config.apiKey)
  if (state.config.refreshToken && (!token || (state.config.expiresAt && state.config.expiresAt <= Date.now() + 60_000))) return refreshSub2APIToken(state)
  return token
}
async function authenticatedSub2Request(state, path, options = {}) {
  const baseUrl = validateBaseUrl(state.config.baseUrl)
  let token = await validAccessToken(state)
  if (!token) throw new Error('请先登录 Sub2API')
  let got = await sub2Request(baseUrl, path, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token } })
  if (got.response.status === 401 && state.config.refreshToken) {
    token = await refreshSub2APIToken(state)
    got = await sub2Request(baseUrl, path, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token } })
  }
  return got
}
async function refreshSub2Account(state = readPricingState()) {
  if (!state.config.baseUrl) return publicPricingState(state)
  const baseUrl = validateBaseUrl(state.config.baseUrl)
  try {
    const settings = await sub2Request(baseUrl, '/api/v1/settings/public')
    if (settings.response.ok && settings.data) state.account.siteName = String(settings.data.site_name || 'Sub2API')
  } catch (e) { if (!state.account.siteName) state.account.siteName = 'Sub2API' }
  if (state.config.apiKey) {
    const me = await authenticatedSub2Request(state, '/api/v1/auth/me')
    if (!me.response.ok || (me.json && me.json.code !== undefined && Number(me.json.code) !== 0)) throw new Error(sub2Message(me.json, me.response.status))
    const user = me.data || {}
    state.account.user = {
      id: user.id, email: user.email || '', username: user.username || '', role: user.role || '',
      balance: numberOrZero(user.balance), frozenBalance: numberOrZero(user.frozen_balance), concurrency: numberOrZero(user.concurrency),
    }
    state.config.user = { ...state.config.user, ...state.account.user }
    const summary = await authenticatedSub2Request(state, '/api/v1/subscriptions/summary')
    state.account.subscriptions = summary.response.ok && summary.data
      ? { active_count: Number(summary.data.active_count) || 0, total_used_usd: numberOrZero(summary.data.total_used_usd), subscriptions: Array.isArray(summary.data.subscriptions) ? summary.data.subscriptions : [] }
      : { active_count: 0, total_used_usd: 0, subscriptions: [] }
  }
  state.account.fetchedAt = Date.now()
  writePricingState(state)
  return publicPricingState(state)
}
function numberOrZero(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
function choosePriceCandidate(candidates, groupId) {
  if (!candidates.length) return null
  const wanted = String(groupId || '')
  if (wanted) {
    const hit = candidates.find((x) => String(x.groupId) === wanted)
    if (hit) return hit
  }
  return candidates.slice().sort((a, b) => (a.input + a.output + a.cache) * a.multiplier - (b.input + b.output + b.cache) * b.multiplier)[0]
}
function parseSub2APIChannels(payload, groupId) {
  const channels = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.data) ? payload.data : [])
  const candidates = new Map()
  const groups = new Map()
  for (const channel of channels) {
    for (const section of (channel.platforms || [])) {
      const visibleGroups = Array.isArray(section.groups) ? section.groups : []
      for (const group of visibleGroups) {
        groups.set(String(group.id), { id: String(group.id), name: String(group.name || group.id), platform: String(group.platform || section.platform || ''), multiplier: numberOrZero(group.rate_multiplier) || 1 })
      }
      for (const model of (section.supported_models || [])) {
        if (!model || !model.name || !model.pricing || model.pricing.billing_mode === 'per_request') continue
        const pricing = model.pricing
        const key = normalizeModel(model.name)
        if (!key) continue
        let list = candidates.get(key)
        if (!list) { list = []; candidates.set(key, list) }
        const modelGroups = visibleGroups.length ? visibleGroups : [{ id: '', name: '默认', rate_multiplier: 1 }]
        for (const group of modelGroups) {
          list.push({
            name: String(model.name), platform: String(model.platform || section.platform || ''), channel: String(channel.name || ''),
            groupId: String(group.id || ''), groupName: String(group.name || '默认'), multiplier: numberOrZero(group.rate_multiplier) || 1,
            input: numberOrZero(pricing.input_price), output: numberOrZero(pricing.output_price), cache: numberOrZero(pricing.cache_read_price),
          })
        }
      }
    }
  }
  const models = {}
  for (const [key, list] of candidates) {
    const chosen = choosePriceCandidate(list, groupId)
    if (chosen) models[key] = { ...chosen, candidates: list }
  }
  return { models, groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}
async function syncPricing(force = false) {
  if (pricingSyncPromise) return pricingSyncPromise
  pricingSyncPromise = (async () => {
    const state = readPricingState()
    const today = dateKey()
    if (!force && state.snapshots[today]) return publicPricingState(state)
    if (!state.config.baseUrl || !state.config.apiKey) throw new Error('请先配置 Sub2API 地址和 Key')
    const baseUrl = validateBaseUrl(state.config.baseUrl)
    let token = await validAccessToken(state)
    try {
      const got = await authenticatedSub2Request(state, '/api/v1/channels/available')
      const { response, json } = got
      if (!response.ok || (json && json.code !== undefined && Number(json.code) !== 0)) {
        const message = String((json && (json.message || json.error)) || ('HTTP ' + response.status))
        if (response.status === 401 || /invalid token|unauthorized|token/i.test(message)) {
          if (token.startsWith('sk-')) throw new Error('这是有效的模型调用 Key（sk-），但价格接口只接受用户登录会话；请在设置页使用账号登录')
          throw new Error('Sub2API 认证失败，请在设置页重新登录账号')
        }
        throw new Error(message)
      }
      const parsed = parseSub2APIChannels(json, state.config.groupId)
      if (!Object.keys(parsed.models).length) throw new Error('Sub2API 未返回可用模型价格；请确认已开启“可用渠道”功能且 Key 有权访问')
      state.snapshots[today] = { date: today, fetchedAt: Date.now(), baseUrl, groupId: state.config.groupId || '', groups: parsed.groups, models: parsed.models }
      state.lastSync = { ok: true, at: Date.now(), date: today, models: Object.keys(parsed.models).length }
      state.error = null
      writePricingState(state)
      return publicPricingState(state)
    } catch (e) {
      state.lastSync = { ok: false, at: Date.now(), date: today }
      state.error = String((e && e.message) || e)
      writePricingState(state)
      throw e
    }
  })().finally(() => { pricingSyncPromise = null })
  return pricingSyncPromise
}
let autoSyncDay = ''
async function ensureDailyPricing() {
  const today = dateKey()
  if (autoSyncDay === today) return
  autoSyncDay = today
  const state = readPricingState()
  if (state.config.baseUrl && state.config.apiKey && !state.snapshots[today]) {
    try { await syncPricing(false) } catch (e) { /* 状态中已记录错误，概览仍可正常打开 */ }
  }
}
function snapshotForDate(snapshots, date) {
  const keys = Object.keys(snapshots || {}).sort()
  if (!keys.length) return null
  if (snapshots[date]) return snapshots[date]
  const older = keys.filter((key) => key <= date)
  return snapshots[older[older.length - 1] || keys[0]] || null
}
function newCostStat(label, key) {
  return { key, label, ti: 0, to: 0, tc: 0, inputCost: 0, outputCost: 0, cacheCost: 0, cost: 0, pricedTokens: 0, missingTokens: 0 }
}
function addCostStat(stat, tk, price) {
  stat.ti += tk.in; stat.to += tk.out; stat.tc += tk.cache
  const tokens = tk.in + tk.out + tk.cache
  if (!price) { stat.missingTokens += tokens; return }
  const multiplier = numberOrZero(price.multiplier) || 1
  stat.inputCost += tk.in * numberOrZero(price.input) * multiplier
  stat.outputCost += tk.out * numberOrZero(price.output) * multiplier
  stat.cacheCost += tk.cache * numberOrZero(price.cache) * multiplier
  stat.cost = stat.inputCost + stat.outputCost + stat.cacheCost
  stat.pricedTokens += tokens
}
export function buildCostStats() {
  const pricing = readPricingState()
  const total = newCostStat('全部', 'all')
  const projects = new Map()
  const models = new Map()
  const days = new Map()
  const matrix = new Map()
  for (const session of allParsed()) {
    const projectKey = String(session.cwd || 'unknown').toLowerCase()
    const projectName = projNameOf(session.cwd)
    for (const tk of session.tokens) {
      const date = dateKey(tk.t)
      const modelKey = normalizeModel(tk.model) || 'unknown'
      const modelName = tk.model || 'unknown'
      const snapshot = snapshotForDate(pricing.snapshots, date)
      const price = snapshot && snapshot.models && snapshot.models[modelKey]
      if (!projects.has(projectKey)) projects.set(projectKey, newCostStat(projectName, projectKey))
      if (!models.has(modelKey)) models.set(modelKey, newCostStat(modelName, modelKey))
      if (!days.has(date)) days.set(date, newCostStat(date, date))
      const matrixKey = projectKey + '\n' + modelKey
      if (!matrix.has(matrixKey)) matrix.set(matrixKey, { ...newCostStat(projectName + ' / ' + modelName, matrixKey), projectKey, project: projectName, modelKey, model: modelName })
      addCostStat(total, tk, price); addCostStat(projects.get(projectKey), tk, price); addCostStat(models.get(modelKey), tk, price); addCostStat(days.get(date), tk, price); addCostStat(matrix.get(matrixKey), tk, price)
    }
  }
  const sortCost = (a, b) => b.cost - a.cost || (b.ti + b.to + b.tc) - (a.ti + a.to + a.tc)
  return {
    ok: true, pricing: publicPricingState(pricing), total,
    projects: [...projects.values()].sort(sortCost), models: [...models.values()].sort(sortCost),
    days: [...days.values()].sort((a, b) => b.key.localeCompare(a.key)), matrix: [...matrix.values()].sort(sortCost),
  }
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
  const bySession = {}
  const sessions = []
  for (const p of parsed) {
    const key = String(p.cwd || 'unknown').toLowerCase()
    const name = projNameOf(p.cwd)
    let proj = byProject.get(key)
    if (!proj) { proj = { key, name, path: p.cwd || '', sessions: 0, days: new Map() }; byProject.set(key, proj) }
    proj.sessions++
    const sessionDays = new Map()
    let lastAt = p.createdAt || 0
    for (const ev of p.events) {
      addEvent(allDays, ev.t, ev.k)
      addEvent(proj.days, ev.t, ev.k)
      addEvent(sessionDays, ev.t, ev.k)
      if (ev.t > lastAt) lastAt = ev.t
    }
    for (const tk of p.tokens) {
      addToken(allDays, tk)
      addToken(proj.days, tk)
      addToken(sessionDays, tk)
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
    bySession[p.id] = { id: p.id, projectKey: key, project: name, title: p.title || '', days: daysToObj(sessionDays) }
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
    bySession,
  }
}

export function buildDay(date, projectKey, sessionId) {
  const events = []
  const tokens = []
  for (const p of allParsed()) {
    const key = String(p.cwd || 'unknown').toLowerCase()
    if (projectKey && key !== projectKey) continue
    if (sessionId && p.id !== sessionId) continue
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
  return { ok: true, date, project: projectKey || 'all', session: sessionId || 'all', events: events.slice(0, 8000), tokens: tokens.slice(0, 8000) }
}

// ---------------- 路由 ----------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch (e) { throw new Error('请求体需要是 JSON') }
}

export function apply(ctx) {
  // 插件随 DSH 启动时尝试当天首次同步；未配置或同步失败不会影响插件加载。
  void ensureDailyPricing()
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
          await ensureDailyPricing()
          return sendJson(res, 200, buildOverview())
        }
        if (url.pathname === API + '/day') {
          const date = String(url.searchParams.get('date') || '').trim()
          const project = String(url.searchParams.get('project') || '').trim()
          const session = String(url.searchParams.get('session') || '').trim()
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { ok: false, error: 'date 参数需要 YYYY-MM-DD' })
          if (project && !/^[a-z0-9_\\:.\-]+$/i.test(project)) return sendJson(res, 400, { ok: false, error: 'project 参数不合法' })
          if (session && !/^session-[a-z0-9-]+$/i.test(session)) return sendJson(res, 400, { ok: false, error: 'session 参数不合法' })
          return sendJson(res, 200, buildDay(date, project || null, session || null))
        }
        if (url.pathname === API + '/pricing/config') {
          if (req.method === 'GET') return sendJson(res, 200, { ok: true, ...publicPricingState(readPricingState()) })
          if (req.method !== 'PUT') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const body = await readJsonBody(req)
          const state = readPricingState()
          const baseUrl = body.baseUrl ? validateBaseUrl(body.baseUrl) : ''
          const apiKey = String(body.apiKey || '').trim()
          state.config.baseUrl = baseUrl
          if (apiKey) { state.config.apiKey = apiKey; state.config.refreshToken = ''; state.config.expiresAt = 0; state.config.user = null }
          if (body.clearKey === true) { state.config.apiKey = ''; state.config.refreshToken = ''; state.config.expiresAt = 0; state.config.user = null; state.account.user = null; state.account.subscriptions = emptyPricingState().account.subscriptions }
          state.config.groupId = String(body.groupId || '').trim()
          state.error = null
          writePricingState(state)
          autoSyncDay = ''
          return sendJson(res, 200, { ok: true, ...publicPricingState(state) })
        }
        if (url.pathname === API + '/ui/config') {
          if (req.method === 'GET') return sendJson(res, 200, { ok: true, ...readUiState() })
          if (req.method !== 'PUT') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const body = await readJsonBody(req)
          return sendJson(res, 200, { ok: true, ...writeUiState(body || {}) })
        }
        if (url.pathname === API + '/pricing/auth/login') {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const body = await readJsonBody(req)
          return sendJson(res, 200, await loginSub2API(body.baseUrl, body.email, body.password))
        }
        if (url.pathname === API + '/pricing/auth/login-2fa') {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const body = await readJsonBody(req)
          return sendJson(res, 200, await loginSub2API2FA(body.baseUrl, body.tempToken, body.totpCode))
        }
        if (url.pathname === API + '/pricing/auth/logout') {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const state = readPricingState()
          const refreshToken = state.config.refreshToken
          if (refreshToken && state.config.baseUrl) {
            try { await sub2Request(validateBaseUrl(state.config.baseUrl), '/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) }) } catch (e) { /* 本地仍需退出 */ }
          }
          state.config.apiKey = ''; state.config.refreshToken = ''; state.config.expiresAt = 0; state.config.user = null; state.error = null
          state.account.user = null; state.account.subscriptions = emptyPricingState().account.subscriptions
          writePricingState(state)
          return sendJson(res, 200, { ok: true, ...publicPricingState(state) })
        }
        if (url.pathname === API + '/pricing/account') {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return sendJson(res, 200, { ok: true, ...(await refreshSub2Account()) })
        }
        if (url.pathname === API + '/pricing/state' || url.pathname === API + '/costs') {
          await ensureDailyPricing()
          return sendJson(res, 200, buildCostStats())
        }
        if (url.pathname === API + '/pricing/sync') {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const state = await syncPricing(true)
          return sendJson(res, 200, { ok: true, ...state })
        }
        return sendJson(res, 404, { ok: false, error: 'unknown api' })
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    },
  })
  ctx.on('dispose', () => disposer())
}
