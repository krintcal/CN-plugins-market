/**
 * cn-plugins-market — manage the plugins installed on this machine.
 *
 * One page in the Hermes Desktop app (sidebar nav + `/cn-plugins-market`):
 * a line-per-plugin list with enable/disable, update (including the consent and
 * security-scan review), update all, uninstall (agent half or standalone
 * desktop half), install from Git, and an inline detail row. It reads only the
 * local install state through `plugins.manage` and the desktop bridge.
 *
 * Desktop-only plugin: a single ESM file using only the public plugin SDK
 * (`@hermes/plugin-sdk`). No Python half, no credentials, no core patches.
 */
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  GlyphSpinner,
  haptic,
  host,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  Switch,
  Tip,
  useI18n,
  usePluginI18n
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'cn-plugins-market'
const PAGE_PATH = '/cn-plugins-market'
/** The backend surface this page drives (install_desktop, remove_desktop, inspect). */
const MIN_HERMES = '0.22.5'
const PREFS_KEY = 'prefs'
const REF_RE = /^[0-9a-f]{40}$/i
const FILTERS = ['all', 'enabled', 'disabled', 'desktop', 'updates']

const SWITCH_CLASS =
  'shrink-0 border border-(--ui-border) bg-(--ui-bg-quaternary) ' +
  'data-[state=checked]:border-[var(--ui-accent,#2f6fed)] ' +
  'data-[state=checked]:bg-[var(--ui-accent,#2f6fed)]'
const INPUT_CLASS =
  'h-7 rounded-md border border-(--ui-border) bg-(--ui-bg-input) px-2 text-xs outline-none'
const ROW_CLASS =
  'border-b border-(--ui-border) px-3 py-2 transition-colors last:border-b-0 hover:bg-(--ui-bg-quaternary)'
