window.__ModuleLoader__.load({ id: "dsh-activity-tracker", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * dsh-activity-tracker（浏览器端）v1.0.0
 *
 * - 侧栏「新会话」下方克隆「📊 活动统计」按钮（MutationObserver 自愈）
 * - shell.overlay 浮层：token 概览卡、GitHub 式活跃热力图、
 *   选中日的 24 小时彩色分布（按活动类型分色）、事件时间线、每日汇总表
 * - 过滤：分项目（全部/单项目）、分日期（热力图/表格点击、前后翻页）、分小时（图表）
 * - 数据来自宿主 /dsh-activity/api（解析 ~/.dsh/sessions 的 session.jsonl.zstd）
 */
const TAG = '[dsat]'

let React = null
try { React = require('react') } catch (e) { React = null }

// ---------------- 开关 store ----------------
let isOpen = false
const openListeners = new Set()
const store = {
  isOpen: function () { return isOpen },
  open: function () { isOpen = true; openListeners.forEach(function (l) { l() }) },
  close: function () { isOpen = false; openListeners.forEach(function (l) { l() }) },
  subscribe: function (l) { openListeners.add(l); return function () { openListeners.delete(l) } },
}

// ---------------- 宿主 API ----------------
const HOST_API = '/dsh-activity/api'
async function apiFetch(path, options) {
  try {
    const opts = options || {}
    const headers = Object.assign({ 'X-DSH-Activity': '1' }, opts.headers || {})
    const r = await window.fetch(path, Object.assign({}, opts, { headers: headers }))
    let data = null
    try { data = await r.json() } catch (e) { data = null }
    return { status: r.status, data: data }
  } catch (e) {
    return { status: 0, data: { ok: false, error: '无法连接宿主机接口（dsh 服务未响应）' } }
  }
}

// ---------------- 活动类型（颜色图例） ----------------
const KINDS = {
  u: { label: '用户输入', color: '#2ea043' },
  e: { label: '代码编辑', color: '#2f6feb' },
  c: { label: '命令执行', color: '#f0883e' },
  r: { label: '检索阅读', color: '#1f9eb7' },
  o: { label: '其他工具', color: '#8b5cf6' },
}
const KIND_ORDER = ['u', 'e', 'c', 'r', 'o']

// ---------------- 工具函数 ----------------
function p2(n) { return n < 10 ? '0' + n : String(n) }
function dateKeyOf(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function todayKey() { return dateKeyOf(new Date()) }
function addDays(key, n) {
  const d = new Date(key + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return dateKeyOf(d)
}
function hhmmss(t) { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) }
function hhmm(t) { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) }
function fmtK(n) {
  n = Number(n) || 0
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}
function wkLabel(key) {
  // 2026-08-16 → 8/16
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  return m ? Number(m[2]) + '/' + Number(m[3]) : key
}
function eventsOf(day) {
  if (!day) return 0
  return (day.u || 0) + (day.e || 0) + (day.c || 0) + (day.r || 0) + (day.o || 0)
}
function tokensOf(day) {
  if (!day) return 0
  return (day.ti || 0) + (day.to || 0) + (day.tc || 0)
}

// ---------------- 侧栏按钮（克隆官方「新会话」按钮） ----------------
let obs = null
let installTimer = 0
function findNewSessionButton() {
  if (typeof document === 'undefined') return null
  const nodes = document.querySelectorAll('button[class*="newSession"]')
  for (let i = 0; i < nodes.length; i++) {
    if (String(nodes[i].className).indexOf('newSessionLabel') === -1) return nodes[i]
  }
  return null
}
function installSidebarButton() {
  if (typeof document === 'undefined') return
  const target = findNewSessionButton()
  if (!target || !target.parentElement) return
  if (target.parentElement.querySelector('.dsat-sidebar-entry')) return
  const btn = target.cloneNode(true)
  btn.className = String(target.className) + ' dsat-sidebar-entry'
  btn.setAttribute('aria-label', '活动统计')
  btn.innerHTML = ''
  const icon = document.createElement('span')
  icon.className = 'dsat-sidebar-icon'
  icon.textContent = '\uD83D\uDCCA'
  btn.appendChild(icon)
  const label = document.createElement('span')
  label.className = 'dsat-sidebar-label'
  label.textContent = '活动统计'
  btn.appendChild(label)
  btn.addEventListener('click', function (ev) {
    ev.preventDefault()
    ev.stopPropagation()
    store.open()
  })
  target.insertAdjacentElement('afterend', btn)
}
function watchSidebar() {
  if (typeof document === 'undefined' || obs) return
  obs = new MutationObserver(function () {
    window.clearTimeout(installTimer)
    installTimer = window.setTimeout(installSidebarButton, 300)
  })
  obs.observe(document.body, { childList: true, subtree: true })
}
function removeSidebarButton() {
  if (typeof document === 'undefined') return
  const nodes = document.querySelectorAll('.dsat-sidebar-entry')
  for (let i = 0; i < nodes.length; i++) nodes[i].remove()
}

// ---------------- React 界面 ----------------
if (React !== null) {
  function el(type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    return React.createElement.apply(null, [type, props].concat(children))
  }

  function useOpen() {
    const [snap, setSnap] = React.useState(store.isOpen())
    React.useEffect(function () {
      return store.subscribe(function () { setSnap(store.isOpen()) })
    }, [])
    return snap
  }

  // ---- 概览卡片 ----
  function SummaryCards(props) {
    const days = props.days          // 过滤后的 days 对象（含 scope 过滤）
    const sessions = props.sessions  // 过滤后的会话数
    let ti = 0, to = 0, tc = 0, ev = 0
    for (const k of Object.keys(days)) {
      const d = days[k]
      ti += d.ti || 0; to += d.to || 0; tc += d.tc || 0
      ev += eventsOf(d)
    }
    const cards = [
      { label: '输入 token', value: fmtK(ti), color: '#2f6feb', title: '未命中缓存的输入（按 API 计费的增量之和）' },
      { label: '输出 token', value: fmtK(to), color: '#2ea043', title: '模型输出（含思考）' },
      { label: '缓存读 token', value: fmtK(tc), color: '#8b949e', title: '命中上下文缓存的部分' },
      { label: '活动事件', value: fmtK(ev), color: '#f0883e', title: '用户输入 + 工具调用次数' },
      { label: '会话数', value: String(sessions), color: '#8b5cf6', title: '时间范围内有活动的会话' },
    ]
    return el('div', { className: 'dsat-cards' },
      cards.map(function (c) {
        return el('div', { className: 'dsat-card', key: c.label, title: c.title },
          el('div', { className: 'dsat-card-val', style: { color: c.color } }, c.value),
          el('div', { className: 'dsat-card-label' }, c.label))
      }))
  }

  // ---- 热力图（近 26 周） ----
  function Heatmap(props) {
    const days = props.days || {}
    const selDate = props.selDate
    const onPick = props.onPick
    const WEEKS = 26
    const today = todayKey()
    const end = new Date(today + 'T12:00:00')
    // 结束对齐到周日，起点为 (WEEKS*7-1) 天前的周一
    const endOffset = 6 - (end.getDay() + 6) % 7
    const last = addDays(today, endOffset)
    const first = addDays(last, -(WEEKS * 7 - 1))
    const levelOf = function (key) {
      const d = days[key]
      if (!d) return 0
      const total = tokensOf(d)
      if (total <= 0 && eventsOf(d) > 0) return 1
      if (total >= 2e6) return 4
      if (total >= 5e5) return 3
      if (total >= 5e4) return 2
      if (total > 0) return 1
      return 0
    }
    const weeks = []
    let cursor = first
    for (let w = 0; w < WEEKS; w++) {
      const col = []
      for (let dow = 0; dow < 7; dow++) {
        const key = cursor
        const d = days[key]
        const lvl = levelOf(key)
        const tip = key + (d ? ' · 事件 ' + eventsOf(d) + ' · 入' + fmtK(d.ti) + ' 出' + fmtK(d.to) + ' 缓存' + fmtK(d.tc) : ' · 无活动')
        col.push(el('div', {
          key: key,
          className: 'dsat-cell dsat-lv' + lvl + (key === selDate ? ' dsat-cell-sel' : '') + (key > today ? ' dsat-cell-future' : ''),
          title: tip,
          onClick: function () { if (onPick && key <= today) onPick(key) },
        }))
        cursor = addDays(cursor, 1)
      }
      weeks.push(el('div', { className: 'dsat-week', key: w }, col))
    }
    const monthLabels = []
    let lastMonth = -1
    for (let w = 0; w < WEEKS; w++) {
      const key = addDays(first, w * 7)
      const m = Number(key.slice(5, 7))
      if (m !== lastMonth && (w === 0 || Number(key.slice(8, 10)) <= 7)) {
        monthLabels.push(el('div', { className: 'dsat-month-label', key: w }, m + '月'))
        lastMonth = m
      } else {
        monthLabels.push(el('div', { className: 'dsat-month-label', key: w }, ''))
      }
    }
    return el('div', { className: 'dsat-heat-wrap' },
      el('div', { className: 'dsat-section-label' }, '活跃热力图（近 ' + WEEKS + ' 周，颜色越深 token 消耗越多，点击看当日明细）'),
      el('div', { className: 'dsat-heat' },
        el('div', { className: 'dsat-heat-left' },
          el('div', { className: 'dsat-dow' }, ''), el('div', { className: 'dsat-dow' }, '一'),
          el('div', { className: 'dsat-dow' }, ''), el('div', { className: 'dsat-dow' }, '三'),
          el('div', { className: 'dsat-dow' }, ''), el('div', { className: 'dsat-dow' }, '五'),
          el('div', { className: 'dsat-dow' }, ''),
        ),
        el('div', { className: 'dsat-heat-body' },
          el('div', { className: 'dsat-months' }, monthLabels),
          el('div', { className: 'dsat-weeks' }, weeks),
          el('div', { className: 'dsat-heat-legend' },
            '少 ', el('span', { className: 'dsat-cell dsat-lv0' }), el('span', { className: 'dsat-cell dsat-lv1' }),
            el('span', { className: 'dsat-cell dsat-lv2' }), el('span', { className: 'dsat-cell dsat-lv3' }),
            el('span', { className: 'dsat-cell dsat-lv4' }), ' 多'),
        ),
      ))
  }

  // ---- 24 小时分布（按类型分色的堆叠柱） ----
  function HourChart(props) {
    const hours = props.hours || []
    let max = 0
    const counts = []
    for (let h = 0; h < 24; h++) {
      const d = hours[h] || {}
      const c = { u: d.u || 0, e: d.e || 0, c: d.c || 0, r: d.r || 0, o: d.o || 0 }
      c.total = c.u + c.e + c.c + c.r + c.o
      counts.push(c)
      if (c.total > max) max = c.total
    }
    const H = 96
    return el('div', { className: 'dsat-hourchart' },
      counts.map(function (c, h) {
        const segs = []
        if (max > 0 && c.total > 0) {
          const colH = (c.total / max) * H
          for (let i = KIND_ORDER.length - 1; i >= 0; i--) {
            const k = KIND_ORDER[i]
            if (!c[k]) continue
            segs.push(el('div', {
              key: k, className: 'dsat-hseg',
              style: { height: Math.max(2, Math.round((c[k] / c.total) * colH)) + 'px', background: KINDS[k].color },
            }))
          }
        }
        const tip = h + '时 · ' + KIND_ORDER.map(function (k) { return KINDS[k].label + ' ' + c[k] }).join(' · ')
        return el('div', { className: 'dsat-hcol' + (h % 6 === 0 ? ' dsat-hcol-lab' : ''), key: h, title: tip },
          el('div', { className: 'dsat-hbar' }, segs),
          el('div', { className: 'dsat-hlab' }, h % 6 === 0 ? h : ''),
        )
      }))
  }

  // ---- 24 小时 token 消耗 ----
  function TokenHourChart(props) {
    const hours = props.hours || []
    let max = 0
    const vals = []
    for (let h = 0; h < 24; h++) {
      const d = hours[h] || {}
      const v = (d.ti || 0) + (d.to || 0) + (d.tc || 0)
      vals.push({ v: v, d: d })
      if (v > max) max = v
    }
    const H = 56
    return el('div', { className: 'dsat-hourchart' },
      vals.map(function (x, h) {
        const bar = max > 0 && x.v > 0
          ? el('div', { className: 'dsat-tbar', style: { height: Math.max(2, Math.round((x.v / max) * H)) + 'px' } })
          : el('div', { className: 'dsat-tbar dsat-tbar-empty', style: { height: '2px' } })
        const tip = h + '时 · 入' + fmtK(x.d.ti) + ' · 出' + fmtK(x.d.to) + ' · 缓存' + fmtK(x.d.tc)
        return el('div', { className: 'dsat-hcol' + (h % 6 === 0 ? ' dsat-hcol-lab' : ''), key: h, title: tip },
          el('div', { className: 'dsat-hbar dsat-thbar' }, bar),
          el('div', { className: 'dsat-hlab' }, h % 6 === 0 ? h : ''),
        )
      }))
  }

  // ---- 当日事件时间线 ----
  function EventList(props) {
    const dayData = props.dayData
    const limit = props.limit
    const rows = []
    if (dayData) {
      for (const ev of dayData.events) rows.push({ t: ev.t, kind: ev.k, ev: ev })
      for (const tk of dayData.tokens) rows.push({ t: tk.t, kind: 't', tk: tk })
      rows.sort(function (a, b) { return a.t - b.t })
    }
    const shown = limit > 0 ? rows.slice(0, limit) : rows
    return el('div', { className: 'dsat-events' },
      shown.map(function (row, i) {
        if (row.kind === 't') {
          const tk = row.tk
          return el('div', { className: 'dsat-ev dsat-ev-token', key: 't' + row.t + '-' + i },
            el('span', { className: 'dsat-ev-time' }, hhmmss(row.t)),
            el('span', { className: 'dsat-ev-dot dsat-dot-token' }, '\uD83E\uDE99'),
            el('span', { className: 'dsat-ev-label' },
              '入 +' + fmtK(tk.in) + ' · 出 +' + fmtK(tk.out) + ' · 缓存读 +' + fmtK(tk.cache)),
            tk.model ? el('span', { className: 'dsat-pill' }, tk.model) : null,
            tk.p ? el('span', { className: 'dsat-ev-proj' }, tk.p) : null,
          )
        }
        const ev = row.ev
        const meta = KINDS[ev.k] || KINDS.o
        return el('div', { className: 'dsat-ev', key: 'e' + row.t + '-' + i, title: ev.s ? '会话 ' + ev.s : '' },
          el('span', { className: 'dsat-ev-time' }, hhmmss(row.t)),
          el('span', { className: 'dsat-ev-dot', style: { background: meta.color } }),
          el('span', { className: 'dsat-ev-kind', style: { color: meta.color } }, meta.label),
          ev.tool ? el('span', { className: 'dsat-pill dsat-pill-tool' }, ev.tool) : null,
          ev.label ? el('span', { className: 'dsat-ev-label' }, ev.label) : null,
          ev.p ? el('span', { className: 'dsat-ev-proj' }, ev.p) : null,
        )
      }),
      rows.length > shown.length
        ? el('button', { className: 'dsat-more', onClick: props.onMore }, '显示全部 ' + rows.length + ' 条 ▾')
        : null,
    )
  }

  // ---- 每日汇总表 ----
  function DailyTable(props) {
    const days = props.days || {}
    const keys = Object.keys(days).sort().reverse().slice(0, 31)
    if (!keys.length) return null
    let tu = 0, te = 0, tc2 = 0, tr = 0, to2 = 0, tti = 0, tto = 0, ttc = 0
    const rows = keys.map(function (k) {
      const d = days[k]
      tu += d.u || 0; te += d.e || 0; tc2 += d.c || 0; tr += d.r || 0; to2 += d.o || 0
      tti += d.ti || 0; tto += d.to || 0; ttc += d.tc || 0
      return el('tr', {
        key: k,
        className: 'dsat-tr' + (k === props.selDate ? ' dsat-tr-sel' : ''),
        onClick: function () { if (props.onPick) props.onPick(k) },
      },
        el('td', { className: 'dsat-td dsat-td-date' }, wkLabel(k)),
        el('td', { className: 'dsat-td', style: { color: KINDS.u.color } }, d.u || 0),
        el('td', { className: 'dsat-td', style: { color: KINDS.e.color } }, d.e || 0),
        el('td', { className: 'dsat-td', style: { color: KINDS.c.color } }, d.c || 0),
        el('td', { className: 'dsat-td', style: { color: KINDS.r.color } }, d.r || 0),
        el('td', { className: 'dsat-td', style: { color: KINDS.o.color } }, d.o || 0),
        el('td', { className: 'dsat-td' }, fmtK(d.ti || 0)),
        el('td', { className: 'dsat-td' }, fmtK(d.to || 0)),
        el('td', { className: 'dsat-td dsat-td-muted' }, fmtK(d.tc || 0)),
      )
    })
    return el('div', { className: 'dsat-table-wrap' },
      el('div', { className: 'dsat-section-label' }, '每日汇总（近 31 个活跃日，点击行查看当日明细）'),
      el('table', { className: 'dsat-table' },
        el('thead', null, el('tr', null,
          el('th', { className: 'dsat-th' }, '日期'),
          el('th', { className: 'dsat-th', title: '用户输入' }, '输入'),
          el('th', { className: 'dsat-th', title: '代码编辑（write/edit 等）' }, '编辑'),
          el('th', { className: 'dsat-th', title: '命令执行（pwsh/bash 等）' }, '命令'),
          el('th', { className: 'dsat-th', title: '检索阅读（read/grep/glob）' }, '检索'),
          el('th', { className: 'dsat-th', title: '其他工具' }, '其他'),
          el('th', { className: 'dsat-th', title: '未缓存输入 token' }, '入tok'),
          el('th', { className: 'dsat-th', title: '输出 token' }, '出tok'),
          el('th', { className: 'dsat-th', title: '缓存读 token' }, '缓存读'),
        )),
        el('tbody', null, rows,
          el('tr', { className: 'dsat-tr dsat-tr-total', key: '__total' },
            el('td', { className: 'dsat-td dsat-td-date' }, '合计'),
            el('td', { className: 'dsat-td' }, tu), el('td', { className: 'dsat-td' }, te),
            el('td', { className: 'dsat-td' }, tc2), el('td', { className: 'dsat-td' }, tr),
            el('td', { className: 'dsat-td' }, to2),
            el('td', { className: 'dsat-td' }, fmtK(tti)), el('td', { className: 'dsat-td' }, fmtK(tto)),
            el('td', { className: 'dsat-td dsat-td-muted' }, fmtK(ttc)),
          ))))
  }

  function fmtMoney(n) {
    n = Number(n) || 0
    return '$' + n.toFixed(n < 0.01 ? 6 : 4)
  }

  function CostTable(props) {
    const rows = props.rows || []
    if (!rows.length) return el('div', { className: 'dsat-status' }, '暂无 Token 数据')
    return el('div', { className: 'dsat-table-wrap dsat-cost-table-wrap' },
      el('div', { className: 'dsat-section-label' }, props.title),
      el('table', { className: 'dsat-table dsat-cost-table' },
        el('thead', null, el('tr', null,
          el('th', { className: 'dsat-th dsat-th-left' }, props.firstLabel || '项目/模型'),
          el('th', { className: 'dsat-th' }, '输入 tok'),
          el('th', { className: 'dsat-th' }, '输出 tok'),
          el('th', { className: 'dsat-th' }, '缓存 tok'),
          el('th', { className: 'dsat-th' }, '费用 USD'),
          el('th', { className: 'dsat-th' }, '未计价 tok'))),
        el('tbody', null, rows.slice(0, props.limit || 100).map(function (row) {
          return el('tr', { className: 'dsat-tr', key: row.key },
            el('td', { className: 'dsat-td dsat-td-date dsat-cost-name', title: row.key }, row.label),
            el('td', { className: 'dsat-td' }, fmtK(row.ti)),
            el('td', { className: 'dsat-td' }, fmtK(row.to)),
            el('td', { className: 'dsat-td dsat-td-muted' }, fmtK(row.tc)),
            el('td', { className: 'dsat-td dsat-cost-value' }, fmtMoney(row.cost)),
            el('td', { className: 'dsat-td dsat-td-muted' }, fmtK(row.missingTokens)))
        }))))
  }

  function CostPanel(props) {
    const [costs, setCosts] = React.useState(null)
    const [error, setError] = React.useState(null)
    const [loading, setLoading] = React.useState(true)
    function load() {
      setLoading(true)
      apiFetch(HOST_API + '/costs').then(function (got) {
        if (got.data && got.data.ok) { setCosts(got.data); setError(null) } else setError((got.data && got.data.error) || ('HTTP ' + got.status))
        setLoading(false)
      })
    }
    React.useEffect(load, [props.refreshKey])
    if (loading) return el('div', { className: 'dsat-body' }, el('div', { className: 'dsat-status' }, '正在计算费用…'))
    if (error) return el('div', { className: 'dsat-body' }, el('div', { className: 'dsat-error' }, '⚠ ' + error))
    const total = costs.total || {}
    const pricing = costs.pricing || {}
    const snapshots = pricing.snapshots || {}
    const snapshotCount = Object.keys(snapshots).length
    return el('div', { className: 'dsat-body' },
      el('div', { className: 'dsat-cost-note' },
        pricing.config && pricing.config.configured
          ? '价格来源：Sub2API · 已保存 ' + snapshotCount + ' 天历史快照'
          : '尚未配置 Sub2API 价格；请到「Sub2API 设置」填写地址和 Key'),
      el('div', { className: 'dsat-cards' },
        el('div', { className: 'dsat-card' }, el('div', { className: 'dsat-card-val dsat-cost-value' }, fmtMoney(total.cost)), el('div', { className: 'dsat-card-label' }, '已计算费用（USD）')),
        el('div', { className: 'dsat-card' }, el('div', { className: 'dsat-card-val' }, fmtK(total.pricedTokens)), el('div', { className: 'dsat-card-label' }, '已匹配价格 Token')),
        el('div', { className: 'dsat-card' }, el('div', { className: 'dsat-card-val' }, fmtK(total.missingTokens)), el('div', { className: 'dsat-card-label' }, '缺少价格 Token'))),
      el(CostTable, { title: '按项目统计', rows: costs.projects, firstLabel: '项目' }),
      el(CostTable, { title: '按模型统计', rows: costs.models, firstLabel: '模型' }),
      el(CostTable, { title: '项目 × 模型统计', rows: costs.matrix, firstLabel: '项目 / 模型' }),
      el(CostTable, { title: '每日费用历史（按当天或最近历史价格快照）', rows: costs.days, firstLabel: '日期' }),
      el('div', { className: 'dsat-footer' }, '费用公式：输入 tok × 输入单价 + 输出 tok × 输出单价 + 缓存读 tok × 缓存读单价，再乘 Sub2API 分组倍率。单价按每 Token 计。'))
  }

  function PricingSettings(props) {
    const [baseUrl, setBaseUrl] = React.useState((props.config && props.config.baseUrl) || '')
    const [apiKey, setApiKey] = React.useState('')
    const [email, setEmail] = React.useState('')
    const [password, setPassword] = React.useState('')
    const [totpCode, setTotpCode] = React.useState('')
    const [twoFA, setTwoFA] = React.useState(null)
    const [groupId, setGroupId] = React.useState((props.config && props.config.groupId) || '')
    const [message, setMessage] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    function login() {
      setBusy(true); setMessage(null)
      apiFetch(HOST_API + '/pricing/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl, email: email, password: password }) }).then(function (got) {
        setBusy(false); setPassword('')
        if (!got.data || !got.data.ok) { setMessage({ error: (got.data && got.data.error) || ('HTTP ' + got.status) }); return }
        if (got.data.requires2FA) { setTwoFA({ tempToken: got.data.tempToken, masked: got.data.userEmailMasked }); setMessage({ text: '账号需要二次验证，请输入验证器中的 6 位动态码。' }); return }
        setTwoFA(null); setMessage({ text: '登录成功，Token 将在到期前自动续期；正在同步价格…' }); if (props.onSaved) props.onSaved(got.data)
        apiFetch(HOST_API + '/pricing/sync', { method: 'POST' }).then(function (synced) {
          if (synced.data && synced.data.ok) { setMessage({ text: '登录成功，已同步 ' + ((synced.data.lastSync && synced.data.lastSync.models) || 0) + ' 个模型价格。' }); if (props.onSaved) props.onSaved(synced.data) }
          else setMessage({ error: (synced.data && synced.data.error) || ('价格同步失败：HTTP ' + synced.status) })
        })
      })
    }
    function login2FA() {
      setBusy(true); setMessage(null)
      apiFetch(HOST_API + '/pricing/auth/login-2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl, tempToken: twoFA && twoFA.tempToken, totpCode: totpCode }) }).then(function (got) {
        setBusy(false); setTotpCode('')
        if (!got.data || !got.data.ok) { setMessage({ error: (got.data && got.data.error) || ('HTTP ' + got.status) }); return }
        setTwoFA(null); setMessage({ text: '二次验证成功，已登录并启用自动续期；正在同步价格…' }); if (props.onSaved) props.onSaved(got.data)
        apiFetch(HOST_API + '/pricing/sync', { method: 'POST' }).then(function (synced) {
          if (synced.data && synced.data.ok) { setMessage({ text: '登录成功，已同步 ' + ((synced.data.lastSync && synced.data.lastSync.models) || 0) + ' 个模型价格。' }); if (props.onSaved) props.onSaved(synced.data) }
          else setMessage({ error: (synced.data && synced.data.error) || ('价格同步失败：HTTP ' + synced.status) })
        })
      })
    }
    function logout() {
      setBusy(true); setMessage(null)
      apiFetch(HOST_API + '/pricing/auth/logout', { method: 'POST' }).then(function (got) {
        setBusy(false); setTwoFA(null)
        if (!got.data || !got.data.ok) { setMessage({ error: (got.data && got.data.error) || ('HTTP ' + got.status) }); return }
        setMessage({ text: '已退出 Sub2API 登录。' }); if (props.onSaved) props.onSaved(got.data)
      })
    }
    function save(andSync) {
      setBusy(true); setMessage(null)
      apiFetch(HOST_API + '/pricing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl, apiKey: apiKey, groupId: groupId }) }).then(function (got) {
        if (!got.data || !got.data.ok) { setMessage({ error: (got.data && got.data.error) || ('HTTP ' + got.status) }); setBusy(false); return }
        setApiKey('')
        if (!andSync) { setMessage({ text: '配置已保存。每天第一次打开活动统计时会自动同步。' }); setBusy(false); if (props.onSaved) props.onSaved(got.data) ; return }
        apiFetch(HOST_API + '/pricing/sync', { method: 'POST' }).then(function (synced) {
          setBusy(false)
          if (synced.data && synced.data.ok) { setMessage({ text: '已保存并同步 ' + ((synced.data.lastSync && synced.data.lastSync.models) || 0) + ' 个模型。' }); if (props.onSaved) props.onSaved(synced.data) }
          else setMessage({ error: (synced.data && synced.data.error) || ('HTTP ' + synced.status) })
        })
      })
    }
    return el('div', { className: 'dsat-body' },
      el('div', { className: 'dsat-section-label' }, 'Sub2API 价格设置'),
      el('div', { className: 'dsat-settings' },
        el('label', { className: 'dsat-field' }, 'API 地址', el('input', { className: 'dsat-input', value: baseUrl, placeholder: 'https://sub2api.example.com', onChange: function (e) { setBaseUrl(e.target.value) } })),
        props.config && props.config.loggedIn
          ? el('div', { className: 'dsat-auth-card' },
              el('div', { className: 'dsat-success' }, '✓ 已登录：' + (((props.config.user || {}).email) || ((props.config.user || {}).username) || 'Sub2API 用户')),
              props.config.expiresAt ? el('div', { className: 'dsat-settings-help' }, 'Access Token 到期：' + new Date(props.config.expiresAt).toLocaleString() + '；插件会使用 Refresh Token 自动续期。') : null,
              el('button', { className: 'dsat-mini', disabled: busy, onClick: logout }, '退出登录'))
          : el('div', { className: 'dsat-auth-card' },
              el('div', { className: 'dsat-section-label' }, '账号登录（推荐）'),
              el('label', { className: 'dsat-field' }, '邮箱', el('input', { className: 'dsat-input', type: 'email', value: email, autoComplete: 'username', placeholder: 'Sub2API 登录邮箱', onChange: function (e) { setEmail(e.target.value) } })),
              el('label', { className: 'dsat-field' }, '密码', el('input', { className: 'dsat-input', type: 'password', value: password, autoComplete: 'current-password', placeholder: '密码仅用于本次登录，不会保存', onChange: function (e) { setPassword(e.target.value) } })),
              twoFA ? el('label', { className: 'dsat-field' }, '动态验证码' + (twoFA.masked ? '（' + twoFA.masked + '）' : ''), el('input', { className: 'dsat-input', inputMode: 'numeric', maxLength: 6, value: totpCode, placeholder: '6 位 TOTP 验证码', onChange: function (e) { setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6)) } })) : null,
              el('button', { className: 'dsat-mini dsat-primary', disabled: busy || !baseUrl || (twoFA ? totpCode.length !== 6 : !email || !password), onClick: twoFA ? login2FA : login }, busy ? '处理中…' : (twoFA ? '完成二次验证' : '登录并自动同步'))),
        el('details', { className: 'dsat-auth-advanced' },
          el('summary', null, '高级：手动填写用户 JWT'),
          el('label', { className: 'dsat-field' }, 'Sub2API 用户 JWT', el('input', { className: 'dsat-input', type: 'password', value: apiKey, placeholder: props.config && props.config.configured ? '已保存（留空保持不变）' : '粘贴 access_token/JWT（不是 sk- Key）', onChange: function (e) { setApiKey(e.target.value) } }))),
        el('label', { className: 'dsat-field' }, '默认分组 ID（可选）', el('input', { className: 'dsat-input', value: groupId, placeholder: '留空自动选择价格最低的可用分组', onChange: function (e) { setGroupId(e.target.value) } }))),
      el('div', { className: 'dsat-settings-help' }, '推荐使用账号登录：密码只用于本次登录且不会落盘；宿主机只保存 access_token、refresh_token 和脱敏用户信息，并会自动续期。网站生成的 sk- Key 只能调用模型，不能读取渠道价格。'),
      el('div', { className: 'dsat-button-row' },
        el('button', { className: 'dsat-mini', disabled: busy, onClick: function () { save(false) } }, busy ? '保存中…' : '保存配置'),
        el('button', { className: 'dsat-mini dsat-primary', disabled: busy, onClick: function () { save(true) } }, '保存并立即同步')),
      message ? el('div', { className: message.error ? 'dsat-error' : 'dsat-success' }, message.error || message.text) : null,
      props.config && props.config.lastSync ? el('div', { className: 'dsat-footer' }, '最近同步：' + new Date(props.config.lastSync.at).toLocaleString() + (props.config.lastSync.ok ? ' · 成功' : ' · 失败')) : null)
  }

  // ---- 主面板 ----
  function ActivityPanel(props) {
    const variant = props.variant
    const open = variant === 'overlay' ? useOpen() : true
    const [data, setData] = React.useState(null)
    const [dayData, setDayData] = React.useState(null)
    const [dayLoading, setDayLoading] = React.useState(false)
    const [error, setError] = React.useState(null)
    const [loading, setLoading] = React.useState(true)
    const [project, setProject] = React.useState('all')
    const [scope, setScope] = React.useState('7d')
    const [selDate, setSelDate] = React.useState(null)
    const [evLimit, setEvLimit] = React.useState(250)
    const [tick, setTick] = React.useState(0)
    const [activeTab, setActiveTab] = React.useState('activity')
    const [pricingInfo, setPricingInfo] = React.useState(null)
    const [pricingRefresh, setPricingRefresh] = React.useState(0)

    function loadOverview() {
      apiFetch(HOST_API + '/overview').then(function (got) {
        const d = got && got.data
        if (d && d.ok) { setData(d); setError(null) } else { setError((d && d.error) || ('HTTP ' + got.status)) }
        setLoading(false)
      }).catch(function (e) { setError(String((e && e.message) || e)); setLoading(false) })
    }
    React.useEffect(function () { loadOverview() }, [tick])
    React.useEffect(function () {
      apiFetch(HOST_API + '/pricing/config').then(function (got) {
        if (got.data && got.data.ok) setPricingInfo(got.data)
      })
    }, [pricingRefresh])

    const today = todayKey()
    React.useEffect(function () {
      if (!data) return
      const init = selDate || (data.range && data.range.last) || today
      if (init === selDate) return
      setSelDate(init)
    }, [data])

    React.useEffect(function () {
      if (!data || !selDate) return
      let alive = true
      setDayLoading(true)
      const q = '?date=' + encodeURIComponent(selDate) + (project !== 'all' ? '&project=' + encodeURIComponent(project) : '')
      apiFetch(HOST_API + '/day' + q).then(function (got) {
        if (!alive) return
        const d = got && got.data
        if (d && d.ok) { setDayData(d); } else { setDayData({ date: selDate, events: [], tokens: [] }) }
        setDayLoading(false)
      }).catch(function () { if (alive) { setDayData({ date: selDate, events: [], tokens: [] }); setDayLoading(false) } })
      return function () { alive = false }
    }, [data, selDate, project])

    if (variant === 'overlay' && !open) return null

    const projects = (data && data.projects) || []
    const daysAll = data ? ((project === 'all' ? data.all : (data.byProject[project] || { days: {} })).days || {}) : {}
    // scope 过滤
    const cutoff = scope === 'today' ? today : scope === '7d' ? addDays(today, -6) : scope === '30d' ? addDays(today, -29) : null
    const scopedDays = {}
    for (const k of Object.keys(daysAll)) if (!cutoff || k >= cutoff) scopedDays[k] = daysAll[k]
    let scopedSessions = 0
    if (data) {
      const cutTs = cutoff ? new Date(cutoff + 'T00:00:00').getTime() : 0
      for (const s of data.sessions) {
        if (project !== 'all' && s.projectKey !== project) continue
        if (cutTs && (s.lastAt || s.createdAt) < cutTs) continue
        scopedSessions++
      }
    }
    const selDay = selDate ? daysAll[selDate] : null
    const dayCounts = selDay ? { u: selDay.u || 0, e: selDay.e || 0, c: selDay.c || 0, r: selDay.r || 0, o: selDay.o || 0 } : null
    const legend = el('div', { className: 'dsat-legend' },
      KIND_ORDER.map(function (k) {
        return el('span', { className: 'dsat-legend-item', key: k },
          el('span', { className: 'dsat-ev-dot', style: { background: KINDS[k].color } }), KINDS[k].label)
      }),
      el('span', { className: 'dsat-legend-item' }, el('span', { className: 'dsat-ev-dot dsat-dot-token' }, '\uD83E\uDE99'), 'token 消耗'))

    const projectSelect = el('select', {
      className: 'dsat-select', value: project,
      onChange: function (e) { setProject(e.target && e.target.value || 'all'); setEvLimit(250) },
    },
      el('option', { value: 'all' }, '全部项目'),
      projects.map(function (p) { return el('option', { value: p.key, key: p.key }, p.name + '（' + p.sessions + ' 会话）') }))

    const scopeSelect = el('select', {
      className: 'dsat-select', value: scope,
      onChange: function (e) { setScope(e.target && e.target.value || '7d') },
    },
      el('option', { value: 'today' }, '今日'),
      el('option', { value: '7d' }, '近 7 天'),
      el('option', { value: '30d' }, '近 30 天'),
      el('option', { value: 'all' }, '全部'))

    const pricingConfig = pricingInfo ? Object.assign({}, pricingInfo.config || {}, { lastSync: pricingInfo.lastSync, error: pricingInfo.error }) : null
    const tabButtons = el('div', { className: 'dsat-tabs' },
      el('button', { className: 'dsat-tab-btn' + (activeTab === 'activity' ? ' dsat-tab-active' : ''), onClick: function () { setActiveTab('activity') } }, '活动'),
      el('button', { className: 'dsat-tab-btn' + (activeTab === 'cost' ? ' dsat-tab-active' : ''), onClick: function () { setActiveTab('cost'); setPricingRefresh(pricingRefresh + 1) } }, '费用统计'),
      el('button', { className: 'dsat-tab-btn' + (activeTab === 'settings' ? ' dsat-tab-active' : ''), onClick: function () { setActiveTab('settings') } }, 'Sub2API 设置'))
    const header = el('div', { className: 'dsat-header' },
      el('span', { className: 'dsat-title' }, '\uD83D\uDCCA dsh 活动统计'),
      data ? el('span', { className: 'dsat-sub' },
        (data.range && data.range.last) ? '最近活动 ' + data.range.last : '暂无活动',
        data.tz ? ' · ' + data.tz : '') : null,
      el('span', { style: { flex: '1 1 auto' } }),
      activeTab === 'activity' ? projectSelect : null, activeTab === 'activity' ? scopeSelect : null,
      tabButtons,
      activeTab === 'activity' ? el('button', { className: 'dsat-mini', title: '重新扫描会话数据', onClick: function () { setLoading(true); setTick(tick + 1) } }, '\u21BB 刷新') : null,
      variant === 'overlay' ? el('button', { className: 'dsat-close', onClick: store.close, title: '关闭' }, '\u2715') : null,
    )

    const activityBody = loading
      ? el('div', { className: 'dsat-body' }, el('div', { className: 'dsat-status' }, '正在扫描会话数据…'))
      : error
        ? el('div', { className: 'dsat-body' }, el('div', { className: 'dsat-error' },
            '\u26a0 ' + error,
            el('div', { style: { marginTop: 8 } }, '宿主机接口未就绪：如果刚安装本插件，请重启 dsh 后重试。')))
        : (!data || !Object.keys(daysAll).length)
          ? el('div', { className: 'dsat-body' }, el('div', { className: 'dsat-status' },
              '还没有可统计的会话活动。用 dsh 聊几轮后点「刷新」即可看到。'))
          : el('div', { className: 'dsat-body' },
              el(SummaryCards, { days: scopedDays, sessions: scopedSessions }),
              el(Heatmap, { days: daysAll, selDate: selDate, onPick: function (k) { setSelDate(k); setEvLimit(250) } }),
              legend,
              el('div', { className: 'dsat-day-head' },
                el('button', { className: 'dsat-mini', onClick: function () { setSelDate(addDays(selDate, -1)) } }, '\u25C0'),
                el('span', { className: 'dsat-day-title' }, selDate || today),
                el('button', { className: 'dsat-mini', disabled: !selDate || selDate >= today, onClick: function () { setSelDate(addDays(selDate, 1)) } }, '\u25B6'),
                el('button', { className: 'dsat-mini', onClick: function () { setSelDate(today) } }, '今天'),
                dayCounts ? el('span', { className: 'dsat-day-sum' },
                  KIND_ORDER.map(function (k) { return dayCounts[k] ? KINDS[k].label + ' ' + dayCounts[k] : null }).filter(Boolean).join(' · ') || '当天无活动') : null,
                selDay ? el('span', { className: 'dsat-day-sum dsat-td-muted' },
                  ' · 入 ' + fmtK(selDay.ti || 0) + ' / 出 ' + fmtK(selDay.to || 0) + ' / 缓存 ' + fmtK(selDay.tc || 0)) : null,
              ),
              el('div', { className: 'dsat-section-label' }, '24 小时活动分布（按类型分色）'),
              el(HourChart, { hours: selDay ? selDay.hours : [] }),
              el('div', { className: 'dsat-section-label' }, '24 小时 token 消耗（输入+输出+缓存读）'),
              el(TokenHourChart, { hours: selDay ? selDay.hours : [] }),
              el('div', { className: 'dsat-section-label' }, dayLoading ? '当日时间线（加载中…）' : '当日时间线'),
              el(EventList, { dayData: dayData, limit: evLimit, onMore: function () { setEvLimit(0) } }),
              el(DailyTable, { days: daysAll, selDate: selDate, onPick: function (k) { setSelDate(k); setEvLimit(250) } }),
              el('div', { className: 'dsat-footer' },
                '数据源：~/.dsh/sessions（session.jsonl.zstd）· ' + (data.sessions ? data.sessions.length : 0) + ' 个会话 · 时区 ' + (data.tz || '本地')),
            )

    const panelBody = activeTab === 'cost'
      ? el(CostPanel, { refreshKey: pricingRefresh })
      : activeTab === 'settings'
        ? el(PricingSettings, { config: pricingConfig, onSaved: function (next) { setPricingInfo(next); setPricingRefresh(pricingRefresh + 1) } })
        : activityBody
    return el('div', { className: 'dsat-root' + (variant === 'overlay' ? ' dsat-overlay' : ' dsat-tab') }, header, panelBody)
  }

  var Panel = ActivityPanel
  var hasReact = true
} else {
  var Panel = null
  var hasReact = false
}

