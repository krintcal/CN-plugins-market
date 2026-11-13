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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'cn-plugins-market'
const PAGE_PATH = '/cn-plugins-market'
/** The backend surface this page drives (install_desktop, remove_desktop, inspect). */
const MIN_HERMES = '0.22.5'
const PREFS_KEY = 'prefs'
const REF_RE = /^[0-9a-f]{40}$/i
const FILTERS = ['all', 'enabled', 'disabled', 'desktop', 'updates']

const INPUT_CLASS =
  'h-7 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-input) px-2 outline-none ' +
  'text-[length:var(--conversation-caption-font-size)]'
const BADGE_CLASS =
  'shrink-0 rounded border border-(--ui-stroke-tertiary) px-1.5 py-px ' +
  'text-[0.65rem] text-(--ui-text-tertiary)'
const PANEL_CLASS =
  'flex flex-col gap-2 rounded-lg border border-(--ui-stroke-tertiary) p-3'
const ERROR_BAR =
  'rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 ' +
  'text-[length:var(--conversation-caption-font-size)] text-destructive'
const GRID_LABEL = 'text-(--ui-text-tertiary)'
const CAPTION = 'text-[length:var(--conversation-caption-font-size)]'
const MUTED = 'text-(--ui-text-tertiary)'
const DANGER = 'text-destructive'

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const MESSAGES = {
  en: {
    nav: 'Plugin manager',
    inspectRefMismatch: 'The requested ref differs from the inspected commit. This gateway can only inspect the current source revision.',
    devGitUnavailable: 'Git metadata is unavailable through the desktop bridge',
    devStandalone: 'Standalone desktop plugin; no separate source copy',
    devCopyIncomplete: 'Cannot compare incomplete file reads',
    ambiguousActions: 'Several agent entries share this name. Update and uninstall require an unambiguous name.',
    title: 'Plugin manager',
    statusLine: (dev, installed, bundled, updates) =>
      `${dev} developing · ${installed} installed · ${bundled} built-in · ${updates} update${updates === 1 ? '' : 's'}`,
    devGroup: 'In development',
    installedGroup: 'Installed',
    bundledGroup: 'Built-in',
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
    emptyFiltered: 'No plugins match this filter.',
    clearFilters: 'Clear filters',
    sourceBundled: 'Built-in',
    sourceGit: 'Git',
    sourceCatalog: 'From catalog',
    sourceLocal: 'Local',
    sourceLabel: 'Source',
    portableBadge: 'Portable',
    portableTip: 'Agent Plugins v1 format — it can be moved to another Hermes as-is.',
    pinnedBadge: sha => `Pinned @ ${sha}`,
    pinnedTip: 'It will not follow updates until it is re-pinned.',
    statusEnabled: 'enabled',
    statusDisabled: 'disabled',
    detailStatus: 'Status',
    detailSourceSection: 'Source & updates',
    detailPathSection: 'Path',
    detailActions: 'Actions',
    selectHint: 'Pick a plugin on the left to see its details.',
    halfAgent: 'agent half',
    halfDesktop: 'desktop half',
    halfYes: 'yes',
    halfNo: 'no',
    requiresVersionWarn: version => `needs ≥${version} (this app is older)`,
    update: 'Update',
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
    copyPath: 'Copy path',
    copied: 'Copied',
    openDir: 'Open folder',
    openDirFailed: 'Could not open that folder',
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
    devMark: 'Mark as mine',
    devUnmark: 'Not mine',
    devState: 'Dev',
    devGitBranch: 'git',
    devCopySynced: 'In sync',
    devCopyPending: 'Needs sync',
    devCopyNoSource: 'Source missing',
    devCopyMissing: 'Running copy missing',
    devCopyClaimed: 'Claimed by Hermes (opt-in) — hidden from the sidebar by default',
    devReread: 'Re-read',
    devLoading: 'Reading…',
    devBadPath: 'Path not usable',
    devRunCopy: 'Running copy',
    loading: 'Reading installed plugins…',
    loadFailed: message => `Could not read the installed list: ${message}`,
    retry: 'Retry'
  },
  zh: {
    nav: '插件管理',
    inspectRefMismatch: 'Ref 与检查到的提交不同；当前网关只能检查源的当前版本。',
    devGitUnavailable: '桌面桥不开放 Git 元数据读取',
    devStandalone: '独立桌面插件，没有单独的源副本',
    devCopyIncomplete: '文件读取不完整，无法比较',
    ambiguousActions: '多个 agent 条目使用同一名称，更新和卸载需要无歧义的名称。',
    title: '插件管理',
    statusLine: (dev, installed, bundled, updates) =>
      `${dev} 个开发中 · ${installed} 个另外装的 · ${bundled} 个内置 · ${updates} 个有更新`,
    devGroup: '开发中（我自己的）',
    installedGroup: '另外安装的',
    bundledGroup: '内置',
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
    emptyFiltered: '没有符合条件的插件',
    clearFilters: '清除筛选',
    sourceBundled: '内置',
    sourceGit: 'Git',
    sourceCatalog: '装自目录',
    sourceLocal: '本地',
    sourceLabel: '来源',
    portableBadge: '便携',
    portableTip: 'Agent Plugins v1 格式，可原样搬到别的 Hermes。',
    pinnedBadge: sha => `固定 @ ${sha}`,
    pinnedTip: '重新固定前不会跟随更新。',
    statusEnabled: '已启用',
    statusDisabled: '已停用',
    detailStatus: '状态',
    detailSourceSection: '来源与更新',
    detailPathSection: '路径',
    detailActions: '操作',
    selectHint: '在左边选一个插件查看详情',
    halfAgent: 'agent 半边',
    halfDesktop: 'desktop 半边',
    halfYes: '有',
    halfNo: '无',
    requiresVersionWarn: version => `需 ≥${version}（本机偏低）`,
    update: '更新',
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
    copyPath: '复制路径',
    copied: '已复制',
    openDir: '打开目录',
    openDirFailed: '打不开这个目录',
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
    devMark: '标记为我开发的',
    devUnmark: '不算我开发的',
    devState: '开发态',
    devGitBranch: 'git',
    devCopySynced: '已同步',
    devCopyPending: '待同步',
    devCopyNoSource: '源缺失',
    devCopyMissing: '运行副本不存在',
    devCopyClaimed: '已被 Hermes 认领（opt-in），侧边栏默认不显示',
    devReread: '重读',
    devLoading: '读取中…',
    devBadPath: '路径不可用',
    devRunCopy: '运行副本',
    loading: '正在读取已安装插件…',
    loadFailed: message => `读不到已安装列表：${message}`,
    retry: '重试'
  },
  'zh-hant': {
    nav: '外掛管理',
    inspectRefMismatch: 'Ref 與檢查到的提交不同；目前閘道只能檢查來源的目前版本。',
    devGitUnavailable: '桌面橋不開放 Git 中繼資料讀取',
    devStandalone: '獨立桌面外掛，沒有單獨的來源副本',
    devCopyIncomplete: '檔案讀取不完整，無法比較',
    ambiguousActions: '多個 agent 項目使用相同名稱，更新與卸載需要無歧義的名稱。',
    title: '外掛管理',
    statusLine: (dev, installed, bundled, updates) =>
      `${dev} 個開發中 · ${installed} 個另外裝的 · ${bundled} 個內建 · ${updates} 個有更新`,
    devGroup: '開發中（我自己的）',
    installedGroup: '另外安裝的',
    bundledGroup: '內建',
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
    emptyFiltered: '沒有符合條件的外掛',
    clearFilters: '清除篩選',
    sourceBundled: '內建',
    sourceGit: 'Git',
    sourceCatalog: '裝自目錄',
    sourceLocal: '本機',
    sourceLabel: '來源',
    portableBadge: '便攜',
    portableTip: 'Agent Plugins v1 格式，可原樣搬到別的 Hermes。',
    pinnedBadge: sha => `固定 @ ${sha}`,
    pinnedTip: '重新固定前不會跟隨更新。',
    statusEnabled: '已啟用',
    statusDisabled: '已停用',
    detailStatus: '狀態',
    detailSourceSection: '來源與更新',
    detailPathSection: '路徑',
    detailActions: '操作',
    selectHint: '在左邊選一個外掛查看詳情',
    halfAgent: 'agent 半邊',
    halfDesktop: 'desktop 半邊',
    halfYes: '有',
    halfNo: '無',
    requiresVersionWarn: version => `需 ≥${version}（本機偏低）`,
    update: '更新',
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
    copyPath: '複製路徑',
    copied: '已複製',
    openDir: '開啟目錄',
    openDirFailed: '無法開啟這個目錄',
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
    devMark: '標記為我開發的',
    devUnmark: '不算我開發的',
    devState: '開發態',
    devGitBranch: 'git',
    devCopySynced: '已同步',
    devCopyPending: '待同步',
    devCopyNoSource: '來源缺失',
    devCopyMissing: '執行副本不存在',
    devCopyClaimed: '已被 Hermes 認領（opt-in），側邊欄預設不顯示',
    devReread: '重讀',
    devLoading: '讀取中…',
    devBadPath: '路徑不可用',
    devRunCopy: '執行副本',
    loading: '正在讀取已安裝外掛…',
    loadFailed: message => `讀不到已安裝清單：${message}`,
    retry: '重試'
  }
}