const MUTED = 'text-(--ui-text-tertiary)'
const DANGER = 'text-(--ui-danger)'

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const MESSAGES = {
  en: {
    nav: 'Plugin manager',
    title: 'Plugin manager',
    statusLine: (total, enabled, updates) =>
      `${total} installed · ${enabled} enabled · ${updates} update${updates === 1 ? '' : 's'}`,
    refresh: 'Refresh',
    updateAll: 'Update all',
    updatingAll: 'Updating all…',
    updateAllFailed: message => `Update all failed: ${message}`,
    updateAllDone: (updated, failed, review) =>
      `Update all: ${updated} updated · ${failed} failed · ${review} needs review`,
    updateAllNoResult: 'Nothing to update.',
    updateAllReviewHint: 'Review the remaining plugins with their own Update action.',
    statusUpdated: 'updated',
    statusCurrent: 'already current',
    statusFailed: 'failed',
    statusNeedsReview: 'needs review',
    skippedLabel: 'Skipped',
    installFromGit: 'Install from Git',
    gitTitle: 'Install from Git',
    gitRepo: 'Repository URL',
    gitRepoPlaceholder: 'https://github.com/owner/repo',
    gitRef: 'Ref (optional, 40-char SHA)',
    gitRefPlaceholder: '40-character commit SHA',
    check: 'Check',
    checking: 'Checking…',
    repoRequired: 'Enter a repository URL first.',
    invalidRef: 'The ref must be a 40-character commit SHA.',
    inspectFailed: message => `Could not inspect that source: ${message}`,
    hasAgentHalf: 'agent half',
    hasDesktopHalf: 'desktop half',
    inspectSha: 'commit',
    installAgent: 'Install agent half',
    installDesktop: 'Install desktop half only',
    installing: 'Installing…',
    installedReload: 'Installed. Restart the gateway to take effect.',
    installFailed: message => `Install failed: ${message}`,
    missingEnv: 'Missing environment variables',
    search: 'Filter by name',
    filterAll: n => `All ${n}`,
    filterEnabled: n => `Enabled ${n}`,
    filterDisabled: n => `Disabled ${n}`,
    filterDesktop: n => `Desktop half ${n}`,
    filterUpdates: n => `Updates ${n}`,
    empty: 'No installed plugins',
    emptyHint: 'Install one from Git, or check that the gateway is connected.',
    noResult: 'No matches',
    noResultHint: 'Try part of the plugin name.',
    sourceBundled: 'Built-in',
    sourceUser: 'Mine',
    sourceDesktop: 'Desktop half',
    sourceLabel: 'Source',
    portableBadge: 'Portable',
    portableTip: 'Agent Plugins v1 format — it can be moved to another Hermes as-is.',
    pinnedBadge: sha => `Pinned @ ${sha}`,
    pinnedTip: 'It will not follow updates until it is re-pinned.',
    agentInstalled: 'agent installed',
    agentNone: 'no agent half',
    statusEnabled: 'enabled',
    statusDisabled: 'disabled',
    desktopHas: 'desktop yes',
    desktopNone: 'desktop no',
    requiresVersion: version => `needs ≥${version}`,
    requiresVersionWarn: version => `needs ≥${version} (this app is older)`,
    update: 'Update',
    updating: 'Updating…',
    details: 'Details',
    hideDetails: 'Hide details',
    toggleAria: name => `Enable or disable ${name}`,
    enableTip: 'Enable',
    disableTip: 'Disable',
    enabledOk: name => `${name} enabled.`,
    disabledOk: name => `${name} disabled.`,
    toggleFailed: message => `Could not change the state: ${message}`,
    updateAvailable: 'Update available',
    updateUnchanged: 'Already up to date.',
    updatedOk: name => `${name} updated. Restart the gateway to apply.`,
    updateFailed: message => `Update failed: ${message}`,
    consentTitle: name => `Update ${name}? Needs confirmation`,
    consentBody: 'This update widens what the plugin can do. Review the added capabilities:',
    consentGo: 'Update anyway',
    scanTitle: 'Blocked by the security scan',
    scanVerdict: verdict => `Verdict: ${verdict}`,
    scanFindings: 'Findings',
    stillUpdate: 'Update anyway',
    close: 'Close',
    detailPath: 'Install path',
    openDir: 'Open folder',
    openDirFailed: 'Could not open that folder',
    keyLabel: 'Key',
    versionLabel: 'Version',
    pinnedLabel: 'Pinned SHA',
    upgradeLabel: 'Upgrade',
    upgradeValue: (version, sha) => `catalog ${version || '—'} · target ${sha || '—'}`,
    uninstall: 'Uninstall',
    uninstallDesktop: 'Remove desktop half',
    removeTitle: name => `Uninstall ${name}?`,
    removeBody: name =>
      `This deletes ${name} from this environment. Its desktop half is removed too when the package ships one. You can reinstall it from Git at any time.`,
    removeDesktopTitle: name => `Remove the desktop half of ${name}?`,
    removeDesktopBody: name =>
      `This deletes the desktop folder of ${name} on this machine. The agent half, if any, stays.`,
    uninstalled: name => `${name} uninstalled. Restart the gateway for it to fully unload.`,
    removeDesktopDone: name => `${name} desktop half removed.`,
    removeFailed: message => `Uninstall failed: ${message}`,
    copyCommand: 'Copy command',
    loading: 'Reading installed plugins…',
    loadFailed: message => `Could not read the installed list: ${message}`,
    retry: 'Retry'
  },
  zh: {
    nav: '插件管理',
    title: '插件管理',
    statusLine: (total, enabled, updates) => `共 ${total} 个 · 启用 ${enabled} · 有更新 ${updates}`,
    refresh: '刷新',
    updateAll: '全部更新',
    updatingAll: '全部更新中…',
    updateAllFailed: message => `全部更新失败：${message}`,
    updateAllDone: (updated, failed, review) =>
      `全部更新：成功 ${updated} · 失败 ${failed} · 待处理 ${review}`,
    updateAllNoResult: '没有需要更新的插件。',
    updateAllReviewHint: '其余插件请在各自的行里点「更新」逐个处理。',
    statusUpdated: '已更新',
    statusCurrent: '已是最新',
    statusFailed: '失败',
    statusNeedsReview: '待处理',
    skippedLabel: '已跳过',
    installFromGit: '从 Git 安装',
    gitTitle: '从 Git 安装',
    gitRepo: '仓库地址',
    gitRepoPlaceholder: 'https://github.com/owner/repo',
    gitRef: 'Ref（可选，40 位 SHA）',
    gitRefPlaceholder: '40 位提交 SHA',
    check: '检查',
    checking: '检查中…',
    repoRequired: '请先填写仓库地址。',
    invalidRef: 'Ref 必须是 40 位提交 SHA。',
    inspectFailed: message => `检查失败：${message}`,
    hasAgentHalf: 'agent 半边',
    hasDesktopHalf: 'desktop 半边',
    inspectSha: '提交',
    installAgent: '安装 agent 半边',
    installDesktop: '只装桌面半边',
    installing: '安装中…',
    installedReload: '已安装，重启网关后生效。',
    installFailed: message => `安装失败：${message}`,
    missingEnv: '缺少环境变量',
    search: '按名字过滤',
    filterAll: n => `全部 ${n}`,
    filterEnabled: n => `已启用 ${n}`,
    filterDisabled: n => `已停用 ${n}`,
    filterDesktop: n => `有桌面半边 ${n}`,
    filterUpdates: n => `有更新 ${n}`,
    empty: '还没有装插件',
    emptyHint: '可以从 Git 安装一个，或检查网关是否已连接。',
    noResult: '没有匹配',
    noResultHint: '试试插件名字的一部分。',
    sourceBundled: '内置',
    sourceUser: '自己装的',
    sourceDesktop: '桌面半边',
    sourceLabel: '来源',
    portableBadge: '便携',
    portableTip: 'Agent Plugins v1 格式，可原样搬到别的 Hermes。',
    pinnedBadge: sha => `固定 @ ${sha}`,
    pinnedTip: '重新固定前不会跟随更新。',
    agentInstalled: 'agent 已装',
    agentNone: 'agent 无',
    statusEnabled: '已启用',
    statusDisabled: '已停用',
    desktopHas: 'desktop 有',
    desktopNone: 'desktop 无',
    requiresVersion: version => `需 ≥${version}`,
    requiresVersionWarn: version => `需 ≥${version}（本机偏低）`,
    update: '更新',
    updating: '更新中…',
    details: '详情',
    hideDetails: '收起详情',
    toggleAria: name => `启用或停用 ${name}`,
    enableTip: '启用',
    disableTip: '停用',
    enabledOk: name => `${name} 已启用`,
    disabledOk: name => `${name} 已停用`,
    toggleFailed: message => `改不动状态：${message}`,
    updateAvailable: '可升级',
    updateUnchanged: '已是最新',
    updatedOk: name => `${name} 已更新，重启网关后生效`,
    updateFailed: message => `更新失败：${message}`,
    consentTitle: name => `更新 ${name}？需要确认`,
    consentBody: '这次更新会扩大插件的能力范围，请先确认新增项：',
    consentGo: '仍然更新',
    scanTitle: '扫描拦截',
    scanVerdict: verdict => `结论：${verdict}`,
    scanFindings: '发现',
    stillUpdate: '仍然更新',
    close: '关闭',
    detailPath: '安装路径',
    openDir: '打开目录',
    openDirFailed: '打不开这个目录',
    keyLabel: 'Key',
    versionLabel: '版本',
    pinnedLabel: '固定 SHA',
    upgradeLabel: '可升级',
    upgradeValue: (version, sha) => `目录版本 ${version || '—'} · 目标 ${sha || '—'}`,
    uninstall: '卸载',
    uninstallDesktop: '卸载桌面半边',
    removeTitle: name => `卸载 ${name}？`,
    removeBody: name =>
      `会把这个插件从当前环境删掉；如果它是带桌面半边的包，桌面那份也会一起删。以后随时可以从 Git 重新安装。`,
    removeDesktopTitle: name => `卸载 ${name} 的桌面半边？`,
    removeDesktopBody: name => `只删除这台机器上的桌面文件夹；agent 半边（如果有）会保留。`,
    uninstalled: name => `${name} 已卸载，重启网关后完全生效`,
    removeDesktopDone: name => `${name} 的桌面半边已卸载`,
    removeFailed: message => `卸载失败：${message}`,
    copyCommand: '复制命令',
    loading: '正在读取已安装插件…',
    loadFailed: message => `读不到已安装列表：${message}`,
    retry: '重试'
  },
  'zh-hant': {
    nav: '外掛管理',
    title: '外掛管理',
    statusLine: (total, enabled, updates) => `共 ${total} 個 · 啟用 ${enabled} · 有更新 ${updates}`,
    refresh: '重新整理',
    updateAll: '全部更新',
    updatingAll: '全部更新中…',
    updateAllFailed: message => `全部更新失敗：${message}`,
    updateAllDone: (updated, failed, review) =>
      `全部更新：成功 ${updated} · 失敗 ${failed} · 待處理 ${review}`,
    updateAllNoResult: '沒有需要更新的外掛。',
    updateAllReviewHint: '其餘外掛請在各自的行裡點「更新」逐個處理。',
    statusUpdated: '已更新',
    statusCurrent: '已是最新',
    statusFailed: '失敗',
    statusNeedsReview: '待處理',
    skippedLabel: '已跳過',
    installFromGit: '從 Git 安裝',
    gitTitle: '從 Git 安裝',
    gitRepo: '倉庫位址',
    gitRepoPlaceholder: 'https://github.com/owner/repo',
    gitRef: 'Ref（選填，40 位 SHA）',
    gitRefPlaceholder: '40 位提交 SHA',
    check: '檢查',
    checking: '檢查中…',
    repoRequired: '請先填寫倉庫位址。',
    invalidRef: 'Ref 必須是 40 位提交 SHA。',
    inspectFailed: message => `檢查失敗：${message}`,
    hasAgentHalf: 'agent 半邊',
    hasDesktopHalf: 'desktop 半邊',
    inspectSha: '提交',
    installAgent: '安裝 agent 半邊',
    installDesktop: '只裝桌面半邊',
    installing: '安裝中…',
    installedReload: '已安裝，重啟閘道後生效。',
    installFailed: message => `安裝失敗：${message}`,
    missingEnv: '缺少環境變數',
    search: '按名稱過濾',
    filterAll: n => `全部 ${n}`,
    filterEnabled: n => `已啟用 ${n}`,
    filterDisabled: n => `已停用 ${n}`,
    filterDesktop: n => `有桌面半邊 ${n}`,
    filterUpdates: n => `有更新 ${n}`,
    empty: '還沒有安裝外掛',
    emptyHint: '可以從 Git 安裝一個，或檢查閘道是否已連線。',
    noResult: '沒有符合',
    noResultHint: '試試外掛名稱的一部分。',
    sourceBundled: '內建',
    sourceUser: '自己裝的',
    sourceDesktop: '桌面半邊',
    sourceLabel: '來源',
    portableBadge: '便攜',
    portableTip: 'Agent Plugins v1 格式，可原樣搬到別的 Hermes。',
    pinnedBadge: sha => `固定 @ ${sha}`,
    pinnedTip: '重新固定前不會跟隨更新。',
    agentInstalled: 'agent 已裝',
    agentNone: 'agent 無',
    statusEnabled: '已啟用',
    statusDisabled: '已停用',
    desktopHas: 'desktop 有',
    desktopNone: 'desktop 無',
    requiresVersion: version => `需 ≥${version}`,
    requiresVersionWarn: version => `需 ≥${version}（本機偏低）`,
    update: '更新',
    updating: '更新中…',
    details: '詳情',
    hideDetails: '收合詳情',
    toggleAria: name => `啟用或停用 ${name}`,
    enableTip: '啟用',
    disableTip: '停用',
    enabledOk: name => `${name} 已啟用`,
    disabledOk: name => `${name} 已停用`,
    toggleFailed: message => `改不動狀態：${message}`,
    updateAvailable: '可升級',
    updateUnchanged: '已是最新',
    updatedOk: name => `${name} 已更新，重啟閘道後生效`,
    updateFailed: message => `更新失敗：${message}`,
    consentTitle: name => `更新 ${name}？需要確認`,
    consentBody: '這次更新會擴大外掛的能力範圍，請先確認新增項目：',
    consentGo: '仍然更新',
    scanTitle: '掃描攔截',
    scanVerdict: verdict => `結論：${verdict}`,
    scanFindings: '發現',
    stillUpdate: '仍然更新',
    close: '關閉',
    detailPath: '安裝路徑',
    openDir: '開啟目錄',
    openDirFailed: '無法開啟這個目錄',
    keyLabel: 'Key',
    versionLabel: '版本',
    pinnedLabel: '固定 SHA',
    upgradeLabel: '可升級',
    upgradeValue: (version, sha) => `目錄版本 ${version || '—'} · 目標 ${sha || '—'}`,
    uninstall: '卸載',
    uninstallDesktop: '卸載桌面半邊',
    removeTitle: name => `卸載 ${name}？`,
    removeBody: name =>
      `會把這個外掛從目前環境刪掉；如果它是帶桌面半邊的套件，桌面那份也會一起刪。之後隨時可以從 Git 重新安裝。`,
    removeDesktopTitle: name => `卸載 ${name} 的桌面半邊？`,
    removeDesktopBody: name => `只刪除這台機器上的桌面資料夾；agent 半邊（如果有）會保留。`,
    uninstalled: name => `${name} 已卸載，重啟閘道後完全生效`,
    removeDesktopDone: name => `${name} 的桌面半邊已卸載`,
    removeFailed: message => `卸載失敗：${message}`,
    copyCommand: '複製指令',
    loading: '正在讀取已安裝外掛…',
    loadFailed: message => `讀不到已安裝清單：${message}`,
    retry: '重試'
  }
}

