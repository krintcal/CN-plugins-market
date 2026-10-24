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
  Badge,
  Button,
  cn,
  ConfirmDialog,
  CopyButton,
  DisclosureCaret,
  EmptyState,
  GlyphSpinner,
  haptic,
  host,
  ROUTES_AREA,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
/** First-screen cards; each "show more" adds the same number again. */
const PAGE_SIZE = 60
/** A sentence boundary further back than this would waste most of the budget. */
const CLIP_MIN = Math.floor(MAX_CHARS * 0.6)
/** Entries per model call. Bigger = fewer round-trips, smaller = finer progress. */
const BATCH_SIZE = 8
/** Stop a bulk run after this many failed calls in a row (quota, offline, …). */
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * The SDK switch paints its checked track with the theme's `primary`, which is
 * white in the light theme — and the checked thumb goes white too, so the whole
 * control disappears. Repaint both states with the `--ui-*` variables this page
 * already uses, so it stays readable in either theme.
 */
const SWITCH_CLASS =
  'shrink-0 border border-(--ui-border) bg-(--ui-bg-quaternary) ' +
  'data-[state=checked]:border-[var(--ui-accent,#2f6fed)] ' +
  'data-[state=checked]:bg-[var(--ui-accent,#2f6fed)]'

/** Card blurbs are a glance, not a paragraph: three lines, full text in Details. */
const BLURB_CLAMP = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden'
}

const PREFS_KEY = 'prefs'
/** Bumped when the cache key shape changes, so stale entries can't be read. */
const CACHE_KEY = 'translations.v2'

/** Plugin names are pasted into a shell command, so only this shape is allowed. */
const PLUGIN_NAME_RE = /^[A-Za-z0-9._-]+$/

/**
 * The catalog is written in English: only 11 of 800 entries carry Chinese in
 * their `description`. Typing a Chinese intent into the search box would find
 * almost nothing, so map the common intents onto English stems that actually
 * appear in names/blurbs. Plain substring match, no model, no network.
 */
const CN_SYNONYMS = {
  记忆: ['memory', 'remember', 'recall'],
  备忘: ['memory', 'remember', 'note', 'recall'],
  笔记: ['memory', 'remember', 'note', 'recall'],
  回忆: ['memory', 'remember', 'note', 'recall'],
  桌面: ['desktop', 'gui'],
  界面: ['desktop', 'gui', 'ui', 'window'],
  窗口: ['desktop', 'gui', 'ui', 'window'],
  语音: ['voice', 'tts', 'speech', 'audio', 'transcri'],
  朗读: ['voice', 'tts', 'speech', 'audio', 'transcri'],
  说话: ['voice', 'tts', 'speech', 'audio', 'transcri'],
  听写: ['voice', 'tts', 'speech', 'audio', 'transcri'],
  图片: ['image', 'picture', 'screenshot', 'vision', 'photo', 'draw'],
  图像: ['image', 'picture', 'paint', 'draw', 'screenshot', 'vision', 'photo'],
  绘图: ['image', 'picture', 'paint', 'draw', 'screenshot', 'vision', 'photo'],
  截图: ['image', 'picture', 'paint', 'draw', 'screenshot', 'vision', 'photo'],
  封面: ['image', 'picture', 'paint', 'draw', 'screenshot', 'vision', 'photo'],
  视频: ['video', 'movie'],
  影片: ['video', 'movie'],
  音乐: ['music', 'song', 'audio'],
  歌曲: ['music', 'song', 'audio'],
  音频: ['music', 'song', 'audio'],
  网页: ['web', 'browser', 'scrape', 'crawl', 'fetch'],
  浏览器: ['web', 'browser', 'scrape', 'crawl', 'fetch'],
  爬取: ['web', 'browser', 'scrape', 'crawl', 'fetch'],
  抓取: ['web', 'browser', 'scrape', 'crawl', 'fetch'],
  新闻: ['news', 'feed', 'rss', 'digest', 'headline'],
  资讯: ['news', 'feed', 'rss', 'digest', 'headline'],
  订阅: ['news', 'feed', 'rss', 'digest', 'headline'],
  摘要: ['news', 'feed', 'rss', 'digest', 'headline'],
  邮件: ['mail', 'email', 'inbox'],
  收件箱: ['mail', 'email', 'inbox'],
  日程: ['calendar', 'schedule', 'remind', 'todo'],
  日历: ['calendar', 'schedule', 'remind', 'todo'],
  提醒: ['calendar', 'schedule', 'remind', 'todo'],
  待办: ['calendar', 'schedule', 'remind', 'todo'],
  代码: ['code', 'git', 'repo', 'dev', 'program'],
  编程: ['code', 'git', 'repo', 'dev', 'program'],
  仓库: ['code', 'git', 'repo', 'dev', 'program'],
  开发: ['code', 'git', 'repo', 'dev', 'program'],
  文档: ['file', 'document', 'pdf', 'docx', 'spreadsheet', 'excel', 'csv'],
  文件: ['file', 'document', 'pdf', 'docx', 'spreadsheet', 'excel', 'csv'],
  表格: ['file', 'document', 'pdf', 'docx', 'spreadsheet', 'excel', 'csv'],
  数据: ['data', 'dataset', 'csv', 'json'],
  统计: ['metric', 'analytic'],
  用量: ['usage', 'quota', 'spend'],
  监控: ['monitor', 'watch', 'alert'],
  健康: ['health', 'fitness', 'sleep', 'calorie'],
  运动: ['health', 'fitness', 'sleep', 'calorie'],
  睡眠: ['health', 'fitness', 'sleep', 'calorie'],
  饮食: ['health', 'fitness', 'sleep', 'calorie'],
  翻译: ['translat', 'language', 'i18n'],
  多语言: ['translat', 'language', 'i18n'],
  自动化: ['automat', 'workflow', 'pipeline'],
  定时: ['cron', 'schedul', 'timer'],
  任务: ['task', 'job', 'queue'],
  安全: ['secur', 'vault', 'secret', 'password', 'credential'],
  密钥: ['secur', 'vault', 'secret', 'password', 'credential'],
  密码: ['secur', 'vault', 'secret', 'password', 'credential'],
  凭证: ['secur', 'vault', 'secret', 'password', 'credential'],
  代理: ['proxy', 'vpn', 'tunnel'],
  网络: ['network', 'dns', 'socket'],
  路由: ['proxy', 'network', 'vpn', 'route'],
  模型: ['model', 'llm', 'infer', 'agent'],
  推理: ['model', 'llm', 'infer', 'agent'],
  智能体: ['model', 'llm', 'infer', 'agent'],
  通知: ['notif', 'alert'],
  提醒我: ['notif', 'alert'],
  天气: ['weather'],
  地图: ['map', 'geo'],
  导航: ['map', 'geo'],
  游戏: ['game'],
  相机: ['camera', 'photo'],
  拍照: ['camera', 'photo'],
  终端: ['terminal', 'shell', 'cli'],
  命令行: ['terminal', 'shell', 'cli'],
  数据库: ['database', 'sql', 'sqlite', 'postgres'],
  聊天: ['chat', 'conversation'],
  对话: ['chat', 'conversation'],
  花: ['cost', 'budget', 'spend', 'quota'],
  花钱: ['cost', 'budget', 'spend', 'quota'],
  额度: ['cost', 'budget', 'spend', 'quota'],
  记住: ['memory', 'persist', 'long-term'],
  长期: ['memory', 'persist', 'long-term']
}

