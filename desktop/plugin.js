/**
 * CN-plugins-market — browse the Hermes plugin catalog in your own language.
 *
 * Adds a "Plugin catalog" page to the Hermes Desktop app (sidebar nav +
 * `/cn-plugins-market` route). It reads the official curated catalog
 * (`plugins.json`), lets you rank it four ways, install a plugin with one
 * click, pick any subset with checkboxes, and translate the blow-by-blow
 * blurb into the language you pick — each translation cached PER LANGUAGE and
 * PER pinned commit, so repeat browsing costs nothing and switching language
 * never shows you a stale blurb.
 *
 * Desktop-only plugin: a single ESM file using only the public plugin SDK
 * (`@hermes/plugin-sdk`). No Python half, no credentials, no core patches.
 *
 * Cost note: only the translate action calls a model — one call per batch of
 * up to BATCH_SIZE entries, against whatever provider/model the user already
 * has active.
 */
import {
  Button,
  cn,
  ConfirmDialog,
  GlyphSpinner,
  haptic,
  host,
  ROUTES_AREA,
  ScrollArea,
  SIDEBAR_NAV_AREA,
  Switch,
  Tip,
  useI18n,
  usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'cn-plugins-market'
const PAGE_PATH = '/cn-plugins-market'
const CATALOG_URL = 'https://nousresearch.github.io/hermes-agent/docs/api/plugins.json'

const CATALOG_TIMEOUT_MS = 30000
const LLM_TIMEOUT_MS = 240000
/** Hard cap on ONE entry's blurb text, so a click can't run away. */
const MAX_CHARS = 1500
/** Entries per model call. Bigger = fewer round-trips, smaller = finer progress. */
const BATCH_SIZE = 8
/** Stop a bulk run after this many failed calls in a row (quota, offline, …). */
const MAX_CONSECUTIVE_FAILURES = 3

/** One look for every compact filter control. */
const SELECT_CLASS =
  'h-6 max-w-[15rem] rounded border border-(--ui-border) bg-(--ui-bg-input) px-1 text-xs outline-none'

const PREFS_KEY = 'prefs'
/** Bumped when the cache key shape changes, so stale entries can't be read. */
const CACHE_KEY = 'translations.v2'

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const MESSAGES = {
  en: {
    nav: 'Plugin catalog',
    title: 'Plugin catalog',
    loading: 'Loading the catalog…',
    loadFailed: message => `Could not load the catalog: ${message}`,
    search: 'Search plugins',
    refresh: 'Refresh the catalog',
    rankBy: 'Rank by',
    sortStars: 'Most starred',
    sortUpdated: 'Recently updated',
    sortAdded: 'Newly listed',
    sortTools: 'Most capable',
    all: n => `All ${n}`,
    category: {
      desktop: 'Desktop',
      memory: 'Memory',
      platform: 'Platforms',
      web: 'Web & browsers',
      tools: 'Tools',
      voice: 'Voice',
      automation: 'Automation',
      models: 'Models',
      general: 'General'
    },
    uncategorised: 'Uncategorised',
    filterCategory: 'Category',
    sourceLabel: 'Source',
    sourceUser: 'Mine',
    sourceBundled: 'Built-in',
    sourceAll: 'Everything',
    tier: { official: 'official', community: 'community', bundled: 'bundled', user: 'user' },
    translate: 'Translate',
    translating: 'Translating…',
    translateMissing: n => `Translate ${n} untranslated`,
    translateSelected: n => `Translate ${n} selected`,
    selected: n => `${n} selected`,
    selectAll: n => `Select all ${n} shown`,
    clearSelection: 'Clear',
    selectOne: name => `Select ${name}`,
    selectMode: 'Select',
    exitSelectMode: 'Exit selection',
    inFlight: name => `translating ${name}…`,
    stop: 'Stop',
    progress: (done, total) => `${done}/${total}…`,
    statusLine: (shown, done, left, when) =>
      `${shown} shown · ${done} translated${left ? ` · ${left} left` : ''} · fetched ${when}`,
    install: 'Install',
    installed: 'Installed',
    enableTip: 'Enable',
    disableTip: 'Disable',
    toggleAria: name => `Enable or disable ${name}`,
    enabledOk: name => `${name} enabled.`,
    disabledOk: name => `${name} disabled.`,
    toggleFailed: message => `Could not change the state: ${message}`,
    toggleUnsupported: name => `${name} has no toggle key on this backend.`,
    desktopHalfHint: 'Its desktop half is opened separately in Settings → Plugins.',
    onlyInstalled: n => `Installed only (${n})`,
    uninstall: 'Uninstall',
    uninstallTitle: name => `Uninstall ${name}?`,
    uninstallBody: name =>
      `This deletes ${name}'s files from the current profile. It can be reinstalled from the catalog or from Git at any time.`,
    uninstalled: name => `${name} uninstalled.`,
    uninstallFailed: message => `Uninstall failed: ${message}`,
    localSource: 'Installed outside the catalog',
    openRepo: 'Open the repository',
    targetLang: 'Translate into',
    autoLang: 'Follow the app language',
    failed: message => `Translation failed: ${message}`,
    failedRepeatedly: 'Translations kept failing — stopped.',
    installedOk: name => `${name} installed`,
    installFailed: message => `Install failed: ${message}`,
    openFailed: 'Could not open that link',
    tools: n => `${n} tools`,
    updatedAgo: when => `updated ${when}`,
    addedAgo: when => `added ${when}`,
    now: 'just now',
    today: 'today',
    yesterday: 'yesterday',
    daysAgo: n => `${n} days ago`,
    monthsAgo: n => `${n} months ago`,
    yearsAgo: n => `${n} years ago`,
    promptIntro: 'Translate the following software plugin blurbs into',
    promptRules:
      'Keep plugin names, commands, file paths, URLs, version numbers and numbers exactly as they are.',
    batchRule: n =>
      `You get ${n} numbered items. Answer with exactly ${n} lines, one per item, each starting with the same [[i]] marker followed by the translation and nothing else.`
  },
  zh: {
    nav: '插件目录',
    title: '插件目录',
    loading: '正在读取插件目录…',
    loadFailed: message => `目录加载失败：${message}`,
    search: '搜索插件',
    refresh: '重新拉取目录',
    rankBy: '排行口径',
    sortStars: '最受欢迎',
    sortUpdated: '最近更新',
    sortAdded: '新上榜',
    sortTools: '功能最多',
    all: n => `全部 ${n}`,
    category: {
      desktop: '桌面',
      memory: '记忆',
      platform: '平台',
      web: '网页与浏览器',
      tools: '工具',
      voice: '语音',
      automation: '自动化',
      models: '模型',
      general: '通用'
    },
    uncategorised: '未分类',
    filterCategory: '分类',
    sourceLabel: '来源',
    sourceUser: '自己装的',
    sourceBundled: '内置',
    sourceAll: '全部',
    tier: { official: '官方', community: '社区', bundled: '内置', user: '用户' },
    translate: '译',
    translating: '译…',
    translateMissing: n => `翻译未翻译的 ${n} 条`,
    translateSelected: n => `翻译选中的 ${n} 条`,
    selected: n => `已选 ${n} 条`,
    selectAll: n => `全选当前 ${n} 条`,
    clearSelection: '清空',
    selectOne: name => `选中 ${name}`,
    selectMode: '多选',
    exitSelectMode: '退出多选',
    inFlight: name => `正在翻 ${name}…`,
    stop: '停止',
    progress: (done, total) => `${done}/${total}…`,
    statusLine: (shown, done, left, when) =>
      `当前 ${shown} 条 · 已翻译 ${done} 条${left ? ` · 待翻 ${left} 条` : ''} · 拉取于${when}`,
    install: '安装',
    installed: '已安装',
    enableTip: '启用',
    disableTip: '停用',
    toggleAria: name => `启用或停用 ${name}`,
    enabledOk: name => `${name} 已启用`,
    disabledOk: name => `${name} 已停用`,
    toggleFailed: message => `改不动状态：${message}`,
    toggleUnsupported: name => `${name} 在这个后端上没有可切换的 key。`,
    desktopHalfHint: '它的桌面半边要在「设置 → 插件」里单独打开。',
    onlyInstalled: n => `只看已安装 ${n}`,
    uninstall: '卸载',
    uninstallTitle: name => `卸载 ${name}？`,
    uninstallBody: name => `会把这个插件的文件从当前 profile 里删掉。以后随时可以从目录或 Git 重新装上。`,
    uninstalled: name => `${name} 已卸载`,
    uninstallFailed: message => `卸载失败：${message}`,
    localSource: '不在目录里（从 Git 等处装的）',
    openRepo: '打开源码仓库',
    targetLang: '翻译成',
    autoLang: '跟随界面语言',
    failed: message => `翻译失败：${message}`,
    failedRepeatedly: '连续失败，已停止翻译',
    installedOk: name => `${name} 已安装`,
    installFailed: message => `安装失败：${message}`,
    openFailed: '打不开这个链接',
    tools: n => `工具 ${n}`,
    updatedAgo: when => `更新于${when}`,
    addedAgo: when => `首次收录于${when}`,
    now: '刚刚',
    today: '今天',
    yesterday: '昨天',
    daysAgo: n => `${n} 天前`,
    monthsAgo: n => `${n} 个月前`,
    yearsAgo: n => `${n} 年前`,
    promptIntro: '把下面这些软件插件简介翻译成',
    promptRules: '插件名、命令、文件路径、URL、版本号、专有名词和数字保持原样。',
    batchRule: n =>
      `下面有 ${n} 条编号条目。请按同样顺序输出 ${n} 行，每行以对应的 [[i]] 标记开头，后面只跟译文，不要任何其它内容。`
  },
  'zh-hant': {
    nav: '外掛目錄',
    title: '外掛目錄',
    loading: '正在讀取外掛目錄…',
    loadFailed: message => `目錄載入失敗：${message}`,
    search: '搜尋外掛',
    refresh: '重新擷取目錄',
    rankBy: '排行依據',
    sortStars: '最受歡迎',
    sortUpdated: '最近更新',
    sortAdded: '新上榜',
    sortTools: '功能最多',
    all: n => `全部 ${n}`,
    category: {
      desktop: '桌面',
      memory: '記憶',
      platform: '平台',
      web: '網頁與瀏覽器',
      tools: '工具',
      voice: '語音',
      automation: '自動化',
      models: '模型',
      general: '通用'
    },
    uncategorised: '未分類',
    filterCategory: '分類',
    sourceLabel: '來源',
    sourceUser: '自己裝的',
    sourceBundled: '內建',
    sourceAll: '全部',
    tier: { official: '官方', community: '社群', bundled: '內建', user: '使用者' },
    translate: '譯',
    translating: '譯…',
    translateMissing: n => `翻譯未翻譯的 ${n} 條`,
    translateSelected: n => `翻譯選取的 ${n} 條`,
    selected: n => `已選 ${n} 條`,
    selectAll: n => `全選目前 ${n} 條`,
    clearSelection: '清空',
    selectOne: name => `選取 ${name}`,
    selectMode: '多選',
    exitSelectMode: '退出多選',
    inFlight: name => `正在翻 ${name}…`,
    stop: '停止',
    progress: (done, total) => `${done}/${total}…`,
    statusLine: (shown, done, left, when) =>
      `目前 ${shown} 條 · 已翻譯 ${done} 條${left ? ` · 待翻譯 ${left} 條` : ''} · 擷取於${when}`,
    install: '安裝',
    installed: '已安裝',
    enableTip: '啟用',
    disableTip: '停用',
    toggleAria: name => `啟用或停用 ${name}`,
    enabledOk: name => `${name} 已啟用`,
    disabledOk: name => `${name} 已停用`,
    toggleFailed: message => `改不動狀態：${message}`,
    toggleUnsupported: name => `${name} 在這個後端上沒有可切換的 key。`,
    desktopHalfHint: '它的桌面半邊要在「設定 → 外掛」裡單獨打開。',
    onlyInstalled: n => `只看已安裝 ${n}`,
    uninstall: '卸載',
    uninstallTitle: name => `卸載 ${name}？`,
    uninstallBody: name => `會把這個外掛的檔案從目前 profile 刪掉。之後隨時可以從目錄或 Git 重新安裝。`,
    uninstalled: name => `${name} 已卸載`,
    uninstallFailed: message => `卸載失敗：${message}`,
    localSource: '不在目錄裡（從 Git 等處安裝）',
    openRepo: '開啟原始碼倉庫',
    targetLang: '翻譯成',
    autoLang: '跟隨介面語言',
    failed: message => `翻譯失敗：${message}`,
    failedRepeatedly: '連續失敗，已停止翻譯',
    installedOk: name => `${name} 已安裝`,
    installFailed: message => `安裝失敗：${message}`,
    openFailed: '無法開啟這個連結',
    tools: n => `工具 ${n}`,
    updatedAgo: when => `更新於${when}`,
    addedAgo: when => `首次收錄於${when}`,
    now: '剛剛',
    today: '今天',
    yesterday: '昨天',
    daysAgo: n => `${n} 天前`,
    monthsAgo: n => `${n} 個月前`,
    yearsAgo: n => `${n} 年前`,
    promptIntro: '把下面這些軟體外掛簡介翻譯成',
    promptRules: '外掛名稱、指令、檔案路徑、URL、版本號、專有名詞與數字保持原樣。',
    batchRule: n =>
      `下面有 ${n} 條編號條目。請按同樣順序輸出 ${n} 行，每行以對應的 [[i]] 標記開頭，後面只跟譯文，不要任何其它內容。`
  }
}

/** Languages offered as a translation target. Endonyms, never translated. */
const TARGETS = [
  { id: 'auto' },
  { id: 'Simplified Chinese', endonym: '简体中文' },
  { id: 'Traditional Chinese', endonym: '繁體中文' },
  { id: 'Japanese', endonym: '日本語' },
  { id: 'Korean', endonym: '한국어' },
  { id: 'English', endonym: 'English' },
  { id: 'Spanish', endonym: 'Español' },
  { id: 'French', endonym: 'Français' },
  { id: 'German', endonym: 'Deutsch' },
  { id: 'Russian', endonym: 'Русский' },
  { id: 'Arabic', endonym: 'العربية' }
]

/** App locale → the target a user of that locale almost certainly wants. */
const LOCALE_TARGET = {
  en: 'Simplified Chinese',
  zh: 'Simplified Chinese',
  'zh-hant': 'Traditional Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  ar: 'Arabic'
}

// ---------------------------------------------------------------------------
// module state
// ---------------------------------------------------------------------------

let pluginCtx = null
/** `${name}@${sha}#${target}` → translated blurb. Language is part of the key. */
let cache = {}
let prefs = { sort: 'stars', category: '', target: 'auto' }

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
  const storedCache = readStored(CACHE_KEY)
  if (storedCache && typeof storedCache === 'object') cache = storedCache
  const storedPrefs = readStored(PREFS_KEY)
  if (storedPrefs && typeof storedPrefs === 'object') prefs = { ...prefs, ...storedPrefs }
}