// ---------------------------------------------------------------------------
// module state
// ---------------------------------------------------------------------------

let pluginCtx = null
/** Bumped when a stored preference stops meaning what it used to: an old filter
 *  value from 1.x (e.g. 'disabled') would otherwise survive a redesign and hide
 *  every row, which reads as "the page is broken". */
const PREFS_VERSION = 3
let prefs = { filter: 'all', v: PREFS_VERSION }
/** Dev and installed start open, built-ins start folded; all persist. */
const SECTIONS_VERSION = 2
let sections = { v: SECTIONS_VERSION, dev: true, installed: true, bundled: false }
/** Last successful `plugins.manage list` — the gateway needs ~3 s for 73 plugins,
 *  so the page paints this immediately and refreshes behind it. */
const ROWS_CACHE_KEY = 'rows.v3'
const ROWS_VERSION = 3
/** Manual "this one is mine" corrections, by name. */
const DEV_OVERRIDES_KEY = 'dev.overrides'
let devOverrides = { on: [], off: [] }
let rowsCache = { at: 0, plugins: [] }
let listFlight = null

/** Share the expensive request across simultaneous mounts/refreshes. */
async function requestList(fresh = false) {
  if (fresh && listFlight) {
    try { await listFlight } catch {}
  }
  if (!listFlight) {
    listFlight = Promise.resolve().then(() => host.request('plugins.manage', { action: 'list' }, 60000))
      .finally(() => { listFlight = null })
  }
  return listFlight
}

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
  if (stored && typeof stored === 'object') {
    // A version bump throws away the old choices instead of translating them.
    prefs = stored.v === PREFS_VERSION ? { ...prefs, ...stored } : { filter: 'all', v: PREFS_VERSION }
  }
  if (!FILTERS.includes(prefs.filter)) prefs.filter = 'all'
  const storedSections = readStored('sections')
  // Old records had no version and could carry `bundled: true` from a previous
  // design, which showed 63 built-ins the user never asked to expand.
  if (storedSections && storedSections.v === SECTIONS_VERSION) {
    sections = {
      v: SECTIONS_VERSION,
      dev: storedSections.dev !== false,
      installed: storedSections.installed !== false,
      bundled: storedSections.bundled === true
    }
  }
  // Persist the sanitised values so a stale key never comes back on next reload.
  writeStored(PREFS_KEY, prefs)
  const overrides = readStored(DEV_OVERRIDES_KEY)
  if (overrides && Array.isArray(overrides.on) && Array.isArray(overrides.off)) {
    devOverrides = {
      on: overrides.on.filter(name => typeof name === 'string'),
      off: overrides.off.filter(name => typeof name === 'string')
    }
  }
  const cached = readStored(ROWS_CACHE_KEY)
  if (cached && cached.v === ROWS_VERSION && Array.isArray(cached.plugins)) {
    rowsCache = {
      at: Number(cached.at) || 0,
      plugins: normalizeRows(cached.plugins)
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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
  const source = String(row.source || '')
  if (source.startsWith('git')) return 'sourceGit'
  if (source.startsWith('catalog')) return 'sourceCatalog'
  if (source === 'bundled') return 'sourceBundled'
  return 'sourceLocal'
}

/** Canonical registry identity, shared by selection, errors and React keys. */
function rowKeyOf(row) {
  return JSON.stringify(row.key ? ['agent', row.key] : ['desktop', row.name])
}

function normalizeRows(rows) {
  const unique = new Map()
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !row.name.trim() ||
        typeof row.key !== 'string' || !row.key || typeof row.source !== 'string') continue
    const text = Object.fromEntries(['version', 'description', 'pinned_sha', 'catalog_version',
      'catalog_sha', 'update_target', 'catalog_name'].map(key => [key, typeof row[key] === 'string' ? row[key] : '']))
    unique.set(rowKeyOf(row), {
      ...row,
      ...text,
      install_dir: typeof row.install_dir === 'string' ? row.install_dir : '',
      status: typeof row.status === 'string' ? row.status : '',
      has_desktop_half: row.has_desktop_half === true,
      update_available: row.update_available === true,
      portable: row.portable === true
    })
  }
  return [...unique.values()]
}

/**
 * Install provenance is not authorship, so this is a *default guess* the user can
 * flip per row (`dev.overrides`). The guess: hand-placed desktop halves, local
 * installs that ship a desktop page, and plain git checkouts that no catalog pinned
 * (a pinned SHA means the catalog's index installed it). `.git/config` is not
 * readable through the bridge, so a remote-based check is impossible here.
 */
function looksLikeOwnWork(row) {
  if (row.source === 'desktop') return true
  if (row.source === 'user' && row.has_desktop_half) return true
  return row.source === 'git' && !row.pinned_sha
}

function detectDev(plugins) {
  return new Set(plugins
    .filter(row => row.source !== 'bundled' && !devOverrides.off.includes(row.name))
    .filter(row => devOverrides.on.includes(row.name) || looksLikeOwnWork(row))
    .map(row => row.name))
}

function canManageAgent(row, rows) {
  return Boolean(row.key && row.source !== 'bundled' &&
    rows.filter(other => other.key && other.name === row.name).length === 1)
}

function inspectedParams(inspection, identifier, ref, half) {
  if (inspection.status !== 'done' || inspection.identifier !== identifier || inspection.ref !== ref ||
      !inspection.data?.[half] || !REF_RE.test(inspection.data.sha || '')) return null
  const sha = inspection.data.sha.toLowerCase()
  // inspect has no ref support. Never imply that an arbitrary ref was reviewed.
  if (ref && ref.toLowerCase() !== sha) return null
  return half === 'desktop'
    ? { action: 'install_desktop', identifier, ref: sha }
    : { action: 'install', identifier, enable: true, ...(ref ? { ref: sha } : { inspected_sha: sha }) }
}

/** Label/value pair for the detail panel's two-column grid. */
function gridPair(label, value, key) {
  return [
    jsx('span', { className: GRID_LABEL, children: label }, `${key}-label`),
    jsx('span', { className: 'min-w-0 break-words', children: value }, `${key}-value`)
  ]
}

// ---------------------------------------------------------------------------
// dev state (git / running copy)
// ---------------------------------------------------------------------------

function isSafeName(name) {
  const value = String(name || '')
  return Boolean(value && !value.startsWith('.') && !/[\\/:\0-\x1f]/.test(value) &&
    !/[. ]$/.test(value) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value))
}

function joinPath(base, ...parts) {
  const value = String(base || '')
  const sep = value.includes('\\') ? '\\' : '/'
  return [value.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

function byteLength(text) {
  const value = String(text || '')
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length
  } catch {}
  return value.length
}

/** Compare ignoring the marker line and any trailing whitespace/newlines. */
function normalizeForCompare(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('// synced copy of'))
    .map(line => line.replace(/\s+$/, ''))
  let start = 0
  let end = lines.length
  while (start < end && !lines[start]) start += 1
  while (end > start && !lines[end - 1]) end -= 1
  return lines.slice(start, end).join('\n')
}