/** Badge tones that make official/verified rows read differently from the rest. */
const TIER_BADGE_VARIANT = {
  official: 'default',
  verified: 'success',
  bundled: 'muted',
  user: 'outline',
  desktop: 'outline',
  community: 'muted'
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const MESSAGES = {
  en: {
    nav: 'Plugin catalog',
    title: 'Plugin catalog',
    loading: 'Loading the catalog…',
    loadFailed: message => `Could not load the catalog: ${message}`,
    loadRetryHint: 'Tried twice — if it keeps failing, a proxy may be needed.',
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
    tier: {
      official: 'official',
      verified: 'verified',
      community: 'community',
      bundled: 'bundled',
      user: 'user',
      desktop: 'desktop half'
    },
    installedDesktopOnly: 'Desktop half installed',
    installAgentHalf: 'Add its agent half',
    translate: 'Translate',
    translating: 'Translating…',
    translateMissing: n => `Translate ${n} untranslated`,
    translateSelected: n => `Translate ${n} selected`,
    translateConfirmTitle: n => `Translate ${n} plugins?`,
    translateConfirmBody: (n, calls) =>
      `That is ${calls} model call(s) on your active provider and model. Results are cached per plugin, so you pay for them once.`,
    translateConfirmGo: 'Translate',
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
    desktopHalfHint:
      "Desktop halves are toggled in the app's own Plugins tab — a plugin can only take you there.",
    desktopHalfAction: 'Open its desktop half',
    onlyInstalled: n => `Installed only (${n})`,
    onlyInstallable: n => `Runs here (${n})`,
    noConfigNeeded: n => `No setup (${n})`,
    installableTip: 'This Hermes version and this OS can actually load it',
    noConfigTip: 'Needs no environment variables — install and go',
    uninstall: 'Uninstall',
    uninstallTitle: name => `Uninstall ${name}?`,
    uninstallBody: name =>
      `This deletes ${name}'s files from the current profile, and its desktop half too when the package ships one. It can be reinstalled from the catalog or from Git at any time.`,
    uninstalled: name => `${name} uninstalled.`,
    uninstallFailed: message => `Uninstall failed: ${message}`,
    invalidName: name => `"${name}" is not a valid plugin name.`,
    uninstallCliHint: name => `You can also run it yourself: hermes plugins remove ${name}`,
    updateAvailable: 'Update available',
    updateTip: (installed, latest) => `installed ${installed} · catalog ${latest}`,
    update: 'Update',
    updating: 'Updating…',
    updatedOk: name => `${name} updated.`,
    updateUnchanged: 'Already up to date.',
    updateNotCatalog: name =>
      `${name} is not a catalog install — update it with hermes plugins update ${name}, or from the app's Plugins tab.`,
    updateFailed: message => `Update failed: ${message}`,
    requiresVersion: version => `needs ≥${version}`,
    requiresVersionWarn: version => `needs ≥${version} (this app is older)`,
    installedButSkipped: 'Installed, but skipped at load (version too old)',
    installWillSkip: 'Installing still will not load it until the app is updated.',
    showMore: n => `Show ${n} more`,
    localSource: 'Installed outside the catalog',
    openRepo: 'Open the repository',
    details: 'Details',
    hideDetails: 'Hide details',
    ver: 'Version',
    platformsLabel: 'Platforms',
    maintainerLabel: 'Maintainer',
    installCommandLabel: 'Install command',
    copyCommand: 'Copy command',
    envLabel: 'Required environment',
    envHint: 'The plugin may fail to start until these are set.',
    descriptionLabel: 'Blurb',
    toolsLabel: 'Tools',
    hooksLabel: 'Hooks',
    middlewareLabel: 'Middleware',
    screenshotsLabel: 'Screenshots',
    readmeLink: 'README',
    repoLink: 'Repository',
    docsLink: 'Docs',
    noDetails: 'No extra details for this entry.',
    searchNoResult: 'No matches',
    searchTip: "Try the plugin's English name, or translate the blurbs first.",
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
    loadRetryHint: '已自动重试一次仍失败；可能需要开启代理。',
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
    tier: {
      official: '官方',
      verified: '已认证',
      community: '社区',
      bundled: '内置',
      user: '用户',
      desktop: '桌面半边'
    },
    installedDesktopOnly: '桌面半边已装',
    installAgentHalf: '装 agent 半边',
    translate: '译',
    translating: '译…',
    translateMissing: n => `翻译未翻译的 ${n} 条`,
    translateSelected: n => `翻译选中的 ${n} 条`,
    translateConfirmTitle: n => `翻译 ${n} 条插件简介？`,
    translateConfirmBody: (n, calls) =>
      `共 ${n} 条，将调用 ${calls} 次模型（使用当前的 Provider 与模型）。结果按插件缓存，只需付费一次。`,
    translateConfirmGo: '开始翻译',
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
    desktopHalfHint: '桌面半边由 App 自己管，插件只能带你过去 —— 到「技能与工具 → 插件」里开关。',
    desktopHalfAction: '去开桌面半边',
    onlyInstalled: n => `只看已安装 ${n}`,
    onlyInstallable: n => `能装的 ${n}`,
    noConfigNeeded: n => `免配置 ${n}`,
    installableTip: '当前 Hermes 版本和系统真的能加载它',
    noConfigTip: '不需要配环境变量，装上就能用',
    uninstall: '卸载',
    uninstallTitle: name => `卸载 ${name}？`,
    uninstallBody: name => `会把这个插件的文件从当前 profile 里删掉，带桌面半边的连桌面那份一起删。以后随时可以从目录或 Git 重新装上。`,
    uninstalled: name => `${name} 已卸载`,
    uninstallFailed: message => `卸载失败：${message}`,
    invalidName: name => `「${name}」不是合法的插件名。`,
    uninstallCliHint: name => `也可以自己在终端执行：hermes plugins remove ${name}`,
    updateAvailable: '可升级',
    updateTip: (installed, latest) => `已装 ${installed} · 目录 ${latest}`,
    update: '升级',
    updating: '升级中…',
    updatedOk: name => `${name} 已升级`,
    updateUnchanged: '已是最新',
    updateNotCatalog: name => `${name} 不是从目录装的，请用 hermes plugins update ${name} 或去 App 插件页升级。`,
    updateFailed: message => `升级失败：${message}`,
    requiresVersion: version => `需 ≥${version}`,
    requiresVersionWarn: version => `需 ≥${version}（本机版本偏低）`,
    installedButSkipped: '已安装，但版本不满足，加载时被跳过',
    installWillSkip: '装了也会被跳过，先升级 App 才会加载。',
    showMore: n => `再显示 ${n} 条`,
    localSource: '不在目录里（从 Git 等处装的）',
    openRepo: '打开源码仓库',
    details: '详情',
    hideDetails: '收起详情',
    ver: '版本',
    platformsLabel: '平台',
    maintainerLabel: '维护者',
    installCommandLabel: '安装命令',
    copyCommand: '复制命令',
    envLabel: '需要配置的环境变量',
    envHint: '未配置的话插件可能启动不了。',
    descriptionLabel: '简介',
    toolsLabel: '工具',
    hooksLabel: '钩子',
    middlewareLabel: '中间件',
    screenshotsLabel: '截图',
    readmeLink: 'README',
    repoLink: '仓库',
    docsLink: '文档',
    noDetails: '这条没有更多详情。',
    searchNoResult: '没有匹配',
    searchTip: '试试英文插件名，或先把简介翻译出来再搜。',
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
    loadRetryHint: '已自動重試一次仍失敗；可能需要開啟代理。',
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
    tier: {
      official: '官方',
      verified: '已認證',
      community: '社群',
      bundled: '內建',
      user: '使用者',
      desktop: '桌面半邊'
    },
    installedDesktopOnly: '桌面半邊已裝',
    installAgentHalf: '裝 agent 半邊',
    translate: '譯',
    translating: '譯…',
    translateMissing: n => `翻譯未翻譯的 ${n} 條`,
    translateSelected: n => `翻譯選取的 ${n} 條`,
    translateConfirmTitle: n => `翻譯 ${n} 條外掛簡介？`,
    translateConfirmBody: (n, calls) =>
      `共 ${n} 條，將呼叫 ${calls} 次模型（使用目前的 Provider 與模型）。結果依外掛快取，只需付費一次。`,
    translateConfirmGo: '開始翻譯',
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
    desktopHalfHint: '桌面半邊由 App 自己管，外掛只能帶你過去 —— 到「技能與工具 → 外掛」裡開關。',
    desktopHalfAction: '去開桌面半邊',
    onlyInstalled: n => `只看已安裝 ${n}`,
    onlyInstallable: n => `能裝的 ${n}`,
    noConfigNeeded: n => `免設定 ${n}`,
    installableTip: '目前 Hermes 版本和系統真的能載入它',
    noConfigTip: '不需要設定環境變數，裝上就能用',
    uninstall: '卸載',
    uninstallTitle: name => `卸載 ${name}？`,
    uninstallBody: name => `會把這個外掛的檔案從目前 profile 刪掉，帶桌面半邊的連桌面那份一起刪。之後隨時可以從目錄或 Git 重新安裝。`,
    uninstalled: name => `${name} 已卸載`,
    uninstallFailed: message => `卸載失敗：${message}`,
    invalidName: name => `「${name}」不是合法的外掛名稱。`,
    uninstallCliHint: name => `也可以自己在終端機執行：hermes plugins remove ${name}`,
    updateAvailable: '可升級',
    updateTip: (installed, latest) => `已裝 ${installed} · 目錄 ${latest}`,
    update: '升級',
    updating: '升級中…',
    updatedOk: name => `${name} 已升級`,
    updateUnchanged: '已是最新',
    updateNotCatalog: name => `${name} 不是從目錄安裝的，請用 hermes plugins update ${name} 或到 App 外掛頁升級。`,
    updateFailed: message => `升級失敗：${message}`,
    requiresVersion: version => `需 ≥${version}`,
    requiresVersionWarn: version => `需 ≥${version}（本機版本偏低）`,
    installedButSkipped: '已安裝，但版本不符，載入時被跳過',
    installWillSkip: '安裝了也會被跳過，先升級 App 才會載入。',
    showMore: n => `再顯示 ${n} 條`,
    localSource: '不在目錄裡（從 Git 等處安裝）',
    openRepo: '開啟原始碼倉庫',
    details: '詳情',
    hideDetails: '收合詳情',
    ver: '版本',
    platformsLabel: '平台',
    maintainerLabel: '維護者',
    installCommandLabel: '安裝指令',
    copyCommand: '複製指令',
    envLabel: '需要設定的環境變數',
    envHint: '未設定的話外掛可能啟動不了。',
    descriptionLabel: '簡介',
    toolsLabel: '工具',
    hooksLabel: '鉤子',
    middlewareLabel: '中介層',
    screenshotsLabel: '截圖',
    readmeLink: 'README',
    repoLink: '倉庫',
    docsLink: '文件',
    noDetails: '這條沒有更多詳情。',
    searchNoResult: '沒有符合',
    searchTip: '試試英文外掛名稱，或先把簡介翻譯出來再搜。',
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

/**
 * A Chinese needle expands to its English stems; the raw needle stays a plain
 * substring so English queries and Chinese translations keep matching as
 * before. Longer keys win ("数据库" must not also fan out through "数据"),
 * while a partial Chinese needle falls back to the key that contains it.
 */
function queryWords(needle) {
  const keys = Object.keys(CN_SYNONYMS)
  const contained = keys.filter(cn => needle.includes(cn))
  const matched = contained.length
    ? contained.filter(cn => !contained.some(other => other.length > cn.length && other.includes(cn)))
    : keys.filter(cn => cn.includes(needle))
  return matched.flatMap(cn => CN_SYNONYMS[cn])
}

function compileQuery(query) {
  const needle = String(query || '')
    .trim()
    .toLowerCase()
  if (!needle) return null
  const words = new Set(queryWords(needle).map(word => word.toLowerCase()))
  // Short stems must be whole words ("gui" ≠ "guide"); longer stems keep
  // matching prefixes so "translat" still finds translate/translation.
  const matchers = [...words].map(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return word.length <= 3
      ? new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`)
      : new RegExp(`(^|[^a-z0-9])${escaped}`)
  })
  return {
    needle,
    matches(text) {
      const hay = String(text || '').toLowerCase()
      if (!hay) return false
      if (hay.includes(needle)) return true
      return matchers.some(re => re.test(hay))
    }
  }
}

/**
 * Per-entry lowercase fields, kept apart so relevance can tell a name hit
 * (3) from a blurb/translation hit (2) from a metadata hit (1).
 */
function buildFields(entry, target, t) {
  const caps = entry.capabilities || {}
  const tier = entry.tier || 'community'
  return {
    name: String(entry.name || '').toLowerCase(),
    description: [entry.description, cache[cacheKey(entry, target)]]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    extra: [
      entry.category,
      entry.category ? categoryLabel(t, entry.category) : '',
      tier,
      t(`tier.${tier}`),
      entry.maintainer,
      entry.version,
      entry.platforms,
      caps.providesTools,
      caps.providesHooks
    ]
      .flat()
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  }
}

/** 3: name, 2: description/translation, 1: other fields, 0: no hit. */
function scoreFields(fields, compiled) {
  if (!fields) return 0
  if (compiled.matches(fields.name)) return 3
  if (compiled.matches(fields.description)) return 2
  if (compiled.matches(fields.extra)) return 1
  return 0
}

/** `36509` → `36.5k`, so a star count never eats the header. */
function formatStars(value) {
  const n = Number(value) || 0
  if (n < 1000) return String(n)
  return `${Math.round(n / 100) / 10}k`
}

function toolsOf(entry) {
  const caps = entry.capabilities || {}
  const tools = caps.providesTools ? caps.providesTools.length : 0
  const hooks = caps.providesHooks ? caps.providesHooks.length : 0
  return tools + hooks
}

/** Dotted numeric version segments; null when the string isn't one. */
function versionParts(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^v/i, '')
  if (!/^\d+(\.\d+)*$/.test(raw)) return null
  return raw.split('.').map(Number)
}

/**
 * The catalog only uses `>=x.y.z` for `requiresHermes`. Any other form — or an
 * unknown current version — counts as satisfied, so we never warn on a guess.
 */
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

/** The app reports `win32`; the catalog spells it `windows`. */
const PLATFORM_ALIAS = { win32: 'windows', darwin: 'macos', linux: 'linux' }

/**
 * Can this entry actually run here? `requiresHermes` is checked at load time and
 * silently skips a plugin, and the catalog leaves `platforms` empty when a
 * plugin is OS-agnostic — so both have to be evaluated locally. Unknown inputs
 * never exclude anything: a filter that hides things on a guess is worse than
 * one that shows a bit too much.
 */
function isInstallable(entry, version, platform) {
  if (version && entry.requiresHermes && !satisfies(entry.requiresHermes, version)) return false
  const want = PLATFORM_ALIAS[platform] || platform || ''
  const platforms = Array.isArray(entry.platforms) ? entry.platforms : []
  if (want && platforms.length) {
    const needle = want.toLowerCase()
    if (!platforms.some(name => String(name || '').toLowerCase().includes(needle))) return false
  }
  return true
}

/** Nothing to configure before it works. */
function needsNoConfig(entry) {
  const env = (entry.capabilities || {}).requiresEnv
  return !Array.isArray(env) || env.length === 0
}

/**
 * The catalog stores `>=0.21.4`; the labels already carry the `≥` glyph, so the
 * raw operator must be stripped before it is interpolated.
 */
function prettyRequirement(value) {
  return String(value || '')
    .trim()
    .replace(/^>=?\s*/, '')
}

/**
 * Cut a long blurb at the nearest sentence end, so a capped preview never stops
 * mid-sentence; with no boundary in range, cut hard and mark the truncation.
 */
function clipDescription(text) {
  const value = String(text || '')
  if (value.length <= MAX_CHARS) return value
  const head = value.slice(0, MAX_CHARS)
  // Only a sentence end that is actually followed by whitespace counts — a
  // bare `.` in ".onion" or "hermes.json" must not split a sentence. One extra
  // char is scanned so a boundary at the cap can still see what follows.
  const boundaryRe = /[.!?。！？](?=\s)|\n/g
  let boundary = -1
  for (const match of value.slice(0, MAX_CHARS + 1).matchAll(boundaryRe)) {
    const end = match.index + match[0].length
    if (end <= MAX_CHARS) boundary = end
  }
  return boundary >= CLIP_MIN ? head.slice(0, boundary).trimEnd() : `${head.trimEnd()}…`
}

/** Seven hex chars are enough to tell two revisions apart on a card. */
function shortSha(sha) {
  return String(sha || '').slice(0, 7)
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
// card details
// ---------------------------------------------------------------------------

/** A labelled row that simply doesn't exist when the field is empty. */
function detailRow(label, value, key) {
  return jsxs(
    'div',
    {
      className: 'flex min-w-0 gap-2',
      children: [
        label
          ? jsx('span', { className: 'w-24 shrink-0 text-(--ui-text-tertiary)', children: label })
          : null,
        jsx('div', { className: 'min-w-0 flex-1 break-words', children: value })
      ]
    },
    key || label
  )
}

/**
 * Inline expansion of one card. Every field is conditional: the catalog has
 * gaps (only 670/800 versions, 144/800 platforms, …), and an empty row would
 * just be noise. `readme` is a boolean flag, not text — hence a link only.
 */
function DetailPanel({ entry, blurb, t }) {
  const caps = entry.capabilities || {}
  const env = Array.isArray(caps.requiresEnv) ? caps.requiresEnv : []
  const tools = Array.isArray(caps.providesTools) ? caps.providesTools : []
  const hooks = Array.isArray(caps.providesHooks) ? caps.providesHooks : []
  const middleware = Array.isArray(caps.providesMiddleware) ? caps.providesMiddleware : []
  const platforms = Array.isArray(entry.platforms) ? entry.platforms : []
  const screenshots =
    Array.isArray(entry.screenshots) && entry.screenshots.length
      ? entry.screenshots.slice(0, 3)
      : entry.image
        ? [entry.image]
        : []
  // GitHub raw is frequently unreachable from China; a broken thumbnail is
  // worse than no thumbnail, so each failure removes just that image.
  const [failedShots, setFailedShots] = useState(() => new Set())
  const visibleShots = screenshots.filter(url => !failedShots.has(url))

  const rows = []
  const fullText = blurb || entry.description || ''
  if (fullText) {
    rows.push(
      detailRow(
        t('descriptionLabel'),
        jsx('div', { className: 'whitespace-pre-line leading-relaxed', children: fullText }),
        'blurb'
      )
    )
  }
  if (entry.version) rows.push(detailRow(t('ver'), entry.version, 'version'))
  if (platforms.length) rows.push(detailRow(t('platformsLabel'), platforms.join(', '), 'platforms'))
  if (entry.maintainer) {
    rows.push(
      detailRow(
        t('maintainerLabel'),
        entry.maintainerSlug
          ? jsx('button', {
              type: 'button',
              onClick: () =>
                openExternal(`https://github.com/${entry.maintainerSlug}`, t('openFailed')),
              className: 'cursor-pointer underline-offset-4 hover:underline',
              children: entry.maintainer
            })
          : entry.maintainer,
        'maintainer'
      )
    )
  }
  if (entry.installCommand) {
    rows.push(
      detailRow(
        t('installCommandLabel'),
        jsxs('div', {
          className: 'flex min-w-0 items-center gap-2',
          children: [
            jsx('code', {
              className: 'min-w-0 flex-1 truncate font-mono text-xs',
              children: entry.installCommand
            }),
            jsx(CopyButton, {
              appearance: 'inline',
              text: entry.installCommand,
              label: t('copyCommand')
            })
          ]
        }),
        'command'
      )
    )
  }
  if (env.length) {
    rows.push(
      detailRow(
        t('envLabel'),
        jsxs('div', {
          className: 'flex flex-wrap items-center gap-1.5',
          children: [
            ...env.map(name =>
              jsx(Badge, { variant: 'warn', size: 'xs', children: name }, name)
            ),
            jsx('span', {
              className: 'text-(--ui-text-tertiary)',
              children: t('envHint')
            })
          ]
        }),
        'env'
      )
    )
  }
  if (tools.length) {
    const shown = tools.slice(0, 8).join(', ')
    rows.push(
      detailRow(
        t('toolsLabel'),
        tools.length > 8 ? `${shown} +${tools.length - 8}` : shown,
        'tools'
      )
    )
  }
  if (hooks.length) rows.push(detailRow(t('hooksLabel'), String(hooks.length), 'hooks'))
  if (middleware.length) {
    rows.push(detailRow(t('middlewareLabel'), String(middleware.length), 'middleware'))
  }

  const links = [
    entry.readmeUrl ? { url: entry.readmeUrl, label: t('readmeLink') } : null,
    entry.repo ? { url: entry.repo, label: t('repoLink') } : null,
    entry.docsUrl ? { url: entry.docsUrl, label: t('docsLink') } : null
  ].filter(Boolean)

  const hasContent = rows.length || visibleShots.length || links.length

  return jsxs('div', {
    className: 'mt-2 flex flex-col gap-1.5 border-t border-(--ui-border) pt-2 text-xs',
    children: [
      ...rows,
      visibleShots.length
        ? detailRow(
            t('screenshotsLabel'),
            jsx('div', {
              className: 'flex flex-wrap gap-2 overflow-hidden',
              children: visibleShots.map(url =>
                jsx(
                  'img',
                  {
                    src: url,
                    alt: '',
                    loading: 'lazy',
                    className:
                      'h-24 w-auto max-w-full cursor-pointer rounded border border-(--ui-border) object-cover',
                    onClick: () => openExternal(url, t('openFailed')),
                    onError: () =>
                      setFailedShots(prev => {
                        const next = new Set(prev)
                        next.add(url)
                        return next
                      })
                  },
                  url
                )
              )
            }),
            'screenshots'
          )
        : null,
      links.length
        ? detailRow(
            '',
            jsx('div', {
              className: 'flex flex-wrap gap-3',
              children: links.map(link =>
                jsx(
                  'button',
                  {
                    type: 'button',
                    onClick: () => openExternal(link.url, t('openFailed')),
                    className:
                      'cursor-pointer underline-offset-4 hover:underline hover:text-(--ui-text-primary)',
                    children: link.label
                  },
                  link.url
                )
              )
            }),
            'links'
          )
        : null,
      hasContent
        ? null
        : jsx('div', {
            className: 'text-(--ui-text-tertiary)',
            children: t('noDetails')
          })
    ]
  })
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

