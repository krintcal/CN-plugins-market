# Changelog

## 1.2.6 — 2026-10-24

- **新增两个筛选：「能装的」和「免配置」。** 这两个是筛选，不是排行口径——把它们塞进排序里会让"看某个分类里有什么"变味。
  - 能装的：用本机版本（`getVersion().appVersion`）过一遍 `requiresHermes`，再过一遍 `platforms`（目录里 63 条标了 windows、106 条 macos、108 条 linux；空数组＝不分平台）。本机 0.21.2 + Windows 实测 **409/800** 能装。
  - 免配置：`capabilities.requiresEnv` 为空，装上就能跑，实测 **620/800**；两个条件同时满足 **313 条**。
  - 版本或平台读不到时**不排除任何条目**——按猜测隐藏比多显示更糟。
  - 芯片上带实时数量，和其它筛选是 AND 关系，切换时列表回到第一页。

## 1.2.5 — 2026-10-24

- **侧栏入口不再中英混着出。** 页面里全是中文，侧边栏却常写着 `Plugin catalog`：入口的文案是在 `register()` 那一刻读一次的，而 App 往往还没把用户语言 hydrate 完，读到的就是默认的英文；等页面渲染时语言已经对了，于是「框里中文、侧栏英文」。现在改成 `syncNavLabel()`：只有解析出来的标签真的变了才重新注册（先 dispose 旧的），并且三处都会触发——注册后 200/800/2000ms 的重试、页面因语言变化重渲染时、以及 0.21.5+ 才有的 `onLocaleChange`。0.21.2 没有那个钩子，所以前两条是主力。

## 1.2.4 — 2026-10-24

- **卡片上直接显示预览图。** 有截图用第一张，否则用封面（`image`），放在简介左边当缩略图，点开是原图。`raw.githubusercontent.com` 在国内经常拉不动，所以每张图都挂了 `onError`：拉不到就把这张图从卡片上摘掉、只留文字（详情里那 3 张同理），不留破图。卡片是缩略图，详情里仍是原图。
- **简介默认收成三行。** 之前 1500 字的简介整段摊开，一张卡占满一屏。现在卡片上只给三行（内联 `-webkit-box` clamp，不依赖 Tailwind 的 line-clamp 插件），完整简介挪到详情面板第一行（新增 `descriptionLabel`）；`DetailPanel` 多接一个 `blurb` prop，因此详情里看到的是**翻译后**的全文。
- **版本要求显示成 `≥`。** 目录里存的是 `>=0.21.4`，文案模板本身已经带 `≥`，两个叠在一起会变成 `≥>=0.21.4`。新增 `prettyRequirement()`，渲染时把前导 `>=` 去掉；数据字段和 `satisfies()` 的判断一个字没动。

## 1.2.2 — 2026-10-24

- **修卡片横向溢出（真机截图已确认）。** 列表从 SDK 的 `ScrollArea` 换成原生滚动 div：`ScrollArea` 内部把 children 包在 `display: table` 的容器里，而这个容器是 shrink-to-fit、会涨到 `max-content` 宽度，于是 flex 列拿到的是「整段简介一行不换行」的宽度，卡片跟着变宽，正文在窗口内被裁、右侧的译 / 安装 / 详情 / 开关按钮被推到窗口外。换成原生 div 后滚动容器加 `overflow-x-hidden`，卡片根节点加 `min-w-0`，简介加 `break-words`；详情面板的截图行加 `overflow-hidden`、缩略图加 `max-w-full`，header / 筛选栏补 `min-w-0`。只改布局，检索、翻译、安装、升级、卸载、分页逻辑一行没动。

## 1.2.1 — 2026-10-24