/** Cache key carries the target language: switching language ≠ "already done". */
function cacheKey(entry, target) {
  return `${entry.name}@${entry.shaShort || entry.sha || ''}#${target}`
}

/** Name, source description, or the translation already cached for this target. */
function entryMatches(entry, needle, target) {
  if (!needle) return true
  return (
    (entry.name || '').toLowerCase().includes(needle) ||
    (entry.description || '').toLowerCase().includes(needle) ||
    (cache[cacheKey(entry, target)] || '').toLowerCase().includes(needle)
  )
}

function toolsOf(entry) {
  const caps = entry.capabilities || {}
  const tools = caps.providesTools ? caps.providesTools.length : 0
  const hooks = caps.providesHooks ? caps.providesHooks.length : 0
  return tools + hooks
}

const DAY_MS = 86400000

function agoParts(iso) {
  const time = Date.parse(iso || '')
  if (!Number.isFinite(time)) return null
  const days = Math.floor((Date.now() - time) / DAY_MS)
  if (days <= 0) return { unit: 'now' }
  if (days === 1) return { unit: 'yesterday' }
  if (days < 30) return { unit: 'daysAgo', n: days }
  if (days < 365) return { unit: 'monthsAgo', n: Math.floor(days / 30) }
  return { unit: 'yearsAgo', n: Math.floor(days / 365) }
}