// ---------------------------------------------------------------------------
// module state
// ---------------------------------------------------------------------------

let pluginCtx = null
let prefs = { filter: 'all' }

function readStored(key) {
  try {
    const raw = pluginCtx && pluginCtx.storage ? pluginCtx.storage.get(key) : null
    if (raw == null) return null
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    }
    return raw
  } catch {
    return null
  }
}

function writeStored(key, value) {
  try {
    if (pluginCtx && pluginCtx.storage) pluginCtx.storage.set(key, value)
  } catch {
    /* persistence is best-effort */
  }
}

function hydrate() {
  const stored = readStored(PREFS_KEY)
  if (!stored || typeof stored !== 'object') return
  prefs = { ...prefs, ...stored }
  if (!FILTERS.includes(prefs.filter)) prefs.filter = 'all'
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** A labelled row that simply doesn't exist when the field is empty. */
function detailRow(label, value, key) {
  return jsxs(
    'div',
    {
      className: 'flex min-w-0 gap-2',
      children: [
        label ? jsx('span', { className: `w-24 shrink-0 ${MUTED}`, children: label }) : null,
        jsx('div', { className: 'min-w-0 flex-1 break-words', children: value })
      ]
    },
    key || label
  )
}

/** Dotted numeric version segments; null when the string isn't one. */
function versionParts(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^v/i, '')
  if (!/^\d+(\.\d+)*$/.test(raw)) return null
  return raw.split('.').map(Number)
}

/** Only `>=x.y.z` is evaluated; anything unknown counts as satisfied. */
function satisfies(required, current) {
  const match = /^>=\s*(\d+(?:\.\d+)*)$/.exec(String(required || '').trim())
  if (!match) return true
  const need = versionParts(match[1])
  const have = versionParts(current)
  if (!need || !have) return true
  for (let i = 0; i < Math.max(need.length, have.length); i += 1) {
    const want = need[i] || 0
    const got = have[i] || 0
    if (got > want) return true
    if (got < want) return false
  }
  return true
}