- **检索词表收窄。** 去掉一批过于宽泛的英文词：`数据库` 不再映射 `data`，`代理` 不再映射 `network`，`用量` 不再映射 `token`，`定时` 不再映射 `task`，`统计` 不再映射 `stat`；`桌面` 只保留 `desktop` / `gui`，不再用 `ui` / `window`。同时补上更精确的词根（`database` / `sqlite` / `postgres`、`proxy` / `vpn` / `tunnel`、`cron` / `schedul` / `timer`、`metric` / `analytic` 等）。中文键组合取最长匹配，`数据库` 不会顺带展开成 `数据`。
- **词首 / 整词匹配。** 用户输入的原始查询仍是子串匹配，英文插件名打一半照样能搜到；词表展开出的英文词改成：三字母及以下整词匹配（`gui` 不会命中 `guide`），四字母及以上词首匹配（`translat` 仍命中 `translate` / `translation`）。正则按 query 编译一次，不再对 800 条 × 每个 token 反复构造。
- **相关度优先排序。** 有搜索词时先按相关度排：名称命中 3 分、简介或当前语言译文命中 2 分、只在分类 / 档位 / 维护者 / 版本 / 平台 / 工具 / 钩子命中 1 分；同分再走当前排行口径和 star 数。0 分直接不显示，相关结果不再被人气埋掉。
- **实测（真实目录 800 条）。** 旧：桌面 465、数据库 408、代理 276、用量 211、定时 201、图片 99、语音 74、视频 17。新：桌面 259、数据库 65、代理 26、用量 105、定时 90、图片 72、语音 71、视频 17；`新闻` 42、`翻译` 33、`memory` 130，乱敲 `asdfgh` 仍为 0。

## 1.2.0 — 2026-10-24

- **卡片可以展开看详情。** 每张卡多了一个「详情 / 收起详情」按钮（`DisclosureCaret` 表达展开态），同一时间只展开一条，展开区域就地插在卡片下方，不打乱列表滚动位置。详情区逐项按「有数据才渲染」列出：版本、平台、维护者（有 slug 时可点进 GitHub）、安装命令（等宽字体 + `CopyButton`）、`requiresEnv`（警示 `Badge` + 「未配置可能启动不了」）、工具名（最多 8 个，其余显示 `+N`）、钩子/中间件数量、最多 3 张截图和 README/仓库/文档链接。目录里的 `readme` 只是布尔标记而不是正文（800 条全覆盖，但没有任何可用文本），所以这里只给 `readmeUrl` 链接，不硬凑 README。GitHub raw 在国内常被墙，每张缩略图 `onError` 单独隐藏，全部失败就整块不渲染，不留破图。
- **中文检索不再空手而归。** 目录 800 条里只有 11 条简介含中文，原来的检索只比 `name` / 英文 `description` / 已缓存译文，输「记忆」「语音」「图片」几乎搜不到。新增 `CN_SYNONYMS` 词表，把 83 个中文意图（记忆/桌面/语音/图片/视频/邮件/代理/定时/数据库/翻译/额度……）映射到英文关键词；每条 entry 的 `name + description + 当前语言译文 + 分类 + 档位 + 维护者 + 版本 + 平台 + 工具/钩子` 预拼成一个 haystack，任一展开词命中即算命中。纯本地字符串匹配，**不调模型、不联网**。列表为空时给出「没有匹配；试试英文插件名，或先把简介翻译出来再搜」。

## 1.1.0 — 2026-10-24