function agoText(t, iso) {
  const parts = agoParts(iso)
  if (!parts) return ''
  if (parts.unit === 'now') return t('now')
  if (parts.unit === 'yesterday') return t('yesterday')
  return t(parts.unit, parts.n)
}

const SORTS = [
  { id: 'stars', label: 'sortStars', cmp: (a, b) => (b.stars || 0) - (a.stars || 0) },
  {
    id: 'updated',
    label: 'sortUpdated',
    cmp: (a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0)
  },
  {
    id: 'added',
    label: 'sortAdded',
    cmp: (a, b) => (Date.parse(b.addedAt || 0) || 0) - (Date.parse(a.addedAt || 0) || 0)
  },
  { id: 'tools', label: 'sortTools', cmp: (a, b) => toolsOf(b) - toolsOf(a) }
]

/** Category label that never leaks a raw i18n key for an unmapped slug. */
function categoryLabel(t, slug) {
  if (!slug) return t('uncategorised')
  const key = `category.${slug}`
  const label = t(key)
  return label === key ? slug : label
}

function openExternal(url, failMessage) {
  if (!url) return
  try {
    if (!pluginCtx || !pluginCtx.os || !pluginCtx.os.openExternal) return
    const pending = pluginCtx.os.openExternal(url)
    if (pending && typeof pending.then === 'function') {
      pending.then(ok => {
        if (ok === false) host.notify({ kind: 'error', message: failMessage })
      })
    }
  } catch {
    /* the OS door resolves false rather than throwing; nothing to recover */
  }
}