function compareCopy(source, running) {
  if (source.truncated || running.truncated) return { kind: 'error', error: '' }
  if (!source.ok) return { kind: 'noSource' }
  if (!running.ok) return { kind: 'missing' }
  const runningBytes = byteLength(running.text)
  if (normalizeForCompare(source.text) === normalizeForCompare(running.text)) {
    return { kind: 'synced', bytes: runningBytes }
  }
  return {
    kind: 'pending',
    bytes: runningBytes,
    diff: Math.abs(byteLength(source.text) - runningBytes)
  }
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function readMaybeText(path) {
  const desktop = bridge()
  if (!desktop || typeof desktop.readFileText !== 'function' || !path) return { ok: false }
  try {
    // hermes:readFileText answers `{ text, byteSize, truncated }` — treating it as
    // a bare string made every read look like a missing file ("源缺失").
    const res = await bridgeCall(() => desktop.readFileText(path))
    if (typeof res === 'string') return { ok: true, text: res }
    if (res && typeof res.text === 'string') {
      return { ok: true, text: res.text, truncated: Boolean(res.truncated), byteSize: res.byteSize }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}

async function bridgeCall(call) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop bridge timed out')), 10000) })
    ])
  } finally {
    clearTimeout(timer)
  }
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

  const [rows, setRows] = useState(() => rowsCache.plugins)
  const [status, setStatus] = useState(() => (rowsCache.plugins.length ? 'ready' : 'loading'))
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const [desktopDirs, setDesktopDirs] = useState(() => new Map())
  const [appVersion, setAppVersion] = useState('')
  const [filter, setFilter] = useState(prefs.filter)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(() => ({ ...sections }))
  const [selectedKey, setSelectedKey] = useState('')
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
  const [devCache, setDevCache] = useState({})
  const devCacheRef = useRef({})
  const refreshFlight = useRef(null)
  const mutationRef = useRef(false)
  const inspectEpoch = useRef(0)
  const devEpoch = useRef(0)
  const [overrideVersion, setOverrideVersion] = useState(0)
  const isMutating = Boolean(busyName || bulkUpdating || installingHalf)

  const setDev = useCallback((name, entry) => {
    const next = { ...devCacheRef.current, [name]: entry }
    devCacheRef.current = next
    setDevCache(next)
  }, [])

  const readDesktopDirs = useCallback(async () => {
    const desktop = bridge()
    if (!desktop || typeof desktop.desktopPluginsRoot !== 'function' || typeof desktop.readDir !== 'function') return null
    try {
      const root = await bridgeCall(() => desktop.desktopPluginsRoot())
      if (!root) return null
      const res = await bridgeCall(() => desktop.readDir(root))
      if (!Array.isArray(res?.entries)) return null
      const entries = await Promise.all(res.entries.filter(entry => entry?.isDirectory &&
        typeof entry.name === 'string' && isSafeName(entry.name))
        .map(async entry => {
          const dir = joinPath(root, entry.name)
          const marker = await readMaybeText(joinPath(dir, '.hermes-package.json'))
          let owner = ''
          try { owner = JSON.parse(marker.text || '{}').package || '' } catch {}
          return [entry.name, { dir, owner, claimed: marker.ok }]
        }))
      return new Map(entries)
    } catch {
      return null
    }
  }, [])

  const refresh = useCallback(async (afterMutation = false) => {
    // A mutation must not reuse a snapshot that started before it completed.
    if (refreshFlight.current) {
      await refreshFlight.current
      if (afterMutation !== true) return
    }
    const pending = (async () => {
      setRefreshing(true)
      try {
        const [res] = await Promise.all([requestList(afterMutation === true), readDesktopDirs().then(dirs => {
          if (dirs) setDesktopDirs(dirs)
        })])
        if (!res || !Array.isArray(res.plugins)) throw new Error('list returned no plugins array')
        const plugins = normalizeRows(res.plugins)
        if (res.plugins.some(row => !row || typeof row.key !== 'string' || !row.key ||
            typeof row.name !== 'string' || !row.name.trim() || typeof row.source !== 'string')) {
          throw new Error('list returned invalid plugin rows')
        }
        setRows(plugins)
        setLoadError('')
        setStatus('ready')
        rowsCache = { v: ROWS_VERSION, at: Date.now(), plugins }
        writeStored(ROWS_CACHE_KEY, rowsCache)
        devEpoch.current += 1
        devCacheRef.current = {}
        setDevCache({})
      } catch (e) {
        setLoadError(errorMessage(e))
        setStatus(rowsCache.plugins.length ? 'ready' : 'error')
      } finally {
        setRefreshing(false)
      }
    })()
    refreshFlight.current = pending
    try { await pending } finally {
      if (refreshFlight.current === pending) refreshFlight.current = null
    }
  }, [readDesktopDirs])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const notify = useCallback((kind, message) => {
    try {
      host.notify({ kind, message })
    } catch {}
  }, [])

  const loadDev = useCallback(
    async (row, force = false) => {
      const name = rowKeyOf(row)
      const epoch = devEpoch.current
      if (!force && devCacheRef.current[name]) return
      setDev(name, { status: 'loading' })
      try {
        const desktop = bridge()
        let root = ''
        if (desktop && typeof desktop.desktopPluginsRoot === 'function') {
          try {
            root = await bridgeCall(() => desktop.desktopPluginsRoot())
          } catch {
            root = ''
          }
        }
        const nameOk = isSafeName(row.desktop_name || row.name)
        const dir = String(row.install_dir || '')
        const targetDir = root && nameOk ? joinPath(root, row.desktop_name || row.name) : ''
        const sourcePath = dir && !row.desktop_only ? joinPath(dir, 'desktop', 'plugin.js') : ''
        const runningPath = targetDir ? joinPath(targetDir, 'plugin.js') : ''
        const packagePath = targetDir ? joinPath(targetDir, '.hermes-package.json') : ''
        const [source, rootSource, running, pkg] = await Promise.all([
          readMaybeText(sourcePath),
          dir && !row.desktop_only ? readMaybeText(joinPath(dir, 'plugin.js')) : Promise.resolve({ ok: false }),
          readMaybeText(runningPath),
          readMaybeText(packagePath)
        ])
        const copy = row.desktop_only ? { kind: 'standalone' }
          : runningPath ? compareCopy(source.ok ? source : rootSource, running)
          : { kind: 'error', error: t('devBadPath') }
        if (epoch === devEpoch.current) setDev(name, { status: 'ready', copy, claimed: Boolean(pkg.ok) })
      } catch (error) {
        if (epoch === devEpoch.current) setDev(name, { status: 'error', error: errorMessage(error) })
      }
    },
    [setDev, t]
  )

  useEffect(() => {
    let alive = true
    const desktop = bridge()
    if (!desktop || typeof desktop.getVersion !== 'function') return () => {}
    bridgeCall(() => desktop.getVersion())
      .then(info => {
        if (alive && info && typeof info.appVersion === 'string') setAppVersion(info.appVersion)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    // Keep `v`: without it the next load sees an unversioned record and throws
    // the user's filter away on every launch.
    prefs = { filter, v: PREFS_VERSION }
    writeStored(PREFS_KEY, prefs)
  }, [filter])

  /** Pair desktop folders by package marker; aliases alone do not prove ownership. */
  const allRows = useMemo(() => {
    const seen = new Set()
    const nameCounts = new Map()
    for (const row of rows) {
      if (row.source !== 'bundled') nameCounts.set(row.name, (nameCounts.get(row.name) || 0) + 1)
    }
    const merged = rows.map(row => {
      const matches = [...desktopDirs].filter(([name, info]) =>
        row.source !== 'bundled' && nameCounts.get(row.name) === 1 &&
        (info.owner ? info.owner === row.name : name === row.name))
      const match = matches.length === 1 ? matches[0] : null
      if (match) seen.add(match[0])
      return { ...row, desktop_name: match?.[0] || '', desktop_claimed: Boolean(match?.[1].claimed),
        has_desktop_half: row.has_desktop_half || Boolean(match) }
    })
    for (const [name, info] of desktopDirs) {
      if (seen.has(name)) continue
      merged.push({ name, key: '', version: '', description: '', source: 'desktop',
        status: '', portable: false, has_desktop_half: true, install_dir: info.dir,
        desktop_name: name, desktop_claimed: info.claimed, desktop_only: true })
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name) || rowKeyOf(a).localeCompare(rowKeyOf(b)))
  }, [rows, desktopDirs])

  const devSet = useMemo(() => detectDev(allRows), [allRows, overrideVersion])
  const toggleDev = useCallback(row => {
    const name = row.name
    devOverrides = devSet.has(name)
      ? { on: devOverrides.on.filter(x => x !== name), off: [...new Set([...devOverrides.off, name])] }
      : { on: [...new Set([...devOverrides.on, name])], off: devOverrides.off.filter(x => x !== name) }
    writeStored(DEV_OVERRIDES_KEY, devOverrides)
    setOverrideVersion(value => value + 1)
    haptic('tap')
  }, [devSet])

  /** Three sections: my own checkouts, everything else I installed, then built-ins. */
  const mineRows = useMemo(() => allRows.filter(row => row.source !== 'bundled'), [allRows])
  const bundledRows = useMemo(() => allRows.filter(row => row.source === 'bundled'), [allRows])
  const devRows = useMemo(() => mineRows.filter(row => devSet.has(row.name)), [mineRows, devSet])
  const installedRows = useMemo(
    () => mineRows.filter(row => !devSet.has(row.name)),
    [mineRows, devSet]
  )

  const counts = useMemo(() => {
    let enabled = 0
    let updates = 0
    let desktop = 0
    for (const row of mineRows) {
      if (row.status === 'enabled') enabled += 1
      if (row.update_available) updates += 1
      if (row.has_desktop_half) desktop += 1
    }
    return {
      mine: mineRows.length,
      dev: devRows.length,
      installed: installedRows.length,
      bundled: bundledRows.length,
      enabled,
      updates,
      desktop
    }
  }, [mineRows, bundledRows, devRows, installedRows])

  const allUpdates = useMemo(
    () => allRows.filter(row => row.update_available).length,
    [allRows]
  )

  /** Chips and search only narrow `mine`; the built-in section stays whole. */
  const filteredMine = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return mineRows.filter(row => {
      if (needle && !String(row.name || '').toLowerCase().includes(needle)) return false
      if (filter === 'enabled') return row.status === 'enabled'
      if (filter === 'disabled') return row.status !== 'enabled'
      if (filter === 'desktop') return Boolean(row.has_desktop_half)
      if (filter === 'updates') return Boolean(row.update_available)
      return true
    })
  }, [mineRows, filter, query])

  const filteredDev = useMemo(() => filteredMine.filter(row => devSet.has(row.name)), [filteredMine, devSet])
  const filteredInstalled = useMemo(() => filteredMine.filter(row => !devSet.has(row.name)), [filteredMine, devSet])

  const filtering = filter !== 'all' || Boolean(query.trim())

  const currentRow = useMemo(
    () => allRows.find(row => rowKeyOf(row) === selectedKey) || null,
    [allRows, selectedKey]
  )

  /** The left list decides what can be selected; built-ins count even while folded. */
  const selectableRows = useMemo(
    () => [...filteredDev, ...filteredInstalled, ...bundledRows],
    [filteredDev, filteredInstalled, bundledRows]
  )

  useEffect(() => {
    const fallback = selectableRows[0]
    if (!selectableRows.some(row => rowKeyOf(row) === selectedKey)) setSelectedKey(fallback ? rowKeyOf(fallback) : '')
  }, [selectedKey, selectableRows])

  useEffect(() => {
    if (!currentRow?.has_desktop_half) return
    if (devCacheRef.current[rowKeyOf(currentRow)]) return
    void loadDev(currentRow)
  }, [currentRow, loadDev, devCache])

  const versionWarn = versionParts(appVersion) && !satisfies(`>=${MIN_HERMES}`, appVersion)

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
          }).catch(() => notify('error', t('openDirFailed')))
        }
      } catch {
        notify('error', t('openDirFailed'))
      }
    },
    [notify, t]
  )

  const toggleRow = useCallback(
    async (row, enable) => {
      if (!row.key || mutationRef.current) return
      mutationRef.current = true
      haptic('tap')
      setBusyName(rowKeyOf(row))
      try {
        const res = await host.request(
          'plugins.manage',
          { action: 'toggle', key: row.key, enable },
          120000
        )
        if (!res || !res.ok) throw new Error((res && res.error) || 'toggle rejected')
        notify('success', enable ? t('enabledOk', row.name) : t('disabledOk', row.name))
        await refresh(true)
      } catch (e) {
        notify('error', t('toggleFailed', errorMessage(e)))
      } finally {
        mutationRef.current = false
        setBusyName('')
      }
    },
    [notify, refresh, t]
  )

  const runUpdate = useCallback(
    async (row, options = {}) => {
      if (!canManageAgent(row, allRows) || mutationRef.current) return
      mutationRef.current = true
      setBusyName(rowKeyOf(row))
      setRowError(null)
      setConsent(null)
      setScan(null)
      try {
        const res = await host.request(
          'plugins.manage',
          { action: 'update', name: row.name, ...options },
          300000
        )
        if (res && res.consent_required) {
          setConsent({ row, options, lines: Array.isArray(res.delta_lines) ? res.delta_lines : [] })
          return
        }
        if (res && res.scan_blocked) {
          setScan({
            row,
            verdict: res.scan_verdict || '',
            findings: Array.isArray(res.scan_findings) ? res.scan_findings : [],
            options
          })
          return
        }
        if (!res || !res.ok) throw new Error((res && res.error) || 'update rejected')
        notify('success', res.unchanged ? t('updateUnchanged') : t('updatedOk', row.name))
        setConsent(null)
        setScan(null)
        await refresh(true)
      } catch (e) {
        const message = t('updateFailed', errorMessage(e))
        setRowError({ key: rowKeyOf(row), message })
        notify('error', message)
      } finally {
        mutationRef.current = false
        setBusyName('')
      }
    },
    [allRows, notify, refresh, t]
  )

  const runUpdateAll = useCallback(async () => {
    if (mutationRef.current) return
    mutationRef.current = true
    haptic('tap')
    setBulkUpdating(true)
    setActionError('')
    setBulkResult(null)
    try {
      const res = await host.request('plugins.manage', { action: 'update_all' }, 900000)
      if (!res || res.ok === false || !Array.isArray(res.results) || !Array.isArray(res.skipped) ||
          res.results.some(row => !row || typeof row.name !== 'string' || !['updated', 'current', 'failed', 'needs_review'].includes(row.status)) ||
          res.skipped.some(row => !row || typeof row.name !== 'string')) {
        throw new Error(res?.error || 'update_all returned invalid results')
      }
      const { results, skipped } = res
      setBulkResult({ results, skipped })
      const count = wanted => results.filter(r => r.status === wanted).length
      notify('success', t('updateAllDone', count('updated'), count('failed'), count('needs_review')))
      await refresh(true)
    } catch (e) {
      const message = t('updateAllFailed', errorMessage(e))
      setActionError(message)
      notify('error', message)
    } finally {
      mutationRef.current = false
      setBulkUpdating(false)
    }
  }, [notify, refresh, t])

  const runInspect = useCallback(async () => {
    if (mutationRef.current) return
    const epoch = ++inspectEpoch.current
    const identifier = installRepo.trim()
    const ref = installRef.trim()
    setActionError('')
    if (!identifier) return setInspect({ status: 'error', error: t('repoRequired') })
    if (ref && !REF_RE.test(ref)) return setInspect({ status: 'error', error: t('invalidRef') })
    setInspect({ status: 'checking' })
    try {
      const res = await host.request('plugins.manage', { action: 'inspect', identifier }, 600000)
      if (epoch !== inspectEpoch.current) return
      if (!res || !res.ok) throw new Error((res && res.error) || 'inspect rejected')
      if (!REF_RE.test(res.sha || '')) throw new Error('inspect returned no valid commit SHA')
      if (ref && ref.toLowerCase() !== res.sha.toLowerCase()) throw new Error(t('inspectRefMismatch'))
      setInspect({ status: 'done', identifier, ref, data: res })
    } catch (e) {
      if (epoch !== inspectEpoch.current) return
      setInspect({ status: 'error', error: t('inspectFailed', errorMessage(e)) })
    }
  }, [installRef, installRepo, t])

  const installHalf = useCallback(
    async half => {
      const identifier = installRepo.trim()
      const ref = installRef.trim()
      const params = inspectedParams(inspect, identifier, ref, half)
      if (mutationRef.current || !params) return
      mutationRef.current = true
      setInstallingHalf(half)
      setActionError('')
      try {
        const res = await host.request('plugins.manage', params, 900000)
        if (!res || !res.ok) {
          throw new Error([(res && res.error) || 'install rejected', ...extraDetails(res, t)].join(' · '))
        }
        notify('success', t('installedReload'))
        setInstallOpen(false)
        setInstallRepo('')
        setInstallRef('')
        setInspect({ status: 'idle' })
        await refresh(true)
      } catch (e) {
        const message = t(
          'installFailed',
          [errorMessage(e), ...extraDetails(e && (e.data || e), t)].filter(Boolean).join(' · ')
        )
        setInspect({ status: 'error', error: message })
        notify('error', message)
      } finally {
        mutationRef.current = false
        setInstallingHalf('')
      }
    },
    [inspect, installRef, installRepo, notify, refresh, t]
  )

  const doRemove = useCallback(async () => {
    const target = pendingRemove && pendingRemove.row
    if (!target || mutationRef.current) return
    const desktop = pendingRemove.mode === 'remove_desktop'
    if (desktop ? !target.desktop_name || target.desktop_claimed : !canManageAgent(target, allRows)) return
    mutationRef.current = true
    setBusyName(rowKeyOf(target))
    setActionError('')
    try {
      const params = desktop
        ? { action: 'remove_desktop', name: target.desktop_name }
        : { action: 'remove', name: target.name }
      const res = await host.request('plugins.manage', params, 300000)
      if (!res || !res.ok) throw new Error((res && res.error) || 'remove rejected')
      notify(
        'success',
        desktop ? t('removeDesktopDone', target.name) : t('uninstalled', target.name)
      )
      setPendingRemove(null)
      await refresh(true)
    } catch (e) {
      const message = t('removeFailed', errorMessage(e))
      notify('error', message)
      throw new Error(message)
    } finally {
      mutationRef.current = false
      setBusyName('')
    }
  }, [allRows, notify, pendingRemove, refresh, t])

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
          'rounded-full px-2.5 py-1 text-[length:var(--conversation-caption-font-size)] transition-colors',
          filter === id ? 'bg-accent text-foreground' : 'text-(--ui-text-tertiary) hover:text-foreground'
        ),
        children: label
      },
      id
    )

  const toggleSection = key => {
    haptic('tap')
    setExpanded(prev => {
      const next = { ...prev, [key]: !prev[key] }
      sections = { ...next, v: SECTIONS_VERSION }
      writeStored('sections', sections)
      return next
    })
  }

  const clearFilters = () => {
    setFilter('all')
    setQuery('')
  }

  const inspectPanel = () => {
    if (inspect.status === 'idle') return null
    if (inspect.status === 'checking') {
      return jsxs('div', {
        className: `flex items-center gap-2 ${CAPTION} ${MUTED}`,
        children: [jsx(GlyphSpinner, {}, 'spinner'), jsx('span', { children: t('checking') }, 'text')]
      })
    }
    if (inspect.status === 'error') {
      return jsxs('div', {
        className: 'flex flex-col items-start gap-1.5',
        children: [
          jsx('div', { className: ERROR_BAR, children: inspect.error }, 'error'),
          jsx(
            Button,
            { size: 'xs', variant: 'ghost', type: 'button', onClick: runInspect, children: t('check') },
            'retry'
          )
        ]
      })
    }
    const data = inspect.data || {}
    const warnings = Array.isArray(data.warnings) ? data.warnings : []
    const halfButton = (half, label, variant) =>
      jsx(
        Button,
        {
          size: 'xs',
          variant,
          type: 'button',
          disabled: isMutating,
          onClick: () => installHalf(half),
          children:
            installingHalf === half
              ? jsxs('span', {
                  className: 'inline-flex items-center gap-1',
                  children: [jsx(GlyphSpinner, {}, 'spinner'), jsx('span', { children: t('installing') }, 'text')]
                })
              : label
        },
        half
      )
    return jsxs('div', {
      className: cn(PANEL_CLASS, CAPTION),
      children: [
        jsxs('div', {
          className: 'flex flex-wrap items-center gap-2',
          children: [
            jsx(
              Badge,
              {
                variant: data.agent ? 'success' : 'muted',
                size: 'xs',
                children: `${data.agent ? '✓' : '—'} ${t('hasAgentHalf')}`
              },
              'agent'
            ),
            jsx(
              Badge,
              {
                variant: data.desktop ? 'success' : 'muted',
                size: 'xs',
                children: `${data.desktop ? '✓' : '—'} ${t('hasDesktopHalf')}`
              },
              'desktop'
            ),
            data.sha
              ? jsx('span', { className: MUTED, children: `${t('inspectSha')} ${shortSha(data.sha)}` }, 'sha')
              : null
          ]
        }),
        warnings.length ? jsx('div', { className: DANGER, children: warnings.join(' · ') }, 'warnings') : null,
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

  const devSection = row => {
    const state = devCache[rowKeyOf(row)]
    const loading = !state || state.status === 'loading'
    const ready = Boolean(state && state.status === 'ready')
    const failed = Boolean(state && state.status === 'error')
    const gitNode = jsx('span', { className: MUTED, children: t('devGitUnavailable') })
    const copy = (state && state.copy) || {}

    let copyNode
    if (loading) {
      copyNode = jsxs('span', {
        className: `inline-flex items-center gap-1 ${MUTED}`,
        children: [jsx(GlyphSpinner, {}, 'spinner'), jsx('span', { children: t('devLoading') }, 'text')]
      })
    } else if (failed) {
      copyNode = jsx('span', { className: MUTED, children: '—' }, 'copy-error')
    } else {
      let copyText = ''
      let copyDanger = false
      if (copy.kind === 'standalone') {
        copyText = t('devStandalone')
      } else if (copy.kind === 'synced') {
        copyText = [t('devCopySynced'), formatBytes(copy.bytes)].filter(Boolean).join(' · ')
      } else if (copy.kind === 'pending') {
        copyDanger = true
        copyText = [
          t('devCopyPending'),
          formatBytes(copy.bytes),
          copy.diff ? `Δ ${formatBytes(copy.diff)}` : ''
        ]
          .filter(Boolean)
          .join(' · ')
      } else if (copy.kind === 'noSource') {
        copyText = t('devCopyNoSource')
      } else if (copy.kind === 'missing') {
        copyText = t('devCopyMissing')
      } else {
        copyDanger = true
        copyText = copy.error || t('devCopyIncomplete')
      }
      copyNode = jsx('span', {
        className: cn('min-w-0 break-words', copyDanger && DANGER),
        children: copyText || '—'
      }, 'copy-value')
    }

    const rereadButton = jsx(
      Button,
      {
        size: 'xs',
        variant: 'ghost',
        type: 'button',
        disabled: loading,
        onClick: () => loadDev(row, true),
        children: t('devReread')
      },
      'reread'
    )

    return jsxs('div', {
      className: 'flex flex-col gap-1.5',
      children: [
        jsxs('div', {
          className: 'gap-x-3 gap-y-1.5 text-[length:var(--conversation-caption-font-size)]',
          style: { display: 'grid', gridTemplateColumns: '6rem minmax(0, 1fr)' },
          children: [
            ...gridPair(t('devGitBranch'), gitNode, 'dev-git'),
            ...gridPair(
              t('devRunCopy'),
              jsxs('div', {
                className: 'flex min-w-0 flex-wrap items-center gap-2',
                children: [copyNode, rereadButton]
              }, 'dev-copy-line'),
              'dev-copy'
            )
          ]
        }),
        ready && state.claimed
          ? jsx('div', { className: cn(DANGER, CAPTION), children: t('devCopyClaimed') }, 'claimed')
          : null
      ]
    })
  }

  const renderListRow = row => {
    const selected = rowKeyOf(row) === selectedKey
    const enabled = row.status === 'enabled'
    const busy = busyName === rowKeyOf(row)
    return jsxs(
      'button',
      {
        type: 'button',
        title: row.key ? `${row.name} · ${row.key}` : row.name,
        'aria-pressed': selected,
        onClick: () => {
          haptic('tap')
          setSelectedKey(rowKeyOf(row))
        },
        className: cn(
          'mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          'text-[length:var(--conversation-caption-font-size)]',
          selected ? 'bg-accent text-foreground' : 'hover:bg-accent/40',
          busy && 'opacity-60'
        ),
        children: [
          jsx(
            'span',
            {
              className: cn(
                'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                enabled ? 'bg-emerald-500' : 'bg-(--ui-text-tertiary)'
              ),
              'aria-hidden': true
            },
            'dot'
          ),
          jsx('span', { className: 'min-w-0 flex-1 truncate', children: row.name }, 'name'),
          busy
            ? jsx(GlyphSpinner, {}, 'spinner')
            : row.update_available
              ? jsx(
                  'span',
                  {
                    className: 'shrink-0 text-(--ui-text-tertiary)',
                    'aria-hidden': true,
                    children: '↑'
                  },
                  'update'
                )
              : null
        ]
      },
      rowKeyOf(row)
    )
  }

  const detailSection = (title, content, first) =>
    jsxs(
      'section',
      {
        className: first ? '' : 'mt-4',
        children: [
          jsx(
            'h2',
            {
              className:
                'mb-1.5 text-[0.65rem] uppercase tracking-wide text-(--ui-text-quaternary)',
              children: title
            },
            'title'
          ),
          content
        ]
      },
      `section-${title}`
    )

  const renderDetail = () => {
    const row = currentRow
    if (!row) return null
    const busy = isMutating
    const enabled = row.status === 'enabled'
    const sourceKey = sourceKeyOf(row)

    const facts = []
    if (row.key) facts.push(enabled ? t('statusEnabled') : t('statusDisabled'))
    if (row.has_desktop_half) facts.push(t('halfDesktop'))
    if (row.update_available) facts.push(t('updateAvailable'))

    const badges = []
    if (row.source !== 'bundled') {
      badges.push(jsx('span', { className: BADGE_CLASS, children: t(sourceKey) }, 'source'))
    }
    if (row.portable) {
      badges.push(
        jsx(
          Tip,
          {
            label: t('portableTip'),
            children: jsx('span', { className: BADGE_CLASS, children: t('portableBadge') })
          },
          'portable'
        )
      )
    }
    if (row.pinned_sha) {
      badges.push(
        jsx(
          Tip,
          {
            label: t('pinnedTip'),
            children: jsx('span', {
              className: cn(BADGE_CLASS, 'font-mono'),
              children: t('pinnedBadge', shortSha(row.pinned_sha))
            })
          },
          'pinned'
        )
      )
    }

    const statusCells = [
      ...gridPair(
        t('enableTip'),
        row.key ? (enabled ? t('statusEnabled') : t('statusDisabled')) : '—',
        'enabled'
      ),
      ...gridPair(t('halfAgent'), row.key ? t('halfYes') : t('halfNo'), 'agent-half'),
      ...gridPair(
        t('halfDesktop'),
        row.has_desktop_half ? t('halfYes') : t('halfNo'),
        'desktop-half'
      )
    ]

    const sourceCells = [
      ...gridPair(t('sourceLabel'), t(sourceKey), 'source')
    ]
    if (row.pinned_sha) {
      sourceCells.push(
        ...gridPair(
          t('pinnedLabel'),
          jsx('code', { className: 'min-w-0 break-all font-mono', children: shortSha(row.pinned_sha) }),
          'pinned'
        )
      )
    }
    if (row.update_available) {
      sourceCells.push(
        ...gridPair(
          t('upgradeLabel'),
          t(
            'upgradeValue',
            row.catalog_version || '',
            shortSha(row.update_target || row.catalog_sha)
          ),
          'upgrade'
        )
      )
    }

    const pathNode = row.install_dir
      ? jsxs('div', {
          // Path on its own line: sharing it with the buttons squeezed the text
          // into a ragged column.
          className: 'flex min-w-0 flex-col gap-1.5',
          children: [
            jsx(
              'code',
              { className: 'min-w-0 break-all font-mono', children: row.install_dir },
              'path'
            ),
            jsxs(
              'div',
              {
                className: 'flex items-center gap-2',
                children: [
                  jsx(
                    Button,
                    {
                      size: 'xs',
                      variant: 'ghost',
                      type: 'button',
                      onClick: () => revealPath(row.install_dir),
                      children: t('openDir')
                    },
                    'open-dir'
                  ),
                  jsx(
                    CopyButton,
                    {
                      appearance: 'inline',
                      text: row.install_dir,
                      label: t('copyPath'),
                      onCopied: () => notify('success', t('copied'))
                    },
                    'copy-path'
                  )
                ]
              },
              'path-actions'
            )
          ]
        })
      : jsx('span', { className: MUTED, children: '—' }, 'path-empty')

    const actionButtons = [
      busy ? jsx(GlyphSpinner, {}, 'spinner') : null,
      row.source !== 'bundled'
        ? jsx(
            Button,
            {
              size: 'sm',
              variant: 'ghost',
              type: 'button',
              onClick: () => toggleDev(row),
              children: devSet.has(row.name) ? t('devUnmark') : t('devMark')
            },
            'dev-toggle'
          )
        : null,
      row.update_available && canManageAgent(row, allRows)
        ? jsx(
            Button,
            {
              size: 'sm',
              variant: 'secondary',
              type: 'button',
              disabled: busy || Boolean(consent || scan),
              onClick: () => runUpdate(row),
              children: t('update')
            },
            'update'
          )
        : null,
      canManageAgent(row, allRows)
        ? jsx(
            Button,
            {
              size: 'sm',
              variant: 'outline',
              type: 'button',
              disabled: busy,
              onClick: () => setPendingRemove({ row, mode: 'remove' }),
              children: t('uninstall')
            },
            'uninstall'
          )
        : null,
      row.desktop_name && !row.desktop_claimed
        ? jsx(
            Button,
            {
              size: 'sm',
              variant: 'outline',
              type: 'button',
              disabled: busy,
              onClick: () => setPendingRemove({ row, mode: 'remove_desktop' }),
              children: t('uninstallDesktop')
            },
            'uninstall-desktop'
          )
        : null
    ]

    return jsxs(
      'div',
      {
        className: 'flex flex-col',
        children: [
          jsxs('div', {
            className: 'flex items-start justify-between gap-3',
            children: [
              jsxs('div', {
                className: 'min-w-0',
                children: [
                  jsxs('div', {
                    className: 'flex min-w-0 flex-wrap items-center gap-2',
                    children: [
                      jsx(
                        'span',
                        { className: 'min-w-0 truncate text-sm font-medium', children: row.name },
                        'name'
                      ),
                      row.version
                        ? jsx(
                            'span',
                            { className: 'text-(--ui-text-quaternary)', children: `v${row.version}` },
                            'version'
                          )
                        : null,
                      ...badges
                    ]
                  }),
                  jsx(
                    'div',
                    {
                      className: cn(CAPTION, MUTED),
                      children: facts.length ? facts.join(' · ') : null
                    },
                    'facts'
                  )
                ]
              }),
              row.key
                ? jsx(
                    Tip,
                    {
                      label: enabled ? t('disableTip') : t('enableTip'),
                      children: jsx(Switch, {
                        checked: enabled,
                        disabled: busy,
                        size: 'xs',
                        style: enabled ? { backgroundColor: 'var(--ui-accent, #7c5cff)' } : undefined,
                        'aria-label': t('toggleAria', row.name),
                        onCheckedChange: next => toggleRow(row, next)
                      })
                    },
                    'switch'
                  )
                : null
            ]
          }),
          detailSection(
            t('detailStatus'),
            jsx('div', {
              className: 'gap-x-3 gap-y-1.5 text-[length:var(--conversation-caption-font-size)]',
              // Inline grid: utility classes written here are not in the app's
              // compiled Tailwind, so `grid-cols-[…]` silently did nothing and the
              // labels stacked above their values.
              style: { display: 'grid', gridTemplateColumns: '6rem minmax(0, 1fr)' },
              children: statusCells
            }, 'status-grid'),
            true
          ),
          detailSection(
            t('detailSourceSection'),
            jsx('div', {
              className: 'gap-x-3 gap-y-1.5 text-[length:var(--conversation-caption-font-size)]',
              // Inline grid: utility classes written here are not in the app's
              // compiled Tailwind, so `grid-cols-[…]` silently did nothing and the
              // labels stacked above their values.
              style: { display: 'grid', gridTemplateColumns: '6rem minmax(0, 1fr)' },
              children: sourceCells
            }, 'source-grid')
          ),
          row.has_desktop_half
            ? detailSection(t('devState'), devSection(row))
            : null,
          detailSection(t('detailPathSection'), pathNode),
          detailSection(
            t('detailActions'),
            jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                row.key && row.source !== 'bundled' && !canManageAgent(row, allRows)
                  ? jsx('div', { className: cn(CAPTION, MUTED), children: t('ambiguousActions') }, 'ambiguous-actions')
                  : null,
                rowError && rowError.key === rowKeyOf(row)
                  ? jsx('div', { className: ERROR_BAR, children: rowError.message }, 'row-error')
                  : null,
                jsx('div', {
                  className: 'flex flex-wrap items-center gap-2 pt-1',
                  children: actionButtons
                }, 'actions')
              ]
            })
          )
        ]
      },
      rowKeyOf(row)
    )
  }

  const groupHeader = (id, label, count, collapsible) => {
    const className =
      'flex w-full items-center gap-2 px-3 pt-3 pb-1 text-[0.65rem] uppercase tracking-wide ' +
      'text-(--ui-text-quaternary)'
    const body = [
      jsx('span', { className: 'min-w-0 flex-1 truncate text-left', children: label }, 'label'),
      jsx('span', { className: 'shrink-0 tabular-nums', children: count }, 'count')
    ]
    if (!collapsible) return jsxs('div', { className, children: body }, id)
    return jsxs(
      'button',
      {
        type: 'button',
        onClick: () => toggleSection(id),
        'aria-expanded': Boolean(expanded[id]),
        className,
        children: [
          jsx(
            'span',
            { className: 'shrink-0', 'aria-hidden': true, children: expanded[id] ? '▾' : '▸' },
            'chevron'
          ),
          ...body
        ]
      },
      id
    )
  }

  const listRows = rows =>
    jsx('div', { className: 'flex flex-col pb-2', children: rows.map(renderListRow) }, 'rows')

  const emptyBlock = (message, withClear, key = 'empty') =>
    jsxs(
      'div',
      {
        className:
          'flex flex-col items-center gap-2 px-3 py-10 text-center text-(--ui-text-tertiary)',
        children: [
          jsx('div', { className: CAPTION, children: message }, 'message'),
          withClear
            ? jsx(
                Button,
                {
                  size: 'xs',
                  variant: 'ghost',
                  type: 'button',
                  onClick: clearFilters,
                  children: t('clearFilters')
                },
                'clear'
              )
            : null
        ]
      },
      key
    )

  const leftBody = () => {
    if (status === 'loading' && !allRows.length) {
      return jsxs('div', {
        className: 'flex items-center justify-center gap-2 py-8 text-(--ui-text-tertiary)',
        children: [
          jsx(GlyphSpinner, {}, 'spinner'),
          jsx('span', { className: CAPTION, children: t('loading') }, 'text')
        ]
      })
    }
    if (status === 'error' && !allRows.length) {
      return jsxs('div', {
        className: 'flex flex-col gap-2 px-3 py-4',
        children: [
          jsx('div', { className: ERROR_BAR, children: t('loadFailed', loadError) }, 'message'),
          jsx(
            Button,
            { size: 'xs', variant: 'outline', type: 'button', onClick: refresh, children: t('retry') },
            'retry'
          )
        ]
      })
    }
    const hasMine = filteredDev.length + filteredInstalled.length
    return jsxs('div', {
      className: 'flex flex-col',
      children: [
        devRows.length
          ? jsxs('section', {
              children: [
                groupHeader('dev', t('devGroup'), devRows.length, false),
                listRows(filteredDev)
              ]
            }, 'dev')
          : null,
        installedRows.length
          ? jsxs('section', {
              children: [
                groupHeader('installed', t('installedGroup'), installedRows.length, false),
                listRows(filteredInstalled)
              ]
            }, 'installed')
          : null,
        !hasMine && filtering ? emptyBlock(t('emptyFiltered'), true, 'filtered-empty') : null,
        bundledRows.length
          ? jsxs('section', {
              children: [
                groupHeader('bundled', t('bundledGroup'), bundledRows.length, true),
                expanded.bundled ? listRows(bundledRows) : null
              ]
            }, 'bundled')
          : null,
        !allRows.length ? emptyBlock(t('empty'), false, 'no-plugins') : null
      ]
    })
  }

  const rightBody = () => {
    const loadingFirst = status === 'loading' && !allRows.length
    if (loadingFirst) {
      return jsxs('div', {
        className: 'flex h-full items-center justify-center gap-2 text-(--ui-text-tertiary)',
        children: [
          jsx(GlyphSpinner, {}, 'spinner'),
          jsx('span', { className: CAPTION, children: t('loading') }, 'text')
        ]
      })
    }
    const detail = renderDetail()
    if (detail) return detail
    let message = t('selectHint')
    let withClear = false
    if (!allRows.length) {
      message = status === 'error' ? t('loadFailed', loadError) : t('empty')
    } else if (filtering && !selectableRows.length) {
      message = t('emptyFiltered')
      withClear = true
    }
    return jsxs('div', {
      className: 'flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-(--ui-text-tertiary)',
      children: [
        jsx('div', { className: CAPTION, children: message }, 'message'),
        withClear
          ? jsx(
              Button,
              {
                size: 'xs',
                variant: 'ghost',
                type: 'button',
                onClick: clearFilters,
                children: t('clearFilters')
              },
              'clear'
            )
          : null
      ]
    })
  }

  const pendingTarget = pendingRemove && pendingRemove.row
  const pendingDesktop = Boolean(pendingRemove && pendingRemove.mode === 'remove_desktop')

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    'data-cn-market': '',
    children: [
      jsxs('div', {
        className:
          'flex min-w-0 flex-wrap items-center justify-between gap-3 border-b ' +
          'border-(--ui-stroke-tertiary) px-4 py-3',
        children: [
          jsxs('div', {
            className: 'min-w-0',
            children: [
              jsx('div', { className: 'text-sm font-medium', children: t('title') }, 'title'),
              jsx(
                'div',
                {
                  className: cn('truncate', CAPTION, MUTED),
                  children: refreshing
                    ? `${t('statusLine', counts.dev, counts.installed, counts.bundled, allUpdates)} · ${t('loading')}`
                    : t('statusLine', counts.dev, counts.installed, counts.bundled, allUpdates)
                },
                'status'
              ),
              versionWarn
                ? jsx(
                    'div',
                    { className: cn(CAPTION, DANGER), children: t('requiresVersionWarn', MIN_HERMES) },
                    'version'
                  )
                : null
            ]
          }),
          jsxs('div', {
            className: 'flex shrink-0 flex-wrap items-center justify-end gap-1.5',
            children: [
              jsx(
                Button,
                {
                  size: 'sm',
                  variant: 'secondary',
                  type: 'button',
                  disabled: isMutating || Boolean(consent || scan) || allUpdates === 0,
                  onClick: runUpdateAll,
                  children: bulkUpdating
                    ? jsxs('span', {
                        className: 'inline-flex items-center gap-1.5',
                        children: [
                          jsx(GlyphSpinner, {}, 'spinner'),
                          jsx('span', { children: t('updatingAll') }, 'text')
                        ]
                      })
                    : t('updateAll')
                },
                'update-all'
              ),
              jsx(
                Button,
                {
                  size: 'sm',
                  variant: installOpen ? 'secondary' : 'outline',
                  type: 'button',
                  disabled: isMutating,
                  onClick: () => {
                    haptic('tap')
                    inspectEpoch.current += 1
                    setInstallOpen(open => !open)
                    setInspect({ status: 'idle' })
                    setActionError('')
                  },
                  children: t('installFromGit')
                },
                'install'
              ),
              jsx(
                Tip,
                {
                  label: t('refresh'),
                  children: jsx(Button, {
                    size: 'sm',
                    variant: 'ghost',
                    type: 'button',
                    'aria-label': t('refresh'),
                    disabled: refreshing,
                    onClick: refresh,
                    children: refreshing
                      ? jsx(GlyphSpinner, {})
                      : jsx('span', { 'aria-hidden': true, children: '⟳' })
                  })
                },
                'refresh'
              )
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'flex min-h-0 flex-1',
        'data-cn-market-layout': '',
        style: { flexDirection: 'row' },
        children: [
          jsxs('div', {
            className:
              'flex min-h-0 shrink-0 flex-col border-r ' +
              'border-(--ui-stroke-tertiary)',
            // No breakpoint: a percentage cap keeps the pane usable in a narrow
            // window without needing CSS the host does not compile.
            style: { width: '20rem', maxWidth: '38%', minWidth: '11rem' },
            'data-cn-market-list': '',
            children: [
              jsxs('div', {
                className:
                  'flex flex-col gap-1.5 border-b border-(--ui-stroke-tertiary) px-2 py-2',
                children: [
                  jsx(
                    'input',
                    {
                      value: query,
                      onChange: event => setQuery(event.target.value),
                      placeholder: t('search'),
                      'aria-label': t('search'),
                      className:
                        'h-8 w-full rounded-md border border-(--ui-stroke-tertiary) ' +
                        'bg-(--ui-bg-input) px-2 outline-none ' +
                        'text-[length:var(--conversation-caption-font-size)]'
                    },
                    'search'
                  ),
                  jsxs('div', {
                    className: 'flex flex-wrap items-center gap-1',
                    children: [
                      chip('all', t('filterAll', counts.mine)),
                      chip('enabled', t('filterEnabled', counts.enabled)),
                      chip('disabled', t('filterDisabled', counts.mine - counts.enabled)),
                      chip('desktop', t('filterDesktop', counts.desktop)),
                      chip('updates', t('filterUpdates', counts.updates))
                    ]
                  })
                ]
              }),
              jsx(
                'div',
                {
                  className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
                  children: leftBody()
                },
                'list'
              )
            ]
          }),
          jsxs('div', {
            className: 'min-w-0 flex-1 overflow-y-auto px-5 py-4',
            'data-cn-market-detail': '',
            style: { minWidth: 0 },
            children: [
              loadError && allRows.length
                ? jsx('div', { className: cn(ERROR_BAR, 'mb-3'), children: t('loadFailed', loadError) }, 'load-error')
                : null,
              actionError
                ? jsx('div', { className: cn(ERROR_BAR, 'mb-3'), children: actionError }, 'action-error')
                : null,
              installOpen
                ? jsxs('div', {
                    className: cn(PANEL_CLASS, 'mb-4'),
                    children: [
                      jsx('div', { className: 'text-sm font-medium', children: t('gitTitle') }, 'title'),
                      jsxs('div', {
                        className: 'flex min-w-0 flex-wrap items-end gap-2',
                        children: [
                          jsxs('label', {
                            className: 'flex min-w-0 flex-1 flex-col gap-1',
                            children: [
                              jsx('span', { className: cn(CAPTION, MUTED), children: t('gitRepo') }, 'label'),
                              jsx('input', {
                                value: installRepo,
                                disabled: isMutating,
                                onChange: event => {
                                  inspectEpoch.current += 1
                                  setInstallRepo(event.target.value)
                                  setInspect({ status: 'idle' })
                                },
                                placeholder: t('gitRepoPlaceholder'),
                                'aria-label': t('gitRepo'),
                                className: cn(INPUT_CLASS, 'w-full')
                              }, 'input')
                            ]
                          }, 'repo'),
                          jsxs('label', {
                            className: 'flex min-w-0 flex-col gap-1',
                            style: { width: 'min(16rem, 100%)' },
                            children: [
                              jsx('span', { className: cn(CAPTION, MUTED), children: t('gitRef') }, 'label'),
                              jsx('input', {
                                value: installRef,
                                disabled: isMutating,
                                onChange: event => {
                                  inspectEpoch.current += 1
                                  setInstallRef(event.target.value)
                                  setInspect({ status: 'idle' })
                                },
                                placeholder: t('gitRefPlaceholder'),
                                'aria-label': t('gitRef'),
                                spellCheck: false,
                                className: cn(INPUT_CLASS, 'w-full font-mono')
                              }, 'input')
                            ]
                          }, 'ref'),
                          jsx(
                            Button,
                            {
                              size: 'xs',
                              variant: 'outline',
                              type: 'button',
                              disabled: isMutating || inspect.status === 'checking',
                              onClick: runInspect,
                              children: t('check')
                            },
                            'check'
                          )
                        ]
                      }),
                      inspectPanel()
                    ]
                  }, 'install-panel')
                : null,
              scan
                ? jsxs('div', {
                    className:
                      'mb-4 flex flex-col gap-2 rounded-lg border border-destructive/40 ' +
                      'bg-destructive/10 p-3 text-[length:var(--conversation-caption-font-size)]',
                    children: [
                      jsx('div', { className: 'text-sm font-medium', children: t('scanTitle') }, 'title'),
                      scan.verdict
                        ? jsx('div', { className: MUTED, children: t('scanVerdict', scan.verdict) }, 'verdict')
                        : null,
                      scan.findings.length
                        ? jsxs('div', {
                            className: 'flex flex-col gap-0.5',
                            children: [
                              jsx('div', { className: MUTED, children: t('scanFindings') }, 'label'),
                              ...scan.findings.map((finding, index) =>
                                jsx('div', { className: 'break-words', children: String(finding) }, `finding-${index}`)
                              )
                            ]
                          })
                        : null,
                      jsxs('div', {
                        className: 'flex flex-wrap items-center gap-2',
                        children: [
                          scan.verdict === 'caution'
                            ? jsx(
                                Button,
                                {
                                  size: 'xs',
                                  variant: 'destructive',
                                  type: 'button',
                                  disabled: isMutating,
                                  onClick: () => {
                                    const target = scan
                                    setScan(null)
                                    void runUpdate(target.row, {
                                      ...target.options,
                                      force: true
                                    })
                                  },
                                  children: t('stillUpdate')
                                },
                                'still'
                              )
                            : null,
                          jsx(
                            Button,
                            { size: 'xs', variant: 'ghost', type: 'button', disabled: isMutating, onClick: () => setScan(null), children: t('close') },
                            'close'
                          )
                        ]
                      })
                    ]
                  }, 'scan')
                : null,
              bulkResult
                ? jsxs('div', {
                    className: cn(PANEL_CLASS, 'mb-4', CAPTION),
                    children: [
                      ...bulkResult.results.map((result, index) =>
                        jsxs(
                          'div',
                          {
                            className: 'flex min-w-0 gap-2',
                            children: [
                              jsx('span', { className: 'w-40 shrink-0 truncate font-medium', children: result.name }, 'name'),
                              jsx(
                                'span',
                                {
                                  className:
                                    result.status === 'failed' || result.status === 'needs_review' ? DANGER : MUTED,
                                  children: t(
                                    result.status === 'updated'
                                      ? 'statusUpdated'
                                      : result.status === 'current'
                                        ? 'statusCurrent'
                                        : result.status === 'needs_review'
                                          ? 'statusNeedsReview'
                                          : 'statusFailed'
                                  )
                                },
                                'status'
                              ),
                              result.detail
                                ? jsx(
                                    'span',
                                    { className: cn('min-w-0 flex-1 break-words', MUTED), children: result.detail },
                                    'detail'
                                  )
                                : null
                            ]
                          },
                          `result-${index}`
                        )
                      ),
                      bulkResult.skipped.length
                        ? jsxs('div', {
                            className: 'mt-1 flex flex-col gap-1 border-t border-(--ui-stroke-tertiary) pt-1',
                            children: [
                              jsx('div', { className: MUTED, children: t('skippedLabel') }, 'label'),
                              ...bulkResult.skipped.map((skip, index) =>
                                jsxs(
                                  'div',
                                  {
                                    className: 'flex min-w-0 gap-2',
                                    children: [
                                      jsx('span', { className: 'w-40 shrink-0 truncate font-medium', children: skip.name }, 'name'),
                                      jsx(
                                        'span',
                                        { className: cn('min-w-0 flex-1 break-words', MUTED), children: skip.reason },
                                        'reason'
                                      )
                                    ]
                                  },
                                  `skip-${index}`
                                )
                              )
                            ]
                          }, 'skipped')
                        : null,
                      !bulkResult.results.length && !bulkResult.skipped.length
                        ? jsx('div', { className: MUTED, children: t('updateAllNoResult') }, 'none')
                        : null,
                      bulkResult.results.some(result => result.status === 'needs_review')
                        ? jsx('div', { className: DANGER, children: t('updateAllReviewHint') }, 'review')
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
                      }, 'close')
                    ]
                  }, 'bulk')
                : null,
              rightBody()
            ]
          })
        ]
      }),
      jsx(ConfirmDialog, {
        open: Boolean(pendingRemove),
        onClose: () => { if (!mutationRef.current) setPendingRemove(null) },
        onConfirm: doRemove,
        title: pendingTarget
          ? pendingDesktop
            ? t('removeDesktopTitle', pendingTarget.name)
            : t('removeTitle', pendingTarget.name)
          : '',
        description: pendingTarget
          ? pendingDesktop
            ? t('removeDesktopBody', pendingTarget.name)
            : t('removeBody', pendingTarget.name)
          : '',
        confirmLabel: pendingDesktop ? t('uninstallDesktop') : t('uninstall'),
        destructive: true
      }),
      jsx(ConfirmDialog, {
        open: Boolean(consent),
        onClose: () => setConsent(null),
        onConfirm: async () => {
          const target = consent
          if (!target) return
          setConsent(null)
          await runUpdate(target.row, { ...target.options, accept_capabilities: true })
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