// ---------------- 样式 ----------------
const CSS = `
.dsat-root{display:flex;flex-direction:column;font-size:13px;line-height:1.5;color:inherit;min-height:0;}
.dsat-tab{height:100%;}
.dsat-overlay{position:fixed;top:16px;right:16px;bottom:16px;width:min(1020px,calc(100vw - 32px));background:#fff;border:1px solid rgba(127,127,127,.35);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:1000;pointer-events:auto;overflow:hidden;color:#1f2328;}
@media (prefers-color-scheme: dark){.dsat-overlay{background:#16181d;color:#e6e6e6;}}
.dsat-header{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(127,127,127,.25);flex:0 0 auto;flex-wrap:wrap;}
.dsat-title{font-weight:600;font-size:14px;white-space:nowrap;}
.dsat-sub{opacity:.6;font-size:11px;}
.dsat-tabs{display:flex;gap:2px;padding:2px;border-radius:8px;background:rgba(127,127,127,.1);}
.dsat-tab-btn{border:none;background:transparent;color:inherit;padding:4px 9px;border-radius:6px;font-size:11px;cursor:pointer;opacity:.65;}
.dsat-tab-btn:hover{opacity:1;background:rgba(127,127,127,.1);}
.dsat-tab-active{opacity:1;background:rgba(76,125,255,.18);color:#4c7dff;font-weight:700;}
.dsat-close{border:none;background:transparent;cursor:pointer;font-size:13px;color:inherit;opacity:.7;padding:4px 8px;border-radius:6px;}
.dsat-close:hover{opacity:1;background:rgba(127,127,127,.15);}
.dsat-body{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow-y:auto;padding:12px 14px 20px;gap:10px;}
.dsat-select{padding:5px 8px;border-radius:8px;border:1px solid rgba(127,127,127,.4);background:rgba(127,127,127,.08);color:inherit;font-size:12px;}
@media (prefers-color-scheme: dark){.dsat-select{color-scheme:dark;}.dsat-select option{background:#16181d;color:#e6e6e6;}}
.dsat-mini{font-size:12px;color:#4c7dff;background:transparent;border:1px solid rgba(76,125,255,.5);border-radius:6px;padding:3px 10px;cursor:pointer;}
.dsat-mini:hover{background:rgba(76,125,255,.12);}
.dsat-primary{background:rgba(76,125,255,.12);}
.dsat-mini:disabled{opacity:.4;cursor:default;}
.dsat-status{padding:18px;font-size:12px;opacity:.8;}
.dsat-error{padding:18px;font-size:12px;color:#d64545;}
.dsat-success{padding:10px 12px;font-size:12px;color:#2ea043;border-radius:8px;background:rgba(46,160,67,.1);}
.dsat-cards{display:flex;gap:8px;flex-wrap:wrap;}
.dsat-card{flex:1 1 120px;border:1px solid rgba(127,127,127,.25);border-radius:10px;padding:8px 12px;background:rgba(127,127,127,.05);}
.dsat-card-val{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;}
.dsat-card-label{font-size:11px;opacity:.7;}
.dsat-section-label{font-size:11px;font-weight:700;opacity:.6;letter-spacing:.04em;margin-top:4px;}
.dsat-cost-note{padding:9px 12px;border-radius:8px;background:rgba(76,125,255,.08);font-size:11px;color:#4c7dff;}
.dsat-cost-value{color:#2ea043;}
.dsat-cost-table-wrap{overflow-x:auto;}
.dsat-cost-table{min-width:650px;}
.dsat-th-left{text-align:left!important;}
.dsat-cost-name{max-width:300px;overflow:hidden;text-overflow:ellipsis;}
.dsat-settings{display:grid;grid-template-columns:1fr;gap:12px;max-width:720px;}
.dsat-auth-card{display:flex;flex-direction:column;gap:9px;padding:12px;border:1px solid rgba(127,127,127,.25);border-radius:10px;background:rgba(127,127,127,.04);}
.dsat-auth-advanced{font-size:11px;opacity:.85;}
.dsat-auth-advanced summary{cursor:pointer;margin-bottom:8px;font-weight:700;}
.dsat-field{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;}
.dsat-input{box-sizing:border-box;width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.4);background:rgba(127,127,127,.07);color:inherit;font-size:12px;outline:none;}
.dsat-input:focus{border-color:#4c7dff;box-shadow:0 0 0 2px rgba(76,125,255,.12);}
.dsat-settings-help{max-width:720px;padding:10px 12px;border-radius:8px;background:rgba(127,127,127,.07);font-size:11px;opacity:.75;}
.dsat-button-row{display:flex;gap:8px;flex-wrap:wrap;}
/* 热力图 */
.dsat-heat-wrap{display:flex;flex-direction:column;gap:4px;}
.dsat-heat{display:flex;gap:4px;}
.dsat-heat-left{display:flex;flex-direction:column;padding-top:16px;}
.dsat-dow{height:16px;font-size:9px;opacity:.5;line-height:16px;text-align:right;padding-right:2px;}
.dsat-heat-body{flex:1 1 auto;min-width:0;overflow-x:auto;}
.dsat-months{display:flex;height:14px;}
.dsat-month-label{width:16px;font-size:9px;opacity:.55;white-space:nowrap;overflow:visible;}
.dsat-weeks{display:flex;gap:3px;}
.dsat-week{display:flex;flex-direction:column;gap:3px;}
.dsat-cell{width:13px;height:13px;border-radius:3px;background:rgba(127,127,127,.15);cursor:pointer;border:1px solid transparent;}
.dsat-cell:hover{border-color:rgba(76,125,255,.8);}
.dsat-lv0{background:rgba(127,127,127,.15);}
.dsat-lv1{background:#9be9a8;}
.dsat-lv2{background:#40c463;}
.dsat-lv3{background:#30a14e;}
.dsat-lv4{background:#216e39;}
.dsat-cell-sel{outline:2px solid #4c7dff;outline-offset:1px;}
.dsat-cell-future{visibility:hidden;}
.dsat-heat-legend{display:flex;align-items:center;gap:3px;font-size:10px;opacity:.75;justify-content:flex-end;padding-top:4px;}
.dsat-heat-legend .dsat-cell{cursor:default;width:11px;height:11px;}
/* 图例 */
.dsat-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;opacity:.85;align-items:center;}
.dsat-legend-item{display:inline-flex;align-items:center;gap:5px;}
/* 当日头 */
.dsat-day-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;}
.dsat-day-title{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;}
.dsat-day-sum{font-size:11px;opacity:.85;}
/* 小时图 */
.dsat-hourchart{display:flex;gap:2px;align-items:flex-end;}
.dsat-hcol{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:default;}
.dsat-hbar{width:100%;height:96px;display:flex;flex-direction:column-reverse;border-radius:3px 3px 0 0;overflow:hidden;}
.dsat-hseg{width:100%;}
.dsat-hlab{font-size:9px;opacity:.5;height:12px;}
.dsat-thbar{height:56px;justify-content:flex-end;}
.dsat-tbar{width:100%;background:linear-gradient(180deg,#58a6ff,#2f6feb);border-radius:3px 3px 0 0;}
.dsat-tbar-empty{background:rgba(127,127,127,.2);}
/* 事件时间线 */
.dsat-events{display:flex;flex-direction:column;max-height:340px;overflow-y:auto;border:1px solid rgba(127,127,127,.2);border-radius:10px;padding:4px 10px;background:rgba(127,127,127,.04);}
.dsat-ev{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:12px;min-width:0;}
.dsat-ev-time{font-variant-numeric:tabular-nums;opacity:.6;flex:0 0 56px;font-size:11px;}
.dsat-ev-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font-size:9px;line-height:1;}
.dsat-dot-token{background:transparent;width:auto;height:auto;font-size:11px;}
.dsat-ev-kind{font-size:11px;flex:0 0 52px;}
.dsat-ev-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;opacity:.85;}
.dsat-ev-token .dsat-ev-label{opacity:.7;font-variant-numeric:tabular-nums;}
.dsat-ev-proj{font-size:10px;opacity:.5;border:1px solid rgba(127,127,127,.3);border-radius:999px;padding:0 6px;flex:0 0 auto;}
.dsat-pill{font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);white-space:nowrap;flex:0 0 auto;}
.dsat-pill-tool{font-family:ui-monospace,Consolas,monospace;}
.dsat-more{align-self:center;margin:6px 0;font-size:11px;color:#4c7dff;background:transparent;border:1px solid rgba(76,125,255,.5);border-radius:6px;padding:2px 10px;cursor:pointer;}
/* 每日表 */
.dsat-table-wrap{display:flex;flex-direction:column;gap:4px;}
.dsat-table{border-collapse:collapse;font-size:12px;width:100%;}
.dsat-th{text-align:right;padding:4px 6px;font-size:11px;opacity:.6;border-bottom:1px solid rgba(127,127,127,.25);font-weight:600;}
.dsat-th:first-child{text-align:left;}
.dsat-td{text-align:right;padding:4px 6px;font-variant-numeric:tabular-nums;border-bottom:1px solid rgba(127,127,127,.12);white-space:nowrap;}
.dsat-td-date{text-align:left;font-weight:600;}
.dsat-td-muted{opacity:.6;}
.dsat-tr{cursor:pointer;}
.dsat-tr:hover{background:rgba(76,125,255,.08);}
.dsat-tr-sel{background:rgba(76,125,255,.15);}
.dsat-tr-total .dsat-td{border-top:1px solid rgba(127,127,127,.3);font-weight:700;cursor:default;}
.dsat-footer{font-size:10px;opacity:.5;padding-top:4px;}
/* 侧栏 */
.dsat-sidebar-icon{font-size:15px;line-height:1;display:inline-flex;align-items:center;}
div[class*="_collapsed"] .dsat-sidebar-label{display:none;}
`