/** The labels already carry the `≥` glyph, so the raw operator is stripped. */
function prettyRequirement(value) {
  return String(value || '')
    .trim()
    .replace(/^>=?\s*/, '')
}

/** Seven hex chars are enough to tell two revisions apart on a line. */
function shortSha(sha) {
  return String(sha || '').slice(0, 7)
}

function errorMessage(error) {
  return String((error && error.message) || error || '')
}

function bridge() {
  return typeof window !== 'undefined' ? window.hermesDesktop : undefined
}

/** Error text plus the extra fields the install action can carry. */
function extraDetails(value, t) {
  const out = []
  const missing = value && value.missing_env
  const warnings = value && value.warnings
  if (Array.isArray(missing) && missing.length) out.push(`${t('missingEnv')}: ${missing.join(', ')}`)
  if (Array.isArray(warnings) && warnings.length) out.push(warnings.join(' · '))
  return out
}

function sourceKeyOf(row) {
  if (row.source === 'bundled') return 'sourceBundled'
  if (row.source === 'desktop') return 'sourceDesktop'
  return 'sourceUser'
}

function rowKeyOf(row) {
  return row.key || `name:${row.name}`
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

function ManagerPage() {
  const t = usePluginI18n(ID)
  const { locale } = useI18n()
  useEffect(() => {
    syncNavLabel(pluginCtx)
  }, [locale])

  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [desktopDirs, setDesktopDirs] = useState(() => new Set())
  const [appVersion, setAppVersion] = useState('')
  const [filter, setFilter] = useState(prefs.filter)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState('')
  const [busyName, setBusyName] = useState('')
  const [rowError, setRowError] = useState(null)
  const [actionError, setActionError] = useState('')
  const [pendingRemove, setPendingRemove] = useState(null)
  const [consent, setConsent] = useState(null)
  const [scan, setScan] = useState(null)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [installRepo, setInstallRepo] = useState('')
  const [installRef, setInstallRef] = useState('')
  const [inspect, setInspect] = useState({ status: 'idle' })
  const [installingHalf, setInstallingHalf] = useState('')

  const readDesktopDirs = useCallback(async () => {
    try {
      const desktop = bridge()
      if (!desktop || typeof desktop.desktopPluginsRoot !== 'function') return new Set()
      if (typeof desktop.readDir !== 'function') return new Set()
      const root = await desktop.desktopPluginsRoot()
      if (!root) return new Set()
      const res = await desktop.readDir(root)
      const entries = res && Array.isArray(res.entries) ? res.entries : []
      return new Set(entries.filter(entry => entry.isDirectory).map(entry => entry.name))
    } catch {
      return new Set()
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await host.request('plugins.manage', { action: 'list' }, 60000)
      if (!res || !Array.isArray(res.plugins)) throw new Error('list returned no plugins array')
      setRows(res.plugins)
      setLoadError('')
      setStatus('ready')
    } catch (e) {
      setRows([])
      setLoadError(errorMessage(e))
      setStatus('error')
    }
    setDesktopDirs(await readDesktopDirs())
    setRefreshing(false)
  }, [readDesktopDirs])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let alive = true
    const desktop = bridge()
    if (!desktop || typeof desktop.getVersion !== 'function') return () => {}
    Promise.resolve(desktop.getVersion())
      .then(info => {
        if (alive && info && typeof info.appVersion === 'string') setAppVersion(info.appVersion)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    prefs = { filter }
    writeStored(PREFS_KEY, prefs)
  }, [filter])

  /** Backend rows plus desktop halves that have no agent row at all. */
  const allRows = useMemo(() => {
    const seen = new Set()
    const merged = rows.map(row => {
      const leaf = String(row.key || '').split('/').pop()
      if (row.name) seen.add(row.name)
      if (leaf) seen.add(leaf)
      if (row.catalog_name) seen.add(row.catalog_name)
      const found =
        row.has_desktop_half ||
        Boolean(row.name && desktopDirs.has(row.name)) ||
        Boolean(leaf && desktopDirs.has(leaf)) ||
        Boolean(row.catalog_name && desktopDirs.has(row.catalog_name))
      return found && !row.has_desktop_half ? { ...row, has_desktop_half: true } : row
    })
    for (const name of desktopDirs) {
      if (seen.has(name)) continue
      merged.push({
        name,
        key: '',
        version: '',
        description: '',
        source: 'desktop',
        status: 'not enabled',
        portable: false,
        has_desktop_half: true,
        install_dir: '',
        desktop_only: true
      })
    }
    return merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  }, [rows, desktopDirs])

  const counts = useMemo(() => {
    let enabled = 0
    let updates = 0
    let desktop = 0
    for (const row of allRows) {
      if (row.status === 'enabled') enabled += 1
      if (row.update_available) updates += 1
      if (row.has_desktop_half) desktop += 1
    }
    return { total: allRows.length, enabled, updates, desktop }
  }, [allRows])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allRows.filter(row => {
      if (needle && !String(row.name || '').toLowerCase().includes(needle)) return false
      if (filter === 'enabled') return row.status === 'enabled'
      if (filter === 'disabled') return row.status !== 'enabled'
      if (filter === 'desktop') return Boolean(row.has_desktop_half)
      if (filter === 'updates') return Boolean(row.update_available)
      return true
    })
  }, [allRows, filter, query])

  const versionWarn = versionParts(appVersion) && !satisfies(`>=${MIN_HERMES}`, appVersion)

  const notify = useCallback((kind, message) => {
    try {
      host.notify({ kind, message })
    } catch {}
  }, [])

  const revealPath = useCallback(
    path => {
      if (!path) return
      const desktop = bridge()
      if (!desktop || typeof desktop.revealPath !== 'function') {
        notify('error', t('openDirFailed'))
        return
      }
      try {
        const pending = desktop.revealPath(path)
        if (pending && typeof pending.then === 'function') {
          pending.then(ok => {
            if (ok === false) notify('error', t('openDirFailed'))
          })
        }
      } catch {
        notify('error', t('openDirFailed'))
      }
    },
    [notify, t]
  )

  const toggleRow = useCallback(
    async (row, enable) => {
      if (!row.key) return
      haptic('tap')
      setBusyName(row.name)
      try {
        const res = await host.request(
          'plugins.manage',
          { action: 'toggle', key: row.key, enable },
          120000
        )
        if (!res || !res.ok) throw new Error((res && res.error) || 'toggle rejected')
        notify('success', enable ? t('enabledOk', row.name) : t('disabledOk', row.name))
        await refresh()
      } catch (e) {
        notify('error', t('toggleFailed', errorMessage(e)))
      } finally {
        setBusyName('')
      }
    },
    [notify, refresh, t]
  )

  const runUpdate = useCallback(
    async (row, options = {}) => {
      setBusyName(row.name)
      setRowError(null)
      try {
        const res = await host.request(
          'plugins.manage',
          { action: 'update', name: row.name, ...options },
          300000
        )
        if (res && res.consent_required && !options.accept_capabilities) {
          setConsent({ row, lines: Array.isArray(res.delta_lines) ? res.delta_lines : [] })
          return
        }
        if (res && res.scan_blocked && !options.force) {
          setScan({
            row,
            verdict: res.scan_verdict || '',
            findings: Array.isArray(res.scan_findings) ? res.scan_findings : [],
            accept: Boolean(options.accept_capabilities)
          })
          return
        }
        if (!res || !res.ok) throw new Error((res && res.error) || 'update rejected')
        notify('success', res.unchanged ? t('updateUnchanged') : t('updatedOk', row.name))
        setConsent(null)
        setScan(null)
        await refresh()
      } catch (e) {
        const message = t('updateFailed', errorMessage(e))
        setRowError({ name: row.name, message })
        notify('error', message)
      } finally {
        setBusyName('')
      }
    },
    [notify, refresh, t]
  )

  const runUpdateAll = useCallback(async () => {
    haptic('tap')
    setBulkUpdating(true)
    setActionError('')
    setBulkResult(null)
    try {
      const res = await host.request('plugins.manage', { action: 'update_all' }, 900000)
      const results = res && Array.isArray(res.results) ? res.results : []
      const skipped = res && Array.isArray(res.skipped) ? res.skipped : []
      setBulkResult({ results, skipped })
      const count = wanted => results.filter(r => r.status === wanted).length
      notify('success', t('updateAllDone', count('updated'), count('failed'), count('needs_review')))
      await refresh()
    } catch (e) {
      const message = t('updateAllFailed', errorMessage(e))
      setActionError(message)
      notify('error', message)
    } finally {
      setBulkUpdating(false)
    }
  }, [notify, refresh, t])

  const runInspect = useCallback(async () => {
    const identifier = installRepo.trim()
    const ref = installRef.trim()
    setActionError('')
    if (!identifier) return setInspect({ status: 'error', error: t('repoRequired') })
    if (ref && !REF_RE.test(ref)) return setInspect({ status: 'error', error: t('invalidRef') })
    setInspect({ status: 'checking' })
    try {
      const res = await host.request('plugins.manage', { action: 'inspect', identifier }, 600000)
      if (!res || !res.ok) throw new Error((res && res.error) || 'inspect rejected')
      setInspect({ status: 'done', data: res })
    } catch (e) {
      setInspect({ status: 'error', error: t('inspectFailed', errorMessage(e)) })
    }
  }, [installRef, installRepo, t])

  const installHalf = useCallback(
    async half => {
      const identifier = installRepo.trim()
      const ref = installRef.trim()
      if (!identifier) return setInspect({ status: 'error', error: t('repoRequired') })
      if (ref && !REF_RE.test(ref)) return setInspect({ status: 'error', error: t('invalidRef') })
      setInstallingHalf(half)
      setActionError('')
      try {
        const params =
          half === 'desktop'
            ? { action: 'install_desktop', identifier }
            : { action: 'install', identifier, enable: true }
        if (ref) params.ref = ref
        if (half === 'agent' && !ref && inspect.status === 'done' && inspect.data?.sha) {
          params.inspected_sha = inspect.data.sha
        }
        const res = await host.request('plugins.manage', params, 900000)
        if (!res || !res.ok) {
          throw new Error([(res && res.error) || 'install rejected', ...extraDetails(res, t)].join(' · '))
        }
        notify('success', t('installedReload'))
        setInstallOpen(false)
        setInstallRepo('')
        setInstallRef('')
        setInspect({ status: 'idle' })
        await refresh()
      } catch (e) {
        const message = t(
          'installFailed',
          [errorMessage(e), ...extraDetails(e && (e.data || e), t)].filter(Boolean).join(' · ')
        )
        setInspect({ status: 'error', error: message })
        notify('error', message)
      } finally {
        setInstallingHalf('')
      }
    },
    [inspect, installRef, installRepo, notify, refresh, t]
  )

  const doRemove = useCallback(async () => {
    const target = pendingRemove
    if (!target) return
    setBusyName(target.name)
    setActionError('')
    try {
      const params = target.desktop_only
        ? { action: 'remove_desktop', name: target.name }
        : { action: 'remove', name: target.name }
      const res = await host.request('plugins.manage', params, 300000)
      if (!res || !res.ok) throw new Error((res && res.error) || 'remove rejected')
      notify(
        'success',
        target.desktop_only ? t('removeDesktopDone', target.name) : t('uninstalled', target.name)
      )
      setPendingRemove(null)
      await refresh()
    } catch (e) {
      const message = t('removeFailed', errorMessage(e))
      notify('error', message)
      throw new Error(message)
    } finally {
      setBusyName('')
    }
  }, [notify, pendingRemove, refresh, t])

  const chip = (id, label) =>
    jsx(
      'button',
      {
        type: 'button',
        onClick: () => {
          haptic('tap')
          setFilter(id)
        },
        'aria-pressed': filter === id,
        className: cn(
          'rounded-full px-2.5 py-1 text-xs transition-colors',
          filter === id
            ? 'bg-(--ui-bg-quaternary) font-medium text-(--ui-text-primary)'
            : `${MUTED} hover:text-(--ui-text-primary)`
        ),
        children: label
      },
      id
    )

  const inspectPanel = () => {
    if (inspect.status === 'idle') return null
    if (inspect.status === 'checking') {
      return jsxs('div', {
        className: `flex items-center gap-2 text-xs ${MUTED}`,
        children: [jsx(GlyphSpinner, {}), t('checking')]
      })
    }
    if (inspect.status === 'error') {
      return jsxs('div', {
        className: 'flex flex-col items-start gap-1 text-xs',
        children: [
          jsx('div', { className: DANGER, children: inspect.error }),
          jsx(Button, {
            size: 'xs',
            variant: 'ghost',
            type: 'button',
            onClick: runInspect,
            children: t('check')
          })
        ]
      })
    }
    const data = inspect.data || {}
    const warnings = Array.isArray(data.warnings) ? data.warnings : []
    const halfButton = (half, label, variant) =>
      jsx(Button, {
        size: 'xs',
        variant,
        type: 'button',
        disabled: Boolean(installingHalf),
        onClick: () => installHalf(half),
        children:
          installingHalf === half
            ? jsxs('span', {
                className: 'inline-flex items-center gap-1',
                children: [jsx(GlyphSpinner, {}), t('installing')]
              })
            : label
      })
    return jsxs('div', {
      className: 'flex flex-col gap-2 rounded-md border border-(--ui-border) p-2 text-xs',
      children: [
        jsxs('div', {
          className: 'flex flex-wrap items-center gap-2',
          children: [
            jsx(Badge, {
              variant: data.agent ? 'success' : 'muted',
              size: 'xs',
              children: `${data.agent ? '✓' : '—'} ${t('hasAgentHalf')}`
            }),
            jsx(Badge, {
              variant: data.desktop ? 'success' : 'muted',
              size: 'xs',
              children: `${data.desktop ? '✓' : '—'} ${t('hasDesktopHalf')}`
            }),
            data.sha
              ? jsx('span', {
                  className: MUTED,
                  children: `${t('inspectSha')} ${shortSha(data.sha)}`
                })
              : null
          ]
        }),
        warnings.length ? jsx('div', { className: DANGER, children: warnings.join(' · ') }) : null,
        jsxs('div', {
          className: 'flex flex-wrap items-center gap-2',
          children: [
            data.agent ? halfButton('agent', t('installAgent'), 'default') : null,
            data.desktop ? halfButton('desktop', t('installDesktop'), 'outline') : null
          ]
        })
      ]
    })
  }

  const renderRow = row => {
    const id = rowKeyOf(row)
    const isOpen = openId === id
    const busy = busyName === row.name
    const sourceKey = sourceKeyOf(row)
    const enabled = row.status === 'enabled'
    const desktopOnly = Boolean(row.desktop_only)
    const details = isOpen
      ? [
          detailRow(
            t('detailPath'),
            jsxs('div', {
              className: 'flex min-w-0 items-center gap-2',
              children: [
                jsx('code', {
                  className: 'min-w-0 flex-1 truncate font-mono',
                  children: row.install_dir || '—'
                }),
                row.install_dir
                  ? jsx(Button, {
                      size: 'xs',
                      variant: 'ghost',
                      type: 'button',
                      onClick: () => revealPath(row.install_dir),
                      children: t('openDir')
                    })
                  : null
              ]
            }),
            'path'
          ),
          detailRow(
            t('keyLabel'),
            jsx('code', { className: 'font-mono', children: row.key || '—' }),
            'key'
          ),
          detailRow(t('sourceLabel'), t(sourceKey), 'source'),
          detailRow(t('versionLabel'), row.version || '—', 'version'),
          row.pinned_sha ? detailRow(t('pinnedLabel'), shortSha(row.pinned_sha), 'pinned') : null,
          row.update_available
            ? detailRow(
                t('upgradeLabel'),
                t(
                  'upgradeValue',
                  row.catalog_version || '',
                  shortSha(row.update_target || row.catalog_sha)
                ),
                'upgrade'
              )
            : null
        ].filter(Boolean)
      : null

    return jsxs(
      'div',
      {
        className: ROW_CLASS,
        children: [
          jsxs('div', {
            className: 'flex min-w-0 flex-wrap items-center gap-2',
            children: [
              jsx('span', {
                className: cn(
                  'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                  enabled ? 'bg-[#22c55e]' : 'bg-(--ui-text-tertiary)'
                ),
                'aria-hidden': true
              }),
              jsx('span', {
                className: 'min-w-0 truncate text-sm font-medium',
                children: row.name
              }),
              row.version
                ? jsx('span', { className: `text-xs ${MUTED}`, children: `v${row.version}` })
                : null,
              jsx(Badge, {
                size: 'xs',
                variant: row.source === 'bundled' ? 'muted' : 'outline',
                children: t(sourceKey)
              }),
              row.portable
                ? jsx(Tip, {
                    label: t('portableTip'),
                    children: jsx('span', {
                      className: 'inline-flex',
                      children: jsx(Badge, {
                        variant: 'muted',
                        size: 'xs',
                        children: t('portableBadge')
                      })
                    })
                  })
                : null,
              row.pinned_sha
                ? jsx(Tip, {
                    label: t('pinnedTip'),
                    children: jsx('span', {
                      className: 'inline-flex',
                      children: jsx(Badge, {
                        variant: 'muted',
                        size: 'xs',
                        children: t('pinnedBadge', shortSha(row.pinned_sha))
                      })
                    })
                  })
                : null,
              jsx('div', { className: 'flex-1' }),
              row.key
                ? jsx(Tip, {
                    label: enabled ? t('disableTip') : t('enableTip'),
                    children: jsx(Switch, {
                      checked: enabled,
                      disabled: busy,
                      'aria-label': t('toggleAria', row.name),
                      className: SWITCH_CLASS,
                      onCheckedChange: next => toggleRow(row, next)
                    })
                  })
                : null
            ]
          }),
          jsxs('div', {
            className: 'mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs',
            children: [
              jsx('span', {
                className: MUTED,
                children: desktopOnly
                  ? t('agentNone')
                  : `${t('agentInstalled')} · ${enabled ? t('statusEnabled') : t('statusDisabled')}`
              }),
              jsx('span', {
                className: MUTED,
                children: row.has_desktop_half ? t('desktopHas') : t('desktopNone')
              }),
              row.update_available
                ? jsx('span', { className: MUTED, children: t('updateAvailable') })
                : null,
              jsx('div', { className: 'flex-1' }),
              row.update_available
                ? jsx(Button, {
                    size: 'xs',
                    variant: 'secondary',
                    type: 'button',
                    disabled: busy,
                    onClick: () => runUpdate(row),
                    children: busy ? t('updating') : t('update')
                  })
                : null,
              jsx(Button, {
                size: 'xs',
                variant: 'ghost',
                type: 'button',
                'aria-expanded': isOpen,
                onClick: () => {
                  haptic('tap')
                  setOpenId(prev => (prev === id ? '' : id))
                },
                children: isOpen ? t('hideDetails') : `${t('details')} ›`
              })
            ]
          }),
          rowError && rowError.name === row.name
            ? jsx('div', { className: `mt-1 text-xs ${DANGER}`, children: rowError.message })
            : null,
          isOpen
            ? jsxs('div', {
                className: 'mt-2 flex flex-col gap-1.5 border-t border-(--ui-border) pt-2 text-xs',
                children: [
                  ...details,
                  jsxs('div', {
                    className: 'mt-1 flex flex-wrap items-center gap-2',
                    children: [
                      jsx(Button, {
                        size: 'xs',
                        variant: desktopOnly ? 'outline' : 'destructive',
                        type: 'button',
                        disabled: busy,
                        onClick: () => setPendingRemove(row),
                        children: desktopOnly ? t('uninstallDesktop') : t('uninstall')
                      }),
                      jsx(CopyButton, {
                        appearance: 'inline',
                        text: `hermes plugins remove ${row.name}`,
                        label: t('copyCommand')
                      })
                    ]
                  })
                ]
              })
            : null
        ]
      },
      id
    )
  }

  const body = () => {
    if (status === 'loading' && !allRows.length) {
      return jsxs('div', {
        className: 'flex items-center gap-2 py-12 text-sm text-(--ui-text-tertiary)',
        children: [jsx(GlyphSpinner, {}), t('loading')]
      })
    }
    if (status === 'error' && !allRows.length) {
      return jsxs('div', {
        className: 'rounded-md border border-(--ui-danger) p-3 text-sm',
        children: [
          jsx('div', { children: t('loadFailed', loadError) }),
          jsx(Button, {
            className: 'mt-2',
            size: 'sm',
            variant: 'outline',
            type: 'button',
            onClick: refresh,
            children: t('retry')
          })
        ]
      })
    }
    if (!filtered.length) {
      return jsx(EmptyState, {
        title: query.trim() ? t('noResult') : t('empty'),
        description: query.trim() ? t('noResultHint') : t('emptyHint')
      })
    }
    return jsx('div', {
      className:
        'min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] pr-2',
      children: jsx('div', {
        className: 'overflow-hidden rounded-md border border-(--ui-border)',
        children: filtered.map(renderRow)
      })
    })
  }

  return jsxs('div', {
    className: 'flex h-full min-w-0 min-h-0 flex-col gap-3 p-4',
    children: [
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2',
        children: [
          jsxs('div', {
            className: 'flex min-w-0 items-baseline gap-2',
            children: [
              jsx('div', { className: 'shrink-0 text-sm font-medium', children: t('title') }),
              jsx('span', {
                className: `truncate text-xs ${MUTED}`,
                children: t('statusLine', counts.total, counts.enabled, counts.updates)
              }),
              // One global warning instead of the same chip on all 70 rows.
              versionWarn
                ? jsx('span', {
                    className: `shrink-0 text-xs ${DANGER}`,
                    children: t('requiresVersionWarn', MIN_HERMES)
                  })
                : null
            ]
          }),
          jsxs('div', {
            className: 'flex shrink-0 flex-wrap items-center justify-end gap-2',
            children: [
              jsx(Button, {
                size: 'sm',
                variant: 'secondary',
                type: 'button',
                disabled: bulkUpdating || counts.updates === 0,
                onClick: runUpdateAll,
                children: bulkUpdating
                  ? jsxs('span', {
                      className: 'inline-flex items-center gap-1.5',
                      children: [jsx(GlyphSpinner, {}), t('updatingAll')]
                    })
                  : t('updateAll')
              }),
              jsx(Button, {
                size: 'sm',
                variant: installOpen ? 'secondary' : 'outline',
                type: 'button',
                onClick: () => {
                  haptic('tap')
                  setInstallOpen(open => !open)
                  setInspect({ status: 'idle' })
                  setActionError('')
                },
                children: t('installFromGit')
              }),
              jsx(Tip, {
                label: t('refresh'),
                children: jsx(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  type: 'button',
                  disabled: refreshing,
                  onClick: refresh,
                  children: refreshing
                    ? jsx(GlyphSpinner, {})
                    : jsx('span', { 'aria-hidden': true, children: '⟳' })
                })
              })
            ]
          })
        ]
      }),

      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-xs',
        children: [
          chip('all', t('filterAll', counts.total)),
          chip('enabled', t('filterEnabled', counts.enabled)),
          chip('disabled', t('filterDisabled', counts.total - counts.enabled)),
          chip('desktop', t('filterDesktop', counts.desktop)),
          chip('updates', t('filterUpdates', counts.updates)),
          jsx('div', { className: 'flex-1' }),
          jsx('input', {
            value: query,
            onChange: event => setQuery(event.target.value),
            placeholder: t('search'),
            'aria-label': t('search'),
            className: cn(INPUT_CLASS, 'w-56')
          })
        ]
      }),

      installOpen
        ? jsxs('div', {
            className:
              'flex min-w-0 flex-col gap-2 rounded-md border border-(--ui-border) bg-(--ui-bg-secondary) p-3',
            children: [
              jsx('div', { className: 'text-sm font-medium', children: t('gitTitle') }),
              jsxs('div', {
                className: 'flex min-w-0 flex-wrap items-end gap-2',
                children: [
                  jsxs('label', {
                    className: 'flex min-w-0 flex-1 flex-col gap-1 text-xs',
                    children: [
                      jsx('span', { className: MUTED, children: t('gitRepo') }),
                      jsx('input', {
                        value: installRepo,
                        onChange: event => setInstallRepo(event.target.value),
                        placeholder: t('gitRepoPlaceholder'),
                        'aria-label': t('gitRepo'),
                        className: cn(INPUT_CLASS, 'w-full')
                      })
                    ]
                  }),
                  jsxs('label', {
                    className: 'flex w-64 flex-col gap-1 text-xs',
                    children: [
                      jsx('span', { className: MUTED, children: t('gitRef') }),
                      jsx('input', {
                        value: installRef,
                        onChange: event => setInstallRef(event.target.value),
                        placeholder: t('gitRefPlaceholder'),
                        'aria-label': t('gitRef'),
                        spellCheck: false,
                        className: cn(INPUT_CLASS, 'w-full font-mono')
                      })
                    ]
                  }),
                  jsx(Button, {
                    size: 'sm',
                    variant: 'outline',
                    type: 'button',
                    disabled: inspect.status === 'checking',
                    onClick: runInspect,
                    children: t('check')
                  })
                ]
              }),
              inspectPanel()
            ]
          })
        : null,

      scan
        ? jsxs('div', {
            className: 'flex flex-col gap-2 rounded-md border border-(--ui-danger) p-3 text-xs',
            children: [
              jsx('div', { className: 'text-sm font-medium', children: t('scanTitle') }),
              scan.verdict
                ? jsx('div', { className: MUTED, children: t('scanVerdict', scan.verdict) })
                : null,
              scan.findings.length
                ? jsxs('div', {
                    className: 'flex flex-col gap-0.5',
                    children: [
                      jsx('div', { className: MUTED, children: t('scanFindings') }),
                      ...scan.findings.map((finding, index) =>
                        jsx('div', { className: 'break-words', children: String(finding) }, index)
                      )
                    ]
                  })
                : null,
              jsxs('div', {
                className: 'flex flex-wrap items-center gap-2',
                children: [
                  scan.verdict === 'caution'
                    ? jsx(Button, {
                        size: 'xs',
                        variant: 'destructive',
                        type: 'button',
                        disabled: busyName === scan.row.name,
                        onClick: () => {
                          const target = scan
                          setScan(null)
                          void runUpdate(target.row, {
                            force: true,
                            ...(target.accept ? { accept_capabilities: true } : {})
                          })
                        },
                        children: t('stillUpdate')
                      })
                    : null,
                  jsx(Button, {
                    size: 'xs',
                    variant: 'ghost',
                    type: 'button',
                    onClick: () => setScan(null),
                    children: t('close')
                  })
                ]
              })
            ]
          })
        : null,

      bulkResult
        ? jsxs('div', {
            className: 'flex flex-col gap-1 rounded-md border border-(--ui-border) p-3 text-xs',
            children: [
              ...bulkResult.results.map((result, index) =>
                jsxs(
                  'div',
                  {
                    className: 'flex min-w-0 gap-2',
                    children: [
                      jsx('span', {
                        className: 'w-40 shrink-0 truncate font-medium',
                        children: result.name
                      }),
                      jsx('span', {
                        className:
                          result.status === 'failed' || result.status === 'needs_review'
                            ? DANGER
                            : MUTED,
                        children: t(
                          result.status === 'updated'
                            ? 'statusUpdated'
                            : result.status === 'current'
                              ? 'statusCurrent'
                              : result.status === 'needs_review'
                                ? 'statusNeedsReview'
                                : 'statusFailed'
                        )
                      }),
                      result.detail
                        ? jsx('span', {
                            className: `min-w-0 flex-1 break-words ${MUTED}`,
                            children: result.detail
                          })
                        : null
                    ]
                  },
                  `result-${index}`
                )
              ),
              bulkResult.skipped.length
                ? jsxs('div', {
                    className: 'mt-1 flex flex-col gap-1 border-t border-(--ui-border) pt-1',
                    children: [
                      jsx('div', { className: MUTED, children: t('skippedLabel') }),
                      ...bulkResult.skipped.map((skip, index) =>
                        jsxs(
                          'div',
                          {
                            className: 'flex min-w-0 gap-2',
                            children: [
                              jsx('span', {
                                className: 'w-40 shrink-0 truncate font-medium',
                                children: skip.name
                              }),
                              jsx('span', {
                                className: `min-w-0 flex-1 break-words ${MUTED}`,
                                children: skip.reason
                              })
                            ]
                          },
                          `skip-${index}`
                        )
                      )
                    ]
                  })
                : null,
              !bulkResult.results.length && !bulkResult.skipped.length
                ? jsx('div', { className: MUTED, children: t('updateAllNoResult') })
                : null,
              bulkResult.results.some(result => result.status === 'needs_review')
                ? jsx('div', { className: DANGER, children: t('updateAllReviewHint') })
                : null,
              jsx('div', {
                className: 'flex justify-end',
                children: jsx(Button, {
                  size: 'xs',
                  variant: 'ghost',
                  type: 'button',
                  onClick: () => setBulkResult(null),
                  children: t('close')
                })
              })
            ]
          })
        : null,

      loadError
        ? jsx('div', { className: `text-xs ${DANGER}`, children: t('loadFailed', loadError) })
        : null,
      actionError ? jsx('div', { className: `text-xs ${DANGER}`, children: actionError }) : null,

      body(),

      jsx(ConfirmDialog, {
        open: Boolean(pendingRemove),
        onClose: () => setPendingRemove(null),
        onConfirm: doRemove,
        title: pendingRemove
          ? pendingRemove.desktop_only
            ? t('removeDesktopTitle', pendingRemove.name)
            : t('removeTitle', pendingRemove.name)
          : '',
        description: pendingRemove
          ? pendingRemove.desktop_only
            ? t('removeDesktopBody', pendingRemove.name)
            : t('removeBody', pendingRemove.name)
          : '',
        confirmLabel:
          pendingRemove && pendingRemove.desktop_only ? t('uninstallDesktop') : t('uninstall'),
        destructive: true
      }),
      jsx(ConfirmDialog, {
        open: Boolean(consent),
        onClose: () => setConsent(null),
        onConfirm: async () => {
          const target = consent
          if (!target) return
          setConsent(null)
          await runUpdate(target.row, { accept_capabilities: true })
        },
        title: consent ? t('consentTitle', consent.row.name) : '',
        description: consent
          ? `${t('consentBody')}\n\n${consent.lines.map(line => `• ${line}`).join('\n')}`
          : '',
        confirmLabel: t('consentGo')
      })
    ]
  })
}