// ---------------------------------------------------------------------------
// translation
// ---------------------------------------------------------------------------

async function translateBlurb(text, instructions, sessionId) {
  const res = await host.request(
    'llm.oneshot',
    { instructions, input: text, session_id: sessionId, max_tokens: 640, temperature: 0.1 },
    LLM_TIMEOUT_MS
  )
  return res && typeof res.text === 'string' ? res.text.trim() : ''
}

/**
 * Batch sibling of `translateBlurb`: N entries in ONE call.
 * Items are numbered `[[i]]`; the model is asked to echo the markers, so a
 * short or reordered answer still maps back to the right entry.
 */
async function translateMany(texts, instructions, sessionId) {
  const input = texts.map((text, index) => `[[${index + 1}]] ${text}`).join('\n')
  const res = await host.request(
    'llm.oneshot',
    {
      instructions,
      input,
      session_id: sessionId,
      max_tokens: Math.min(4096, 480 * texts.length + 200),
      temperature: 0.1
    },
    LLM_TIMEOUT_MS
  )
  return parseBatch(res && typeof res.text === 'string' ? res.text : '', texts.length)
}

function cleanTranslation(value) {
  return String(value || '')
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

/** Split a `[[i]] translation` answer into an array indexed from 0. */
function parseBatch(text, expected) {
  const out = new Array(expected).fill('')
  const re = /\[\[(\d+)\]\]\s*([\s\S]*?)(?=\n?\s*\[\[\d+\]\]|$)/g
  let match = re.exec(text)
  while (match) {
    const index = Number(match[1]) - 1
    if (index >= 0 && index < expected) out[index] = cleanTranslation(match[2])
    match = re.exec(text)
  }
  if (!out.some(Boolean)) {
    // Markers ignored (or a single-item chunk): fall back to the shape we got.
    const cleaned = cleanTranslation(text)
    if (expected === 1) return [cleaned]
    const lines = cleaned
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    if (lines.length === expected) return lines
  }
  return out
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

function CatalogPage() {
  const t = usePluginI18n(ID)
  const { locale } = useI18n()
  const gateway = useValue(host.state.gateway)

  const [entries, setEntries] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(prefs.sort)
  const [category, setCategory] = useState(prefs.category)
  const [target, setTarget] = useState(prefs.target)
  const [installedRows, setInstalledRows] = useState([])
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('user')
  const [pendingRemove, setPendingRemove] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [busyName, setBusyName] = useState('')
  const [bulk, setBulk] = useState(null)
  const [tick, setTick] = useState(0)
  const bulkRef = useRef(null)

  const resolvedTarget = useMemo(() => {
    if (target !== 'auto') return target
    return LOCALE_TARGET[locale] || 'Simplified Chinese'
  }, [target, locale])

  const instructions = useMemo(
    () => `${t('promptIntro')} ${resolvedTarget}。${t('promptRules')}`,
    [t, resolvedTarget]
  )
  const batchInstructions = useMemo(
    () => `${instructions} ${t('batchRule', BATCH_SIZE)}`,
    [instructions, t]
  )

  const loadCatalog = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const res = await fetch(CATALOG_URL, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(Array.isArray(data) ? data : [])
      setFetchedAt(new Date().toISOString())
      setStatus('ready')
    } catch (e) {
      setError(String((e && e.message) || e))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const refreshInstalled = useCallback(async () => {
    try {
      const profile = host.state.focusedSessionProfile.get() || host.state.profile.get() || undefined
      const res = await host.request('plugins.manage', {
        action: 'list',
        ...(profile ? { profile } : {})
      })
      setInstalledRows(res && res.plugins ? res.plugins : [])
    } catch {
      /* an unavailable list just leaves every card showing Install */
    }
  }, [])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  /** A row may be identified by its manifest name or its catalog name. */
  const installedNames = useMemo(() => {
    const names = new Set()
    for (const row of installedRows) {
      if (row.name) names.add(row.name)
      if (row.catalog_name) names.add(row.catalog_name)
    }
    return names
  }, [installedRows])

  const installedByName = useMemo(() => {
    const map = new Map()
    for (const row of installedRows) {
      if (row.name) map.set(row.name, row)
      if (row.catalog_name) map.set(row.catalog_name, row)
    }
    return map
  }, [installedRows])

  /** Bundled defaults vs. what the user actually added. */
  const installedCounts = useMemo(() => {
    let bundled = 0
    for (const row of installedRows) if (row.source === 'bundled') bundled += 1
    return { bundled, user: installedRows.length - bundled, all: installedRows.length }
  }, [installedRows])

  const installedCount = installedCounts[sourceFilter] ?? installedCounts.all
  const rowMatchesSource = useCallback(
    row => {
      if (sourceFilter === 'all') return true
      const bundled = Boolean(row) && row.source === 'bundled'
      return sourceFilter === 'bundled' ? bundled : !bundled
    },
    [sourceFilter]
  )

  // Persist the user's choices.
  useEffect(() => {
    prefs = { sort, category, target }
    writeStored(PREFS_KEY, prefs)
  }, [sort, category, target])

  const categories = useMemo(() => {
    const counts = new Map()
    for (const entry of entries) {
      const key = entry.category || ''
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [entries])

  /** Installed plugins the catalog doesn't list at all (Git installs, bundled). */
  const localRows = useMemo(() => {
    if (!onlyInstalled) return []
    return installedRows
      .filter(row => rowMatchesSource(row))
      .filter(row => !entries.some(e => e.name === row.name || e.name === row.catalog_name))
      .map(row => ({
        name: row.name,
        description: row.description || '',
        tier: row.source === 'bundled' ? 'bundled' : 'user',
        stars: 0,
        local: true
      }))
  }, [onlyInstalled, installedRows, entries, rowMatchesSource])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const active = SORTS.find(s => s.id === sort) || SORTS[0]
    const base = entries
      .filter(entry => (category ? (entry.category || '') === category : true))
      .filter(entry =>
        onlyInstalled
          ? installedNames.has(entry.name) && rowMatchesSource(installedByName.get(entry.name))
          : true
      )
      .filter(entry => entryMatches(entry, needle, resolvedTarget))
      .sort((a, b) => active.cmp(a, b) || (b.stars || 0) - (a.stars || 0))
    const locals = localRows.filter(entry => entryMatches(entry, needle, resolvedTarget))
    // `tick` re-sorts after a translation lands so search-visible state stays true.
    return locals.length ? [...base, ...locals] : base
  }, [
    entries,
    query,
    category,
    sort,
    resolvedTarget,
    onlyInstalled,
    installedNames,
    installedByName,
    rowMatchesSource,
    localRows,
    tick
  ])

  const pending = useMemo(
    () => filtered.filter(entry => !cache[cacheKey(entry, resolvedTarget)]),
    [filtered, resolvedTarget, tick]
  )

  /** Selection spans the whole catalog, so it survives filter changes. */
  const selectedEntries = useMemo(
    () => entries.filter(entry => selected.has(entry.name)),
    [entries, selected]
  )
  const selectedPending = useMemo(
    () =>
      selectedEntries.filter(
        entry => !cache[cacheKey(entry, resolvedTarget)] && (entry.description || '').trim()
      ),
    [selectedEntries, resolvedTarget, tick]
  )

  const toggleSelected = useCallback(name => {
    haptic('tap')
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const selectAllShown = useCallback(() => {
    haptic('tap')
    setSelected(prev => new Set([...prev, ...filtered.map(entry => entry.name)]))
  }, [filtered])

  const clearSelection = useCallback(() => {
    haptic('tap')
    setSelected(new Set())
  }, [])

  /** Selection is a separate mode you step into, so the list stays clean otherwise. */
  const toggleSelectMode = useCallback(() => {
    haptic('tap')
    setSelectMode(prev => !prev)
    setSelected(new Set())
  }, [])

  const translateEntry = useCallback(
    async entry => {
      const key = cacheKey(entry, resolvedTarget)
      if (cache[key] || !(entry.description || '').trim()) return
      setBusyName(entry.name)
      const input = entry.description.slice(0, MAX_CHARS)
      const sessionId =
        host.state.focusedSessionId.get() || host.state.activeSessionId.get() || undefined
      try {
        let out = await translateBlurb(input, instructions, sessionId)
        if (!out) out = await translateBlurb(input, instructions, sessionId)
        if (out) {
          cache[key] = out
          writeStored(CACHE_KEY, cache)
          setTick(v => v + 1)
        }
      } catch (e) {
        host.notify({ kind: 'error', message: t('failed', (e && e.message) || e) })
      } finally {
        setBusyName('')
      }
    },
    [instructions, resolvedTarget, t]
  )

  /** One runner for both bulk entries: batches of BATCH_SIZE, stoppable. */
  const runTranslation = useCallback(
    async list => {
      const queue = list.filter(entry => !cache[cacheKey(entry, resolvedTarget)] && (entry.description || '').trim())
      if (!queue.length) return
      const state = { done: 0, total: queue.length, stop: false, current: '' }
      bulkRef.current = state
      setBulk({ ...state })
      const sessionId =
        host.state.focusedSessionId.get() || host.state.activeSessionId.get() || undefined
      let consecutiveFailures = 0
      for (let start = 0; start < queue.length; start += BATCH_SIZE) {
        if (bulkRef.current && bulkRef.current.stop) break
        const chunk = queue.slice(start, start + BATCH_SIZE)
        // Show what is being worked on BEFORE awaiting, so the bar never looks dead.
        state.current = chunk[0] ? chunk[0].name : ''
        setBulk({ ...state })
        let translations = null
        try {
          translations = await translateMany(
            chunk.map(entry => entry.description.slice(0, MAX_CHARS)),
            batchInstructions,
            sessionId
          )
        } catch {
          translations = null
        }
        if (translations && translations.some(Boolean)) {
          consecutiveFailures = 0
          chunk.forEach((entry, index) => {
            const out = translations[index]
            if (out) cache[cacheKey(entry, resolvedTarget)] = out
          })
          writeStored(CACHE_KEY, cache)
        } else {
          consecutiveFailures += 1
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            host.notify({ kind: 'error', message: t('failedRepeatedly') })
            break
          }
        }
        state.done = Math.min(state.total, start + chunk.length)
        state.current = ''
        setBulk({ ...state })
        setTick(v => v + 1)
      }
      bulkRef.current = null
      setBulk(null)
      // A finished batch is a finished job: drop the selection so the next
      // glance at the list isn't cluttered with ticks.
      setSelected(new Set())
    },
    [batchInstructions, resolvedTarget, t]
  )

  const translateMissing = useCallback(() => {
    void runTranslation(pending)
  }, [pending, runTranslation])

  const translateSelected = useCallback(() => {
    void runTranslation(selectedPending)
  }, [selectedPending, runTranslation])

  const stopBulk = useCallback(() => {
    if (bulkRef.current) bulkRef.current.stop = true
  }, [])

  const installEntry = useCallback(
    async entry => {
      setBusyName(entry.name)
      try {
        const profile = host.state.focusedSessionProfile.get() || host.state.profile.get() || undefined
        const res = await host.request(
          'plugins.manage',
          {
            action: 'install',
            identifier: entry.subdir ? `${entry.repo}#${entry.subdir}` : entry.repo,
            catalog_name: entry.name,
            enable: true,
            ...(profile ? { profile } : {})
          },
          600000
        )
        if (!res || !res.ok) throw new Error((res && res.error) || 'install rejected')
        await refreshInstalled()
        host.notify({ kind: 'success', message: t('installedOk', entry.name) })
      } catch (e) {
        host.notify({ kind: 'error', message: t('installFailed', (e && e.message) || e) })
      } finally {
        setBusyName('')
      }
    },
    [refreshInstalled, t]
  )

  /** The same enable/disable switch the built-in Plugins tab drives. */
  const toggleEntry = useCallback(
    async (entry, enable) => {
      const row = installedByName.get(entry.name)
      if (!row || !row.key) {
        host.notify({ kind: 'error', message: t('toggleUnsupported', entry.name) })
        return
      }
      setBusyName(entry.name)
      try {
        const profile = host.state.focusedSessionProfile.get() || host.state.profile.get() || undefined
        const res = await host.request(
          'plugins.manage',
          { action: 'toggle', key: row.key, enable, ...(profile ? { profile } : {}) },
          120000
        )
        if (!res || !res.ok) throw new Error((res && res.error) || 'toggle rejected')
        host.notify({
          kind: 'success',
          message: enable ? t('enabledOk', entry.name) : t('disabledOk', entry.name)
        })
        await refreshInstalled()
        setTick(v => v + 1)
      } catch (e) {
        host.notify({ kind: 'error', message: t('toggleFailed', (e && e.message) || e) })
      } finally {
        setBusyName('')
      }
    },
    [installedByName, refreshInstalled, t]
  )

  /** ConfirmDialog's onConfirm: throw to keep the dialog open with the error. */
  const doUninstall = useCallback(async () => {
    const target = pendingRemove
    if (!target) return
    const profile = host.state.focusedSessionProfile.get() || host.state.profile.get() || undefined
    const res = await host.request(
      'plugins.manage',
      { action: 'remove', name: target.name, ...(profile ? { profile } : {}) },
      180000
    )
    if (!res || !res.ok) {
      const message = (res && res.error) || 'remove rejected'
      host.notify({ kind: 'error', message: t('uninstallFailed', message) })
      throw new Error(message)
    }
    host.notify({ kind: 'success', message: t('uninstalled', target.name) })
    setPendingRemove(null)
    await refreshInstalled()
    setTick(v => v + 1)
  }, [pendingRemove, refreshInstalled, t])

  const translatedCount = filtered.length - pending.length

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col gap-3 p-4',
    children: [
      // ── header: title + one status line, actions on the right ─────────────
      jsxs('div', {
        className: 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2',
        children: [
          jsxs('div', {
            className: 'flex min-w-0 items-baseline gap-2',
            children: [
              jsx('div', { className: 'shrink-0 text-sm font-medium', children: t('title') }),
              jsx('span', {
                className: 'truncate text-xs text-(--ui-text-tertiary)',
                children:
                  status === 'ready'
                    ? t(
                        'statusLine',
                        filtered.length,
                        translatedCount,
                        pending.length,
                        agoText(t, fetchedAt)
                      )
                    : ''
              })
            ]
          }),
          jsxs('div', {
            className: 'flex shrink-0 flex-wrap items-center justify-end gap-2',
            children: [
              jsx('input', {
                value: query,
                onChange: event => setQuery(event.target.value),
                placeholder: t('search'),
                'aria-label': t('search'),
                className:
                  'h-7 w-48 rounded-md border border-(--ui-border) bg-(--ui-bg-input) px-2 text-xs outline-none'
              }),
              jsx(Tip, {
                label: t('refresh'),
                children: jsx(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  type: 'button',
                  disabled: status === 'loading',
                  onClick: loadCatalog,
                  children: '⟳'
                })
              }),
              jsx(Button, {
                size: 'sm',
                variant: selectMode ? 'secondary' : 'outline',
                type: 'button',
                disabled: Boolean(bulk),
                onClick: toggleSelectMode,
                children: selectMode ? t('exitSelectMode') : t('selectMode')
              }),
              jsx(Tip, {
                label: t('translateMissing', pending.length),
                children: jsx(Button, {
                  size: 'sm',
                  variant: 'secondary',
                  type: 'button',
                  disabled: !gateway || !pending.length || Boolean(bulk),
                  onClick: translateMissing,
                  children: bulk
                    ? jsxs('span', {
                        className: 'inline-flex items-center gap-1.5',
                        children: [jsx(GlyphSpinner, {}), t('progress', bulk.done, bulk.total)]
                      })
                    : t('translateMissing', pending.length)
                })
              }),
              bulk
                ? jsx(Button, {
                    size: 'sm',
                    variant: 'ghost',
                    type: 'button',
                    onClick: stopBulk,
                    children: t('stop')
                  })
                : null
            ]
          }),
          bulk && bulk.current
            ? jsx('div', {
                className: 'w-full text-xs text-(--ui-text-tertiary)',
                children: t('inFlight', bulk.current)
              })
            : null
        ]
      }),

      // ── filters: four compact controls on one line ────────────────────────
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-x-4 gap-y-2 text-xs',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('rankBy') }),
              jsx('select', {
                value: sort,
                onChange: event => setSort(event.target.value),
                'aria-label': t('rankBy'),
                className: SELECT_CLASS,
                children: SORTS.map(option =>
                  jsx('option', { value: option.id, children: t(option.label) }, option.id)
                )
              })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('filterCategory') }),
              jsxs('select', {
                value: category,
                onChange: event => setCategory(event.target.value),
                'aria-label': t('filterCategory'),
                className: SELECT_CLASS,
                children: [
                  jsx('option', { value: '', children: t('all', entries.length) }, '__all'),
                  ...categories.map(([slug, count]) =>
                    jsx(
                      'option',
                      { value: slug, children: `${categoryLabel(t, slug)} ${count}` },
                      slug || '__none'
                    )
                  )
                ]
              })
            ]
          }),
          jsx('button', {
            type: 'button',
            onClick: () => setOnlyInstalled(value => !value),
            'aria-pressed': onlyInstalled,
            className: cn(
              'rounded px-2 py-0.5',
              onlyInstalled ? 'bg-(--ui-bg-quaternary) font-medium' : 'text-(--ui-text-tertiary)'
            ),
            children: t('onlyInstalled', onlyInstalled ? installedCount : installedCounts.user)
          }),
          onlyInstalled
            ? jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('sourceLabel') }),
                  jsxs('select', {
                    value: sourceFilter,
                    onChange: event => setSourceFilter(event.target.value),
                    'aria-label': t('sourceLabel'),
                    className: SELECT_CLASS,
                    children: [
                      jsx(
                        'option',
                        { value: 'user', children: `${t('sourceUser')} ${installedCounts.user}` },
                        'user'
                      ),
                      jsx(
                        'option',
                        {
                          value: 'bundled',
                          children: `${t('sourceBundled')} ${installedCounts.bundled}`
                        },
                        'bundled'
                      ),
                      jsx(
                        'option',
                        { value: 'all', children: `${t('sourceAll')} ${installedCounts.all}` },
                        'all'
                      )
                    ]
                  })
                ]
              })
            : null,
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('targetLang') }),
              jsxs('select', {
                value: target,
                onChange: event => setTarget(event.target.value),
                'aria-label': t('targetLang'),
                className: SELECT_CLASS,
                children: TARGETS.map(option =>
                  jsx(
                    'option',
                    { value: option.id, children: option.endonym || t('autoLang') },
                    option.id
                  )
                )
              })
            ]
          })
        ]
      }),

      // ── selection (only in selection mode) ───────────────────────────────
      selectMode && status === 'ready'
        ? jsxs('div', {
            className: 'flex flex-wrap items-center gap-2 text-xs',
            children: [
              jsx('span', {
                className: cn(
                  'tabular-nums',
                  selected.size ? 'font-medium' : 'text-(--ui-text-tertiary)'
                ),
                children: t('selected', selected.size)
              }),
              jsx(Button, {
                size: 'xs',
                variant: 'ghost',
                type: 'button',
                disabled: !filtered.length || Boolean(bulk),
                onClick: selectAllShown,
                children: t('selectAll', filtered.length)
              }),
              selected.size
                ? jsx(Button, {
                    size: 'xs',
                    variant: 'ghost',
                    type: 'button',
                    disabled: Boolean(bulk),
                    onClick: clearSelection,
                    children: t('clearSelection')
                  })
                : null,
              jsx(Tip, {
                label: t('translateSelected', selectedPending.length),
                children: jsx(Button, {
                  size: 'xs',
                  variant: 'secondary',
                  type: 'button',
                  disabled: !gateway || !selectedPending.length || Boolean(bulk),
                  onClick: translateSelected,
                  children: t('translateSelected', selectedPending.length)
                })
              })
            ]
          })
        : null,

      // ── body ──────────────────────────────────────────────────────────────
      status === 'error'
        ? jsx('div', {
            className: 'rounded-md border border-(--ui-danger) p-3 text-sm',
            children: t('loadFailed', error)
          })
        : status === 'loading'
          ? jsxs('div', {
              className: 'flex items-center gap-2 py-12 text-sm text-(--ui-text-tertiary)',
              children: [jsx(GlyphSpinner, {}), t('loading')]
            })
          : jsx(ScrollArea, {
              className: 'min-h-0 flex-1',
              children: jsx('div', {
                className: 'flex flex-col gap-2 pr-2',
                children: filtered.map((entry, rank) => {
                  const key = cacheKey(entry, resolvedTarget)
                  const blurb = cache[key]
                  const isInstalled = installedNames.has(entry.name)
                  const row = installedByName.get(entry.name)
                  const rowEnabled = Boolean(row) && row.status === 'enabled'
                  const isSelected = selected.has(entry.name)
                  const busy = busyName === entry.name
                  const toolCount = toolsOf(entry)
                  return jsxs(
                    'div',
                    {
                      className: cn(
                        'rounded-md border p-3',
                        isSelected ? 'border-(--ui-accent)' : 'border-(--ui-border)'
                      ),
                      children: [
                        jsxs('div', {
                          className: 'flex flex-wrap items-center gap-2',
                          children: [
                            selectMode
                              ? jsx('input', {
                                  type: 'checkbox',
                                  checked: isSelected,
                                  onChange: () => toggleSelected(entry.name),
                                  'aria-label': t('selectOne', entry.name),
                                  className: 'h-3.5 w-3.5 shrink-0 cursor-pointer'
                                })
                              : null,
                            jsx('span', {
                              className: cn(
                                'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs',
                                rank < 3
                                  ? 'bg-(--ui-bg-quaternary) font-semibold'
                                  : 'text-(--ui-text-tertiary)'
                              ),
                              children: `#${rank + 1}`
                            }),
                            jsx(Tip, {
                              label: entry.local ? '' : entry.repo || entry.docsUrl || '',
                              children: entry.local
                                ? jsx('span', {
                                    className: 'text-sm font-medium',
                                    children: entry.name
                                  })
                                : jsx('button', {
                                    type: 'button',
                                    onClick: () =>
                                      openExternal(entry.repo || entry.docsUrl, t('openFailed')),
                                    className: cn(
                                      'cursor-pointer text-sm font-medium underline-offset-4',
                                      'hover:underline hover:text-(--ui-text-primary)'
                                    ),
                                    children: entry.name
                                  })
                            }),
                            jsx('span', {
                              className: 'text-xs text-(--ui-text-tertiary)',
                              children: t(`tier.${entry.tier || 'community'}`)
                            }),
                            entry.local
                              ? jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: t('localSource')
                                })
                              : jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: categoryLabel(t, entry.category)
                                }),
                            entry.stars
                              ? jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: `★${entry.stars}`
                                })
                              : null,
                            entry.updatedAt
                              ? jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: t('updatedAgo', agoText(t, entry.updatedAt))
                                })
                              : null,
                            entry.addedAt
                              ? jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: t('addedAgo', agoText(t, entry.addedAt))
                                })
                              : null,
                            toolCount
                              ? jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: t('tools', toolCount)
                                })
                              : null,
                            jsx('div', { className: 'flex-1' }),
                            blurb
                              ? null
                              : jsx(Button, {
                                  size: 'xs',
                                  variant: 'ghost',
                                  type: 'button',
                                  disabled: !gateway || busy,
                                  onClick: () => translateEntry(entry),
                                  children: busy ? t('translating') : t('translate')
                                }),
                            isInstalled
                              ? jsxs('span', {
                                  className: 'inline-flex items-center gap-2',
                                  children: [
                                    jsx('span', {
                                      className: 'text-xs text-(--ui-text-tertiary)',
                                      children: t('installed')
                                    }),
                                    row && row.key
                                      ? jsx(Tip, {
                                          label: rowEnabled ? t('disableTip') : t('enableTip'),
                                          children: jsx(Switch, {
                                            checked: rowEnabled,
                                            disabled: busy,
                                            'aria-label': t('toggleAria', entry.name),
                                            onCheckedChange: next => toggleEntry(entry, next)
                                          })
                                        })
                                      : null,
                                    jsx(Button, {
                                      size: 'xs',
                                      variant: 'ghost',
                                      type: 'button',
                                      disabled: busy,
                                      onClick: () => setPendingRemove(entry),
                                      children: t('uninstall')
                                    })
                                  ]
                                })
                              : jsx(Button, {
                                  size: 'xs',
                                  variant: 'secondary',
                                  type: 'button',
                                  disabled: busy,
                                  onClick: () => installEntry(entry),
                                  children: busy ? '…' : t('install')
                                })
                          ]
                        }),
                        jsx('div', {
                          className: 'mt-1 text-sm leading-relaxed',
                          children: blurb || entry.description || ''
                        }),
                        row && row.has_desktop_half
                          ? jsx('div', {
                              className: 'mt-1 text-xs text-(--ui-text-tertiary)',
                              children: t('desktopHalfHint')
                            })
                          : null
                      ]
                    },
                    key
                  )
                })
              })
            }),
      jsx(ConfirmDialog, {
        open: Boolean(pendingRemove),
        onClose: () => setPendingRemove(null),
        onConfirm: doUninstall,
        title: pendingRemove ? t('uninstallTitle', pendingRemove.name) : '',
        description: pendingRemove ? t('uninstallBody', pendingRemove.name) : '',
        confirmLabel: t('uninstall'),
        destructive: true
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Plugin catalog (multilingual)',
  register(ctx) {
    pluginCtx = ctx
    ctx.i18n.register(MESSAGES)
    hydrate()
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: PAGE_PATH },
      render: () => jsx(CatalogPage, {})
    })

    // The sidebar label is read once at registration, so re-register it when
    // the app language changes — otherwise it strands in the old language.
    const registerNav = () =>
      ctx.register({
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: PAGE_PATH, label: ctx.i18n.t('nav'), codicon: 'globe' }
      })
    let disposeNav = registerNav()
    ctx.i18n.onLocaleChange(() => {
      disposeNav()
      disposeNav = registerNav()
    })
  }
}