- **修 P0：卸载其实什么都没删。** 后端 `plugins.manage` 从来没有 `remove` 这个 action（只会回 4017），所以 agent 半边永远删不掉。现在改走本机 `hermes plugins remove <名字>`；名字先过 `/^[A-Za-z0-9._-]+$/` 白名单再拼命令，避免把任意文本送进 shell。网关进程的 PATH 里可能没有本地开发用的 CLI，所以非 0 退出码会把 stderr 带进错误提示，并在失败时告诉用户「也可以自己在终端执行」。桌面半边的 `removeDesktopPlugin` + `reconcileDesktopPlugins` 逻辑不变，两个半边都失败才算失败。
- **修 P0：`verified` 档位露出裸 key。** 目录 800 条里有 7 条 `tier: 'verified'`，但语言包没有这个键，卡片上直接显示 `tier.verified`。三种语言补上「已认证 / 已認證 / verified」，并改用 SDK 的 `Badge` 渲染档位，官方和已认证有了视觉区分，原有文案顺序不变。
- **P1：一键升级已装插件。** 用后端已经给出的 `update_available` / `installed_sha` / `catalog_sha`：可升级的卡片显示「可升级」徽标和「升级」按钮，点击走 `plugins.manage {action:'update'}` 并刷新已装列表；`unchanged` 提示「已是最新」；4020「不是目录安装」不再重试，而是提示改用 `hermes plugins update <名>` 或 App 插件页。两个短 SHA 放在 Tip 里，不占主行。
- **P1：版本门槛提示。** 目录里 358 条要求比本机 0.21.2 更新的 Hermes，而 loader 版本不满足时会静默跳过。启动时读一次 `getVersion()`（失败就当作未知），用自带的 semver 比较 `satisfies()` 判断；卡片显示「需 ≥x.y.z」，不满足时用警示色、安装按钮换警示样式并说明「装了也会被跳过」，已装的还额外标「已装但加载被跳过」。版本未知时不误报。
- **P1：目录卡片分批渲染。** 800 张卡首屏只渲染 60 张，底部「再显示 60 条」每次加 60；搜索、分类、排行、只看已安装、来源任一变化都重置回 60，全部显示完按钮消失。
- **P2：目录抓取补上超时和重试。** `CATALOG_TIMEOUT_MS` 之前定义了却没用，现在用 `AbortController` 包住 `fetch`，超时或失败自动重试一次；错误文案旁补一句「可能需要开启代理」。
- **P2：长简介不再从半句话截断。** 79 条简介超过 1500 字，原来直接 `slice` 会切在半句中间。新增 `clipDescription()`：回退到最近的句号/换行处，找不到边界才硬切并补 `…`；单条翻译和批量翻译共用。

## 1.0.0 — 2026-10-04

First release.

- Catalog page in the Desktop app (sidebar nav + `/cn-plugins-market` route).
- Four ranking modes: most starred, recently updated, newly listed, most capable.
- Category filter and search (matches the translation once it exists).
- One-click install through `plugins.manage`.
- Per-entry and bulk translation of plugin blurbs. Bulk runs batch **8 entries per model call**; a run stops itself after 3 consecutive failed calls.
- Checkbox selection per card behind an explicit `Select` mode, plus `Select all N shown` (respects the current filter) and `Translate N selected`. The selection clears itself when a run finishes.
- Live bulk progress: spinner + `done/total` + the name of the entry being translated.
- An enable/disable switch on installed rows (`plugins.manage toggle`, the same one the built-in Plugins tab drives); packages with a separate desktop half get a shortcut that navigates to that tab, since desktop-plugin decisions are app-owned and read-only for plugins.
- `Installed only` filter, including installed plugins the catalog doesn't list (Git installs, bundled), each with an `Uninstall` button behind a confirmation dialog that removes the **whole package** — the agent half through `plugins.manage remove`, the desktop half through the app's own `removeDesktopPlugin` door (the one the built-in trash uses), tolerating whichever half is absent and sweeping with `reconcileDesktopPlugins`; a `Source` control splits your own installs from the bundled defaults, which are hidden by default.
- The enable/disable switch is repainted with the page's own `--ui-*` variables: the SDK switch fills its checked track with the theme's `primary`, which is white in the light theme (and its checked thumb goes white too), so in light mode the control vanished against the card.
- Desktop halves are read from the app's own plugin folder, so packages that ship no agent half at all (`cn-plugins-market`, `usage-stats`-style installs) no longer read as "not installed"; such a row offers `Add its agent half`, and the installed count includes them.
- The chrome collapses to two rows: ranking, category, installed-only and target language became compact dropdowns instead of chip rows.
- The sidebar entry re-registers on a language switch instead of stranding in the language active at load.
- Translations cached per `<plugin>@<sha>#<language>`: switching the target language never displays another language's text.
- Configurable target language, defaulting to the app language.
- UI strings shipped in English, 简体中文 and 繁體中文.
