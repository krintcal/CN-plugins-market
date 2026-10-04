/**
 * CN-plugins-market — browse the Hermes plugin catalog in your own language.
 *
 * Adds a "Plugin catalog" page to the Hermes Desktop app (sidebar nav +
 * `/cn-plugins-market` route). It reads the official curated catalog
 * (`plugins.json`), lets you rank it four ways, install a plugin with one
 * click, and translate any plugin's blurb into the language you pick —
 * translating each blurb ONCE and caching the result, so repeat browsing
 * costs nothing.
 *
 * Desktop-only plugin: a single ESM file using only the public plugin SDK
 * (`@hermes/plugin-sdk`). No Python half, no credentials, no core patches.
 *
 * Cost note: only the "translate" action calls a model, one entry per call,
 * against whatever provider/model the user already has active.
 */
import {
  Button,
  cn,
  GlyphSpinner,
  haptic,
  host,
  ROUTES_AREA,
  ScrollArea,
  SIDEBAR_NAV_AREA,
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
const LLM_TIMEOUT_MS = 180000
/** Hard cap on the blurb text handed to the model, so one click can't run away. */
const MAX_CHARS = 1500
const PREFS_KEY = 'prefs'
const CACHE_KEY = 'translations'

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const MESSAGES = {
  en: {
    nav: 'Plugin catalog',
    title: 'Plugin catalog',
    loading: 'Loading the catalog…',
    loadFailed: message => `Could not load the catalog: ${message}`,
    count: n => `${n} plugins`,
    fetched: when => `fetched ${when}`,
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
      platforms: 'Platforms',
      web: 'Web & browsers',
      tools: 'Tools',
      voice: 'Voice',
      automation: 'Automation',
      models: 'Models',
      general: 'General',
      mcp: 'MCP',
      media: 'Media',
      security: 'Security',
      observability: 'Observability',
      productivity: 'Productivity',
      integrations: 'Integrations'
    },
    uncategorised: 'Uncategorised',
    tier: { official: 'official', community: 'community', bundled: 'bundled', user: 'user' },
    translate: 'Translate',
    translating: 'Translating…',
    translateMissing: n => `Translate ${n} untranslated`,
    stop: 'Stop',
    progress: (done, total) => `${done}/${total}…`,
    summary: (shown, done, left) =>
      `${shown} shown · ${done} translated${left ? ` · ${left} left` : ''}`,
    install: 'Install',
    installed: 'Installed',
    openRepo: 'Open the repository',
    targetLang: 'Translate into',
    autoLang: 'Follow the app language',
    failed: message => `Translation failed: ${message}`,
    failedOne: index => `Entry ${index} failed and was skipped`,
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
    promptIntro: 'Translate the following software plugin blurb into',
    promptRules:
      'Keep plugin names, commands, file paths, URLs, version numbers and numbers exactly as they are. No notes, no preamble: output the translation only, on one line.'
  },
  zh: {
    nav: '插件目录',
    title: '插件目录',
    loading: '正在读取插件目录…',
    loadFailed: message => `目录加载失败：${message}`,
    count: n => `共 ${n} 个插件`,
    fetched: when => `拉取于${when}`,
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
      platforms: '平台',
      web: '网页与浏览器',
      tools: '工具',
      voice: '语音',
      automation: '自动化',
      models: '模型',
      general: '通用',
      mcp: 'MCP',
      media: '媒体',
      security: '安全',
      observability: '可观测性',
      productivity: '效率',
      integrations: '集成'
    },
    uncategorised: '未分类',
    tier: { official: '官方', community: '社区', bundled: '内置', user: '用户' },
    translate: '译',
    translating: '译…',
    translateMissing: n => `翻译未翻译的 ${n} 条`,
    stop: '停止',
    progress: (done, total) => `${done}/${total}…`,
    summary: (shown, done, left) =>
      `当前 ${shown} 条 · 已翻译 ${done} 条${left ? ` · 待翻 ${left} 条` : ''}`,
    install: '安装',
    installed: '已安装',
    openRepo: '打开源码仓库',
    targetLang: '翻译成',
    autoLang: '跟随界面语言',
    failed: message => `翻译失败：${message}`,
    failedOne: index => `第 ${index} 条失败，已跳过`,
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
    promptIntro: '把下面这条软件插件简介翻译成',
    promptRules:
      '插件名、命令、文件路径、URL、版本号、专有名词和数字保持原样。不要解释、不要加注、不要前后缀：只输出译文本身，一行。'
  },
  'zh-hant': {
    nav: '外掛目錄',
    title: '外掛目錄',
    loading: '正在讀取外掛目錄…',
    loadFailed: message => `目錄載入失敗：${message}`,
    count: n => `共 ${n} 個外掛`,
    fetched: when => `擷取於${when}`,
    search: '搜尋外掛',
    refresh: '重新擷取目錄',
    rankBy: '排行依據',
    sortStars: '最受歡迎',
    sortUpdated: '最近更新',
    sortAdded: '新上榜',
    sortTools: '功能最多',
    all: n => `全部 ${n}`,
    uncategorised: '未分類',
    tier: { official: '官方', community: '社群', bundled: '內建', user: '使用者' },
    translate: '譯',
    translating: '譯…',
    translateMissing: n => `翻譯未翻譯的 ${n} 條`,
    stop: '停止',
    progress: (done, total) => `${done}/${total}…`,
    summary: (shown, done, left) =>
      `目前 ${shown} 條 · 已翻譯 ${done} 條${left ? ` · 待翻譯 ${left} 條` : ''}`,
    install: '安裝',
    installed: '已安裝',
    openRepo: '開啟原始碼倉庫',
    targetLang: '翻譯成',
    autoLang: '跟隨介面語言',
    failed: message => `翻譯失敗：${message}`,
    failedOne: index => `第 ${index} 條失敗，已略過`,
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
    promptIntro: '把下面這條軟體外掛簡介翻譯成',
    promptRules:
      '外掛名稱、指令、檔案路徑、URL、版本號、專有名詞與數字保持原樣。不要解釋、不要加註、不要前後綴：只輸出譯文本身，一行。'
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
let cache = {} // `${name}@${sha}` → translated blurb
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

function cacheKey(entry) {
  return `${entry.name}@${entry.shaShort || entry.sha || ''}`
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

function openExternal(url) {
  if (!url) return
  try {
    if (!pluginCtx || !pluginCtx.os || !pluginCtx.os.openExternal) return
    const pending = pluginCtx.os.openExternal(url)
    if (pending && typeof pending.then === 'function') {
      pending.then(ok => {
        if (ok === false) host.notify({ kind: 'error', message: 'Could not open that link' })
      })
    }
  } catch {
    /* the OS door resolves false rather than throwing; nothing to recover */
  }
}

async function translateBlurb(text, instructions, sessionId) {
  const res = await host.request(
    'llm.oneshot',
    {
      instructions,
      input: text,
      session_id: sessionId,
      max_tokens: 640,
      temperature: 0.1
    },
    LLM_TIMEOUT_MS
  )
  return res && typeof res.text === 'string' ? res.text.trim() : ''
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
  const [installed, setInstalled] = useState(new Set())
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

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const profile = host.state.focusedSessionProfile.get() || host.state.profile.get() || undefined
        const res = await host.request('plugins.manage', {
          action: 'list',
          ...(profile ? { profile } : {})
        })
        if (!alive) return
        const names = (res && res.plugins ? res.plugins : [])
          .map(row => row.name || row.catalog_name)
          .filter(Boolean)
        setInstalled(new Set(names))
      } catch {
        /* an unavailable list just leaves every card showing Install */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const active = SORTS.find(s => s.id === sort) || SORTS[0]
    return entries
      .filter(entry => (category ? (entry.category || '') === category : true))
      .filter(entry => {
        if (!needle) return true
        const translated = cache[cacheKey(entry)] || ''
        return (
          (entry.name || '').toLowerCase().includes(needle) ||
          (entry.description || '').toLowerCase().includes(needle) ||
          translated.toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => active.cmp(a, b) || (b.stars || 0) - (a.stars || 0))
    // `tick` re-sorts after a translation lands so search-visible state stays true.
  }, [entries, query, category, sort, tick])

  const pending = useMemo(() => filtered.filter(entry => !cache[cacheKey(entry)]), [filtered, tick])

  const translateEntry = useCallback(
    async entry => {
      const key = cacheKey(entry)
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
    [instructions, t]
  )

  const translateMissing = useCallback(async () => {
    const queue = filtered.filter(entry => !cache[cacheKey(entry)] && (entry.description || '').trim())
    if (!queue.length) return
    const state = { done: 0, total: queue.length, stop: false }
    bulkRef.current = state
    setBulk({ ...state })
    const sessionId =
      host.state.focusedSessionId.get() || host.state.activeSessionId.get() || undefined
    for (const entry of queue) {
      if (bulkRef.current && bulkRef.current.stop) break
      try {
        const out = await translateBlurb(entry.description.slice(0, MAX_CHARS), instructions, sessionId)
        if (out) {
          cache[cacheKey(entry)] = out
          writeStored(CACHE_KEY, cache)
        }
      } catch {
        host.notify({ kind: 'error', message: t('failedOne', state.done + 1) })
      }
      state.done += 1
      setBulk({ ...state })
      setTick(v => v + 1)
    }
    bulkRef.current = null
    setBulk(null)
  }, [filtered, instructions, t])

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
        setInstalled(prev => new Set([...prev, entry.name]))
        host.notify({ kind: 'success', message: t('installedOk', entry.name) })
      } catch (e) {
        host.notify({ kind: 'error', message: t('installFailed', (e && e.message) || e) })
      } finally {
        setBusyName('')
      }
    },
    [t]
  )

  const translatedCount = filtered.length - pending.length

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col gap-3 p-4',
    children: [
      // ── header ────────────────────────────────────────────────────────────
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        children: [
          jsx('div', { className: 'text-sm font-medium', children: t('title') }),
          jsx('span', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children:
              status === 'ready'
                ? `${t('count', entries.length)} · ${t('fetched', agoText(t, fetchedAt))}`
                : ''
          }),
          jsx('div', { className: 'flex-1' }),
          jsx('input', {
            value: query,
            onChange: event => setQuery(event.target.value),
            placeholder: t('search'),
            'aria-label': t('search'),
            className:
              'h-7 w-56 rounded-md border border-(--ui-border) bg-(--ui-bg-input) px-2 text-xs outline-none'
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
          jsx(Tip, {
            label: t('translateMissing', pending.length),
            children: jsx(Button, {
              size: 'sm',
              variant: 'secondary',
              type: 'button',
              disabled: !gateway || !pending.length || Boolean(bulk),
              onClick: translateMissing,
              children: bulk
                ? t('progress', bulk.done, bulk.total)
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

      // ── language ──────────────────────────────────────────────────────────
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 text-xs',
        children: [
          jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('targetLang') }),
          jsxs('select', {
            value: target,
            onChange: event => setTarget(event.target.value),
            'aria-label': t('targetLang'),
            className:
              'h-6 rounded border border-(--ui-border) bg-(--ui-bg-input) px-1 text-xs outline-none',
            children: TARGETS.map(option =>
              jsx(
                'option',
                { value: option.id, children: option.endonym || t('autoLang') },
                option.id
              )
            )
          })
        ]
      }),

      // ── ranking ───────────────────────────────────────────────────────────
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 text-xs',
        children: [
          jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('rankBy') }),
          ...SORTS.map(option =>
            jsx(
              'button',
              {
                type: 'button',
                onClick: () => setSort(option.id),
                className: cn(
                  'rounded px-2 py-0.5',
                  option.id === sort
                    ? 'bg-(--ui-bg-quaternary) font-medium'
                    : 'text-(--ui-text-tertiary)'
                ),
                children: t(option.label)
              },
              option.id
            )
          )
        ]
      }),

      // ── categories ────────────────────────────────────────────────────────
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1 text-xs',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => setCategory(''),
            className: cn(
              'rounded px-2 py-0.5',
              category === '' ? 'bg-(--ui-bg-quaternary) font-medium' : 'text-(--ui-text-tertiary)'
            ),
            children: t('all', entries.length)
          }),
          ...categories.map(([slug, count]) =>
            jsx(
              'button',
              {
                type: 'button',
                onClick: () => setCategory(slug === category ? '' : slug),
                className: cn(
                  'rounded px-2 py-0.5',
                  slug === category
                    ? 'bg-(--ui-bg-quaternary) font-medium'
                    : 'text-(--ui-text-tertiary)'
                ),
                children: `${slug ? t(`category.${slug}`) : t('uncategorised')} ${count}`
              },
              slug || 'none'
            )
          )
        ]
      }),

      status === 'ready'
        ? jsx('div', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children: t('summary', filtered.length, translatedCount, pending.length)
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
                  const key = cacheKey(entry)
                  const blurb = cache[key]
                  const isInstalled = installed.has(entry.name)
                  const busy = busyName === entry.name
                  const toolCount = toolsOf(entry)
                  return jsxs(
                    'div',
                    {
                      className: 'rounded-md border border-(--ui-border) p-3',
                      children: [
                        jsxs('div', {
                          className: 'flex flex-wrap items-center gap-2',
                          children: [
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
                              label: entry.repo || entry.docsUrl || '',
                              children: jsx('button', {
                                type: 'button',
                                onClick: () => openExternal(entry.repo || entry.docsUrl),
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
                            jsx('span', {
                              className: 'text-xs text-(--ui-text-tertiary)',
                              children: entry.category
                                ? t(`category.${entry.category}`)
                                : t('uncategorised')
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
                              ? jsx('span', {
                                  className: 'text-xs text-(--ui-text-tertiary)',
                                  children: t('installed')
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
                        })
                      ]
                    },
                    key
                  )
                })
              })
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
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: PAGE_PATH, label: ctx.i18n.t('nav'), codicon: 'globe' }
    })
  }
}