let navLabel = ''
let disposeNav = null

/**
 * (Re-)register the sidebar entry, but only when the resolved label actually
 * changed. At `register()` time the app has not necessarily hydrated the user's
 * locale yet, so the first label can come out English while the rest of the app
 * is Chinese — hence the retries and the page-level nudge below.
 */
function syncNavLabel(ctx) {
  if (!ctx) return
  let label = ''
  try {
    label = ctx.i18n.t('nav')
  } catch {
    return
  }
  if (!label || (disposeNav && label === navLabel)) return
  if (disposeNav) {
    try {
      disposeNav()
    } catch {}
  }
  navLabel = label
  disposeNav = ctx.register({
    id: 'nav',
    area: SIDEBAR_NAV_AREA,
    data: { path: PAGE_PATH, label, codicon: 'extensions' }
  })
}

export default {
  id: ID,
  name: 'Plugin manager',
  register(ctx) {
    pluginCtx = ctx
    ctx.i18n.register(MESSAGES)
    hydrate()
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: PAGE_PATH },
      render: () => jsx(ManagerPage, {})
    })

    syncNavLabel(ctx)
    // 0.22+ has `onLocaleChange`, which covers language switches. The one delayed
    // retry stays for the first paint: `register()` can run before the app has
    // hydrated `display.language`, and then the label came out English.
    if (typeof ctx.i18n.onLocaleChange === 'function') {
      ctx.i18n.onLocaleChange(() => syncNavLabel(ctx))
    }
    setTimeout(() => syncNavLabel(ctx), 400)
  }
}