function CatalogPage() {
  const t = usePluginI18n(ID)
  const { locale } = useI18n()

  // The sidebar label is registered outside React and 0.21.2 has no locale-change
  // hook, so re-sync it whenever the page re-renders for a new app language.
  useEffect(() => {
    syncNavLabel(pluginCtx)
  }, [locale])

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
  /** Desktop halves on disk (`<plugins root>/<name>`) — invisible to the agent list. */
  const [desktopHalves, setDesktopHalves] = useState(() => new Set())
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  /** Two practical filters: it runs here, and it runs without configuration. */
  const [installableOnly, setInstallableOnly] = useState(false)
  const [noEnvOnly, setNoEnvOnly] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('user')
  const [pendingRemove, setPendingRemove] = useState(null)
  const [pendingBulk, setPendingBulk] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [busyName, setBusyName] = useState('')
  const [bulk, setBulk] = useState(null)
  const [tick, setTick] = useState(0)
  /** Unknown when the bridge or its preload is older than 0.21.2. */
  const [hermesVersion, setHermesVersion] = useState('')
  /** `win32` / `darwin` / `linux`; empty when the bridge can't tell us. */
  const [hermesPlatform, setHermesPlatform] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [updatingName, setUpdatingName] = useState('')
  /** Single value, so opening one card's details closes the previous one. */
  const [openName, setOpenName] = useState('')
  /** Thumbnails that failed to load; never re-mounted, so no broken-image icons. */
  const [failedThumbs, setFailedThumbs] = useState(() => new Set())
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

  const fetchCatalog = useCallback(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS)
    try {
      const res = await fetch(CATALOG_URL, { cache: 'no-cache', signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    setStatus('loading')
    setError('')
    let lastError = ''
    // One retry: a flaky network or a slow CDN is the common failure here.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await fetchCatalog()
        setEntries(Array.isArray(data) ? data : [])
        setFetchedAt(new Date().toISOString())
        setStatus('ready')
        return
      } catch (e) {
        lastError = String((e && e.message) || e)
      }
    }
    setError(lastError)
    setStatus('error')
  }, [fetchCatalog])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  /**
   * The catalog lists a `requiresHermes` per entry, but the loader silently
   * skips a plugin it can't satisfy. Read the app version once so cards can
   * warn instead. No bridge (plain browser, old preload) simply stays unknown.
   */
  useEffect(() => {
    let alive = true
    const readVersion = async () => {
      try {
        const bridge = typeof window !== 'undefined' ? window.hermesDesktop : undefined
        if (!bridge || typeof bridge.getVersion !== 'function') return
        const info = await bridge.getVersion()
        const version = info && info.appVersion
        const platform = info && info.platform
        if (alive && typeof version === 'string' && versionParts(version)) setHermesVersion(version)
        if (alive && typeof platform === 'string' && platform) setHermesPlatform(platform)
      } catch {
        /* version stays unknown — cards then never warn */
      }
    }
    void readVersion()
    return () => {
      alive = false
    }
  }, [])

  /** Any filter change starts the list over at the first page. */
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, category, sort, onlyInstalled, sourceFilter, installableOnly, noEnvOnly])

  /**
   * The app's own plugin folder. A package can ship a desktop half with no agent
   * half at all — then `plugins.manage list` (an agent-side view) reports nothing
   * for it and the card wrongly claimed it was not installed. This is the same
   * read the built-in Plugins tab uses to place that half.
   */
  const refreshDesktopHalves = useCallback(async () => {
    try {
      const bridge = typeof window !== 'undefined' ? window.hermesDesktop : undefined
      if (!bridge || typeof bridge.desktopPluginsRoot !== 'function') return
      const root = await bridge.desktopPluginsRoot()
      if (!root) return
      const res = await bridge.readDir(root)
      const dirs = (res && res.entries ? res.entries : [])
        .filter(entry => entry.isDirectory)
        .map(entry => entry.name)
      setDesktopHalves(new Set(dirs))
    } catch {
      /* no bridge or an unreadable folder: cards keep the agent-side answer */
    }
  }, [])

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
    await refreshDesktopHalves()
  }, [refreshDesktopHalves])

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

  /** Desktop-only installs the agent list can't see — they count as installed too. */
  const desktopOnlyCount = useMemo(() => {
    let extra = 0
    for (const name of desktopHalves) if (!installedNames.has(name)) extra += 1
    return extra
  }, [desktopHalves, installedNames])

  const installedCount =
    (installedCounts[sourceFilter] ?? installedCounts.all) +
    (sourceFilter === 'bundled' ? 0 : desktopOnlyCount)
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

  /** How many entries survive each practical filter, for the chip labels. */
  const installableCount = useMemo(
    () => entries.filter(entry => isInstallable(entry, hermesVersion, hermesPlatform)).length,
    [entries, hermesVersion, hermesPlatform]
  )
  const noConfigCount = useMemo(() => entries.filter(needsNoConfig).length, [entries])

  /** Installed plugins the catalog doesn't list (Git installs, bundled, desktop-only). */
  const localRows = useMemo(() => {
    if (!onlyInstalled) return []
    const rows = installedRows
      .filter(row => rowMatchesSource(row))
      .filter(row => !entries.some(e => e.name === row.name || e.name === row.catalog_name))
      .map(row => ({
        name: row.name,
        description: row.description || '',
        tier: row.source === 'bundled' ? 'bundled' : 'user',
        stars: 0,
        local: true
      }))
    // A desktop half with no agent half and no catalog entry of its own.
    if (sourceFilter !== 'bundled') {
      const seen = new Set(rows.map(row => row.name))
      for (const name of desktopHalves) {
        if (seen.has(name) || installedNames.has(name)) continue
        if (entries.some(entry => entry.name === name)) continue
        rows.push({ name, description: '', tier: 'desktop', stars: 0, local: true })
      }
    }
    return rows
  }, [
    onlyInstalled,
    installedRows,
    entries,
    rowMatchesSource,
    desktopHalves,
    installedNames,
    sourceFilter
  ])

  /** Rebuilt when translations land (`tick`) so a translated blurb is searchable. */
  const fieldsByEntry = useMemo(() => {
    const map = new Map()
    for (const entry of entries) map.set(entry.name, buildFields(entry, resolvedTarget, t))
    return map
  }, [entries, resolvedTarget, tick, t])

  const compiledQuery = useMemo(() => compileQuery(query), [query])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const active = SORTS.find(s => s.id === sort) || SORTS[0]
    const base = []
    for (const entry of entries) {
      if (category) {
        const slug = entry.category || ''
        if (category === '__none' ? slug !== '' : slug !== category) continue
      }
      if (
        onlyInstalled &&
        !(
          (Boolean(installedByName.get(entry.name)) || desktopHalves.has(entry.name)) &&
          rowMatchesSource(installedByName.get(entry.name))
        )
      ) {
        continue
      }
      if (installableOnly && !isInstallable(entry, hermesVersion, hermesPlatform)) continue
      if (noEnvOnly && !needsNoConfig(entry)) continue
      const score = compiledQuery ? scoreFields(fieldsByEntry.get(entry.name), compiledQuery) : 0
      if (compiledQuery && score === 0) continue
      base.push({ ...entry, score })
    }
    base.sort(
      (a, b) =>
        b.score - a.score || active.cmp(a, b) || (b.stars || 0) - (a.stars || 0)
    )
    // Local rows have no catalog fields; the original three-field match stands.
    const locals = localRows.filter(entry => entryMatches(entry, needle, resolvedTarget))
    // `tick` re-sorts after a translation lands so search-visible state stays true.
    return locals.length ? [...base, ...locals] : base
  }, [
    entries,
    query,
    compiledQuery,
    category,
    sort,
    resolvedTarget,
    onlyInstalled,
    installedNames,
    installedByName,
    desktopHalves,
    rowMatchesSource,
    localRows,
    fieldsByEntry,
    installableOnly,
    noEnvOnly,
    hermesVersion,
    hermesPlatform,
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

  const markThumbFailed = useCallback(url => {
    setFailedThumbs(prev => {
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }, [])

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
      const input = clipDescription(entry.description)
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

  /** The exact queue a bulk run would use, so the cost shown is the real cost. */
  const queueFor = useCallback(
    list => list.filter(entry => !cache[cacheKey(entry, resolvedTarget)] && (entry.description || '').trim()),
    [cache, resolvedTarget]
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
            chunk.map(entry => clipDescription(entry.description)),
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
    const q = queueFor(pending)
    if (q.length) setPendingBulk({ queue: q })
  }, [pending, queueFor])

  const translateSelected = useCallback(() => {
    const q = queueFor(selectedPending)
    if (q.length) setPendingBulk({ queue: q })
  }, [selectedPending, queueFor])

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

  /** Re-pin a catalog install to the SHA the catalog now lists. */
  const updateEntry = useCallback(
    async entry => {
      const row = installedByName.get(entry.name)
      if (!row) return
      const name = row.name || row.catalog_name || entry.name
      setUpdatingName(entry.name)
      try {
        const res = await host.request('plugins.manage', { action: 'update', name }, 180000)
        if (!res || !res.ok) throw new Error((res && res.error) || 'update rejected')
        host.notify({
          kind: 'success',
          message: res.unchanged ? t('updateUnchanged') : t('updatedOk', name)
        })
        await refreshInstalled()
        setTick(v => v + 1)
      } catch (e) {
        const message = String((e && e.message) || e)
        // 4020 = not a catalog install; retrying can never help, so say what can.
        if ((e && e.code === 4020) || message.includes('not a catalog install')) {
          host.notify({ kind: 'warning', message: t('updateNotCatalog', name) })
        } else {
          host.notify({ kind: 'error', message: t('updateFailed', message) })
        }
      } finally {
        setUpdatingName('')
      }
    },
    [installedByName, refreshInstalled, t]
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

  /**
   * A plugin is a *package* that can carry two halves — the agent half in the
   * profile's `plugins/`, and the desktop half in the app's `desktop-plugins/`.
   * Uninstall removes both, and neither half being absent is an error: whichever
   * one is there goes. The desktop half is only reachable through the app's own
   * door (`removeDesktopPlugin`, the one the built-in Plugins tab's trash uses).
   */
  const removePackage = useCallback(
    async (entry, row) => {
      const name = (row && (row.name || row.catalog_name)) || entry.name
      const errors = []
      let removedAgent = false
      let removedDesktop = false

      // The name becomes a shell argument below, so refuse anything that isn't
      // a plain plugin slug before either half is touched.
      if (!PLUGIN_NAME_RE.test(String(name || ''))) {
        errors.push(t('invalidName', name))
        return { errors, removedAgent, removedDesktop }
      }

      try {
        const res = await host.request(
          'shell.exec',
          { command: `hermes plugins remove ${name}` },
          180000
        )
        if (res && res.code === 0) removedAgent = true
        else {
          // The gateway's PATH may not include a local dev CLI; surface its
          // stderr instead of pretending the removal silently failed.
          errors.push(`agent: ${(res && (res.stderr || res.stdout)) || 'remove failed'}`)
        }
      } catch (e) {
        errors.push(`agent: ${(e && e.message) || e}`)
      }

      const bridge = typeof window !== 'undefined' ? window.hermesDesktop : undefined
      const canDropDesktop = !row || row.has_desktop_half !== false
      if (canDropDesktop && bridge && typeof bridge.removeDesktopPlugin === 'function') {
        try {
          const res = await bridge.removeDesktopPlugin({ name })
          if (res && res.ok) removedDesktop = true
          else errors.push(`desktop: ${(res && res.error) || 'rejected'}`)
        } catch (e) {
          errors.push(`desktop: ${(e && e.message) || e}`)
        }
        try {
          await bridge.reconcileDesktopPlugins?.()
        } catch {
          /* a sweep we can't run is not a failed uninstall */
        }
      }

      return { errors, removedAgent, removedDesktop }
    },
    [t]
  )

  /** ConfirmDialog's onConfirm: throw to keep the dialog open with the error. */
  const doUninstall = useCallback(async () => {
    const target = pendingRemove
    if (!target) return
    setBusyName(target.name)
    let out
    try {
      out = await removePackage(target, installedByName.get(target.name))
    } finally {
      setBusyName('')
    }
    if (!out.removedAgent && !out.removedDesktop) {
      // Tell the user about the manual escape hatch too — the gateway's PATH
      // may simply not have the CLI.
      const message = [
        out.errors.join(' · ') || 'remove rejected',
        PLUGIN_NAME_RE.test(target.name) ? t('uninstallCliHint', target.name) : ''
      ]
        .filter(Boolean)
        .join(' · ')
      host.notify({ kind: 'error', message: t('uninstallFailed', message) })
      throw new Error(message)
    }
    host.notify({ kind: 'success', message: t('uninstalled', target.name) })
    setPendingRemove(null)
    await refreshInstalled()
    setTick(v => v + 1)
  }, [installedByName, pendingRemove, refreshInstalled, removePackage, t])

  const translatedCount = filtered.length - pending.length

  return jsxs('div', {
    className: 'flex h-full min-w-0 min-h-0 flex-col gap-3 p-4',
    children: [
      // ── header: title + one status line, actions on the right ─────────────
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2',
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
        className: 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('rankBy') }),
              jsxs(Select, {
                value: sort,
                onValueChange: next => setSort(next),
                children: [
                  jsx(SelectTrigger, {
                    className:
                      'h-6 max-w-[15rem] rounded border border-(--ui-border) bg-(--ui-bg-input) px-1 text-xs outline-none',
                    'aria-label': t('rankBy'),
                    children: jsx(SelectValue, {})
                  }),
                  jsx(SelectContent, {
                    children: SORTS.map(option =>
                      jsx(SelectItem, { value: option.id, children: t(option.label) }, option.id)
                    )
                  })
                ]
              })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('filterCategory') }),
              jsxs(Select, {
                value: category === '' ? '__all' : category,
                onValueChange: next => setCategory(next === '__all' ? '' : next),
                children: [
                  jsx(SelectTrigger, {
                    className:
                      'h-6 max-w-[15rem] rounded border border-(--ui-border) bg-(--ui-bg-input) px-1 text-xs outline-none',
                    'aria-label': t('filterCategory'),
                    children: jsx(SelectValue, {})
                  }),
                  jsx(SelectContent, {
                    children: [
                      jsx(SelectItem, { value: '__all', children: t('all', entries.length) }, '__all'),
                      ...categories.map(([slug, count]) =>
                        jsx(
                          SelectItem,
                          { value: slug || '__none', children: `${categoryLabel(t, slug)} ${count}` },
                          slug || '__none'
                        )
                      )
                    ]
                  })
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
          jsx(Tip, {
            label: t('installableTip'),
            children: jsx('button', {
              type: 'button',
              onClick: () => setInstallableOnly(value => !value),
              'aria-pressed': installableOnly,
              className: cn(
                'rounded px-2 py-0.5',
                installableOnly
                  ? 'bg-(--ui-bg-quaternary) font-medium'
                  : 'text-(--ui-text-tertiary)'
              ),
              children: t('onlyInstallable', installableCount)
            })
          }),
          jsx(Tip, {
            label: t('noConfigTip'),
            children: jsx('button', {
              type: 'button',
              onClick: () => setNoEnvOnly(value => !value),
              'aria-pressed': noEnvOnly,
              className: cn(
                'rounded px-2 py-0.5',
                noEnvOnly ? 'bg-(--ui-bg-quaternary) font-medium' : 'text-(--ui-text-tertiary)'
              ),
              children: t('noConfigNeeded', noConfigCount)
            })
          }),
          onlyInstalled
            ? jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('sourceLabel') }),
                  jsxs(Select, {
                    value: sourceFilter,
                    onValueChange: next => setSourceFilter(next),
                    children: [
                      jsx(SelectTrigger, {
                        className:
                          'h-6 max-w-[15rem] rounded border border-(--ui-border) bg-(--ui-bg-input) px-1 text-xs outline-none',
                        'aria-label': t('sourceLabel'),
                        children: jsx(SelectValue, {})
                      }),
                      jsx(SelectContent, {
                        children: [
                          jsx(
                            SelectItem,
                            { value: 'user', children: `${t('sourceUser')} ${installedCounts.user}` },
                            'user'
                          ),
                          jsx(
                            SelectItem,
                            {
                              value: 'bundled',
                              children: `${t('sourceBundled')} ${installedCounts.bundled}`
                            },
                            'bundled'
                          ),
                          jsx(
                            SelectItem,
                            { value: 'all', children: `${t('sourceAll')} ${installedCounts.all}` },
                            'all'
                          )
                        ]
                      })
                    ]
                  })
                ]
              })
            : null,
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: t('targetLang') }),
              jsxs(Select, {
                value: target,
                onValueChange: next => setTarget(next),
                children: [
                  jsx(SelectTrigger, {
                    className:
                      'h-6 max-w-[15rem] rounded border border-(--ui-border) bg-(--ui-bg-input) px-1 text-xs outline-none',
                    'aria-label': t('targetLang'),
                    children: jsx(SelectValue, {})
                  }),
                  jsx(SelectContent, {
                    children: TARGETS.map(option =>
                      jsx(
                        SelectItem,
                        { value: option.id, children: option.endonym || t('autoLang') },
                        option.id
                      )
                    )
                  })
                ]
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
        ? jsxs('div', {
            className: 'rounded-md border border-(--ui-danger) p-3 text-sm',
            children: [
              jsx('div', { children: t('loadFailed', error) }),
              jsx('div', {
                className: 'mt-1 text-xs text-(--ui-text-tertiary)',
                children: t('loadRetryHint')
              })
            ]
          })
        : status === 'loading'
          ? jsxs('div', {
              className: 'flex items-center gap-2 py-12 text-sm text-(--ui-text-tertiary)',
              children: [jsx(GlyphSpinner, {}), t('loading')]
            })
          : !filtered.length
            ? jsx(EmptyState, {
                title: t('searchNoResult'),
                description: t('searchTip')
              })
            : jsx('div', {
              className:
                'min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] pr-2',
              children: jsxs('div', {
                className: 'flex flex-col gap-2',
                children: [
                  filtered.slice(0, visibleCount).map((entry, rank) => {
                  const key = cacheKey(entry, resolvedTarget)
                  const blurb = cache[key]
                  const row = installedByName.get(entry.name)
                  const hasDesktopHalf = desktopHalves.has(entry.name)
                  const isInstalled = Boolean(row) || hasDesktopHalf
                  const rowEnabled = Boolean(row) && row.status === 'enabled'
                  // The desktop half's switch belongs to the app; we can only
                  // take the user to it (see `desktopHalfHint`).
                  const showsDesktopHalf =
                    Boolean(row && row.has_desktop_half) || (!row && hasDesktopHalf)
                  const busy = busyName === entry.name
                  const isSelected = selected.has(entry.name)
                  // Header keeps ONE date; the tooltip carries both so nothing is lost.
                  const updatedText = entry.updatedAt
                    ? t('updatedAgo', agoText(t, entry.updatedAt))
                    : ''
                  const addedText = entry.addedAt ? t('addedAgo', agoText(t, entry.addedAt)) : ''
                  const primaryDate = updatedText || addedText
                  const dateTip = [updatedText, addedText].filter(Boolean).join(' · ')
                  const updating = updatingName === entry.name
                  const canUpdate = Boolean(row && row.update_available === true)
                  const versionKnown = Boolean(hermesVersion)
                  const versionOk =
                    !entry.requiresHermes || satisfies(entry.requiresHermes, hermesVersion)
                  const versionWarn = versionKnown && !versionOk
                  const isOpen = openName === entry.name
                  // Screenshot first (it shows the thing working), cover second.
                  const shot =
                    (Array.isArray(entry.screenshots) && entry.screenshots[0]) || entry.image || ''
                  const thumbSrc = shot && !failedThumbs.has(shot) ? shot : ''
                  return jsxs(
                    'div',
                    {
                      className: cn(
                        'min-w-0 rounded-md border p-3',
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
                            jsx(Badge, {
                              size: 'xs',
                              variant:
                                TIER_BADGE_VARIANT[entry.tier || 'community'] || 'muted',
                              children: t(`tier.${entry.tier || 'community'}`)
                            }),
                            entry.requiresHermes
                              ? jsx(Tip, {
                                  label: versionWarn
                                    ? t('installWillSkip')
                                    : t('requiresVersion', prettyRequirement(entry.requiresHermes)),
                                  children: jsx('span', {
                                    className: cn(
                                      'text-xs',
                                      versionWarn
                                        ? 'text-(--ui-danger)'
                                        : 'text-(--ui-text-tertiary)'
                                    ),
                                    children: versionWarn
                                      ? t(
                                          'requiresVersionWarn',
                                          prettyRequirement(entry.requiresHermes)
                                        )
                                      : t('requiresVersion', prettyRequirement(entry.requiresHermes))
                                  })
                                })
                              : null,
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
                                  className: 'text-xs tabular-nums text-(--ui-text-tertiary)',
                                  children: `★${formatStars(entry.stars)}`
                                })
                              : null,
                            // One date, not two: the newest one is the signal the
                            // user scans for; both stay available in the tooltip.
                            primaryDate
                              ? jsx(Tip, {
                                  label: dateTip,
                                  children: jsx('span', {
                                    className: 'text-xs text-(--ui-text-tertiary)',
                                    children: primaryDate
                                  })
                                })
                              : null,
                            jsx('div', { className: 'flex-1' }),
                            entry.local
                              ? null
                              : jsx(Button, {
                                  size: 'xs',
                                  variant: 'ghost',
                                  type: 'button',
                                  'aria-expanded': isOpen,
                                  onClick: () => {
                                    haptic('tap')
                                    setOpenName(prev => (prev === entry.name ? '' : entry.name))
                                  },
                                  children: jsxs('span', {
                                    className: 'inline-flex items-center gap-1',
                                    children: [
                                      jsx(DisclosureCaret, { open: isOpen }),
                                      isOpen ? t('hideDetails') : t('details')
                                    ]
                                  })
                                }),
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
                                      children: row ? t('installed') : t('installedDesktopOnly')
                                    }),
                                    canUpdate
                                      ? jsx(Badge, {
                                          size: 'xs',
                                          variant: 'success',
                                          children: t('updateAvailable')
                                        })
                                      : null,
                                    versionWarn
                                      ? jsx(Badge, {
                                          size: 'xs',
                                          variant: 'warn',
                                          children: t('installedButSkipped')
                                        })
                                      : null,
                                    row && row.key
                                      ? jsx(Tip, {
                                          label: rowEnabled ? t('disableTip') : t('enableTip'),
                                          children: jsx(Switch, {
                                            checked: rowEnabled,
                                            disabled: busy,
                                            'aria-label': t('toggleAria', entry.name),
                                            className: SWITCH_CLASS,
                                            onCheckedChange: next => toggleEntry(entry, next)
                                          })
                                        })
                                      : null,
                                    canUpdate
                                      ? jsx(Tip, {
                                          label: t(
                                            'updateTip',
                                            shortSha(row.installed_sha),
                                            shortSha(row.catalog_sha)
                                          ),
                                          children: jsx(Button, {
                                            size: 'xs',
                                            variant: 'secondary',
                                            type: 'button',
                                            disabled: busy || updating,
                                            onClick: () => updateEntry(entry),
                                            children: updating ? t('updating') : t('update')
                                          })
                                        })
                                      : null,
                                    !row && !busy
                                      ? jsx(Button, {
                                          size: 'xs',
                                          variant: 'outline',
                                          type: 'button',
                                          onClick: () => installEntry(entry),
                                          children: t('installAgentHalf')
                                        })
                                      : null,
                                    jsx(Button, {
                                      size: 'xs',
                                      variant: 'ghost',
                                      type: 'button',
                                      disabled: busy || updating,
                                      onClick: () => setPendingRemove(entry),
                                      children: t('uninstall')
                                    })
                                  ]
                                })
                              : versionWarn
                                ? jsx(Tip, {
                                    label: t('installWillSkip'),
                                    children: jsx(Button, {
                                      size: 'xs',
                                      variant: 'destructive',
                                      type: 'button',
                                      disabled: busy,
                                      onClick: () => installEntry(entry),
                                      children: busy ? '…' : t('install')
                                    })
                                  })
                                : jsx(Button, {
                                    size: 'xs',
                                    variant: 'default',
                                    type: 'button',
                                    disabled: busy,
                                    onClick: () => installEntry(entry),
                                    children: busy ? '…' : t('install')
                                  })
                          ]
                        }),
                        jsxs('div', {
                          className: 'mt-1 flex min-w-0 items-start gap-3',
                          children: [
                            thumbSrc
                              ? jsx('img', {
                                  src: thumbSrc,
                                  alt: '',
                                  loading: 'lazy',
                                  decoding: 'async',
                                  className:
                                    'h-20 w-20 shrink-0 cursor-pointer rounded border border-(--ui-border) object-cover sm:w-32',
                                  onClick: () => openExternal(thumbSrc, t('openFailed')),
                                  onError: () => markThumbFailed(thumbSrc)
                                })
                              : null,
                            jsx('div', {
                              className: 'min-w-0 flex-1 break-words text-sm leading-relaxed',
                              style: BLURB_CLAMP,
                              children: blurb || entry.description || ''
                            })
                          ]
                        }),
                        isOpen
                          ? jsx(DetailPanel, { entry, blurb, t })
                          : null,
                        showsDesktopHalf
                          ? jsx('div', {
                              className: 'mt-1.5',
                              children: jsx(Tip, {
                                label: t('desktopHalfHint'),
                                children: jsx(Button, {
                                  size: 'xs',
                                  variant: 'outline',
                                  type: 'button',
                                  onClick: () => {
                                    try {
                                      host.navigate('/capabilities?tab=plugins')
                                    } catch (e) {
                                      host.notify({
                                        kind: 'error',
                                        message: t('toggleFailed', (e && e.message) || e)
                                      })
                                    }
                                  },
                                  children: t('desktopHalfAction')
                                })
                              })
                            })
                          : null
                      ]
                    },
                    key
                  )
                  }),
                  filtered.length > visibleCount
                    ? jsx('div', {
                        className: 'flex justify-center pt-1',
                        children: jsx(Button, {
                          size: 'sm',
                          variant: 'outline',
                          type: 'button',
                          onClick: () =>
                            setVisibleCount(count =>
                              Math.min(filtered.length, count + PAGE_SIZE)
                            ),
                          children: t(
                            'showMore',
                            Math.min(PAGE_SIZE, filtered.length - visibleCount)
                          )
                        })
                      })
                    : null
                ]
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
      }),
      jsx(ConfirmDialog, {
        open: Boolean(pendingBulk),
        onClose: () => setPendingBulk(null),
        onConfirm: () => {
          const q = pendingBulk.queue
          setPendingBulk(null)
          void runTranslation(q)
        },
        title: t('translateConfirmTitle', pendingBulk ? pendingBulk.queue.length : 0),
        description: pendingBulk
          ? t(
              'translateConfirmBody',
              pendingBulk.queue.length,
              Math.ceil(pendingBulk.queue.length / BATCH_SIZE),
              resolvedTarget
            )
          : '',
        confirmLabel: t('translateConfirmGo')
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
    } catch {
      /* an already-disposed entry is not an error */
    }
  }
  navLabel = label
  disposeNav = ctx.register({
    id: 'nav',
    area: SIDEBAR_NAV_AREA,
    data: { path: PAGE_PATH, label, codicon: 'globe' }
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

    syncNavLabel(ctx)
    // `ctx.i18n.onLocaleChange` is 0.21.5+; guard it so an older desktop shell
    // still loads (the label is then kept fresh by the retries and by the page).
    if (typeof ctx.i18n.onLocaleChange === 'function') {
      ctx.i18n.onLocaleChange(() => syncNavLabel(ctx))
    }
    for (const delay of [200, 800, 2000]) {
      setTimeout(() => syncNavLabel(ctx), delay)
    }
  }
}