function injectStyles() {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-activity-tracker/styles'
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-activity-tracker'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}

// ---------------- 插件入口 ----------------
function apply(ctx) {
  console.log(TAG, 'apply, React =', hasReact)
  // slots 服务可能在 apply 时尚未就绪（例如 bundle 预取导致过早 apply），
  // 轮询等待其出现后再注册浮层；Panel 不可用（无 React）时不重试。
  var overlayInjected = false
  var tryInjectOverlay = function () {
    if (overlayInjected) return true
    const slots = ctx.get('slots')
    if (slots === undefined || Panel === null) return false
    slots.inject('shell.overlay', function () {
      return slots.register(
        { name: 'shell.overlay', id: 'activity-tracker-static', order: 60, label: '活动统计' },
        function () { return React.createElement(Panel, { variant: 'overlay' }) },
      )
    })
    overlayInjected = true
    return true
  }
  if (!tryInjectOverlay()) {
    let tries = 0
    const timer = window.setInterval(function () {
      tries++
      if (tryInjectOverlay() || tries >= 60) window.clearInterval(timer)
    }, 250)
    ctx.effect(function () {
      return function () { window.clearInterval(timer) }
    }, 'dsh-activity-tracker: 浮层注册等待清理')
  }
  if (typeof document !== 'undefined') {
    injectStyles()
    installSidebarButton()
    watchSidebar()
    ctx.effect(function () {
      return function () {
        if (obs) { obs.disconnect(); obs = null }
        window.clearTimeout(installTimer)
        removeSidebarButton()
      }
    }, 'dsh-activity-tracker: 侧栏入口清理')
    ctx.effect(function () {
      return function () {
        const s = document.querySelector('style[data-plugin="dsh-activity-tracker"]')
        if (s) s.remove()
      }
    }, 'dsh-activity-tracker: 样式清理')
  }
}

module.exports = { apply }

return module.exports;
} });
