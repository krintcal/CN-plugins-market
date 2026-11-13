# Changelog

## 2.5.0 — 2026-11-13

由 Codex（`gpt-6.1-sol`，high）做的一轮评审 + 改进，之后我补了两处。

**评审改掉的（挑重点）**

- **安装流程会装错仓库**：inspect 结果没和输入绑定，改了 URL/Ref 或关掉面板后，旧响应还能落地安装。现在保存检查时的 identifier/ref + 版本号，过期响应直接丢弃，安装前再校验一次快照。
- **Ref 其实没被检查过**：inspect 不支持任意 ref，界面却允许继续。现在要求指定的 ref 必须等于 inspect 回来的 SHA，否则明确报错；`install_desktop` 一律带上已检查的完整 SHA。
- **scan → consent → 重试会丢掉 `force`**：两种确认现在各自保留并携带已有选项；再次被拒仍展示拒绝面板，只有 caution 才给「仍然更新」。
- **并发写操作**：加了操作锁，双击不会重复提交；操作完成后等旧 list 请求结束再发新的，列表一定是改完之后的。
- **卸载边界**：内置行不再给卸载；被包认领的桌面目录不再给独立卸载；同名歧义行走保守策略并说明原因；失败保留确认框并把后端错误显示出来。
- **缓存与健壮性**：`rows.v3` 带 schema 版本、过滤坏行；桥缺失/目录为空/读取被拒/桥挂起（10s 超时）都降级而不是崩；打开目录的 Promise 补 catch。
- **去重与身份**：agent 行按 canonical key 去重、桌面合成行独立命名空间；选择/忙碌/错误都用同一身份，同名行不会互相串。
- **i18n**：删掉 16 个死键，新增实际用到的文案，三语言各 124 个键；补了 `scripts/self-check.cjs`（20 条回归检查）。

**我补的两处**

- **「开发中」默认推测恢复了**：Codex 认为来源字段不能证明作者归属，改成只能手动标记 —— 那样升级后「开发中」会变空。现在保留手动 `dev.overrides` 为最高优先级，同时保留一层默认推测（手放桌面半边 / 本机安装且带桌面页 / 未被固定 SHA 的 git checkout），误判一键可翻。
- **左右分栏的断点改用内联样式**：Codex 用的是注入 `<style>` + CSS container query，宿主并不应用注入样式，结果两栏塌成一栏。现在左边定宽 20rem、最多占 38%，不再依赖 CSS 断点。

## 2.5.0 — 2026-11-13

- 修复 `install_desktop` 未传入已检查 SHA 的问题；inspect 结果绑定仓库和 Ref，输入变更或关闭面板后丢弃旧响应。当前网关无法检查指定 Ref，Ref 与检查提交不一致时明确拒绝继续。
- 修复 capability consent 与 caution scan 两种顺序交替出现时丢失重试选项的问题；重复拒绝仍展示，dangerous 档不提供强制更新入口。
- 统一 canonical key 去重、React key、详情选中和行错误；重名 agent 行保留独立开关，隐藏有歧义的按名称更新/卸载操作。
- 读取包标记关联桌面半边；仅独立、未认领的桌面目录提供单独卸载，内置行不再提供 agent 卸载。
- 合并并发 list 请求，操作后等待旧请求并重新取列表；校验缓存 schema 与批量更新返回值，桥调用增加超时，目录打开 Promise 拒绝得到处理。
- 开发分组以持久化手动标记为准，不再把安装来源当作作者归属。不再尝试读取被桥禁止访问的 Git 元数据；保留源/运行副本比较，截断读取不判为一致。
- 窄于 900px 的页面容器改为上下布局，增加焦点样式和选中态 aria；清理无用代码及翻译，三语言各 124 键。
- 版本 `2.5.0`，最低 Hermes 版本与使用的接口门槛统一为 `0.22.5`。新增无依赖回归脚本 `scripts/self-check.cjs`；评审和实际输出见 `REVIEW.md`。

## 2.4.0 — 2026-11-13

- **修「开发中」判定**：原来只有 `.git/config` 的 remote 指向 `github.com/krintcal/…` 才算开发中，本地手写、根本没 `git init` 的 `hermes-heartbeat` / `hermes-restart` 被错分到「另外安装的」。现在规则是：非内置插件目录下**没有** `.git`（读不到 `.git/config`）→ 开发中；有 `.git` 时 remote 仍须指向 `github.com/krintcal/…`。判定结果继续随列表一起缓存（`rowsCache.dev`）。
- **页面改成左右分栏（master-detail）。** 外层用满宽度（不再 `max-w-3xl`）：左边 `19rem` 固定栏 = 搜索框 + 筛选 + 三组列表（开发中 / 另外安装的 / 内置，内置默认折叠）；右边自适应详情 = 名称/版本/来源徽标 + 开关 + 「状态 / 来源与更新 / 开发态 / 路径 / 操作」分节，路径支持打开目录与复制，底部是更新、卸载、卸载桌面半边、复制命令。
- **默认选中第一项**：`selectedName` 初始为空，列表就绪后自动落到「开发中」第一行；搜索/筛选/刷新导致选中项不在可见列表里时，回落到第一行。内置组折叠不影响已选中的内置项。
- **开发态只读保留**：仍直接读 `.git/HEAD` 和 `.git/config`，对比源与运行副本；`重读` 可单独刷新当前插件。
- 移除页面里已失效的同步到运行副本代码（桌面插件拿不到命令执行能力），不再包含任何命令执行调用。
- **i18n**：新增 `detailStatus`、`detailSourceSection`、`detailPathSection`、`detailActions`、`selectHint`、`halfAgent`、`halfDesktop`、`halfYes`、`halfNo`（三语言各 124 → 133 键）。
- 版本 → `2.4.0`；list / toggle / update / update_all / remove / remove_desktop / inspect / install / install_desktop、consent 与 scan 流程、缓存逻辑均未改。

## 2.3.0 — 2026-11-13

- **分成三组**：`开发中（我自己的）` / `另外安装的` / `内置`（默认折叠），状态行改成 `1 个开发中 · 9 个另外装的 · 63 个内置 · 2 个有更新`。
- **怎么判断"我自己开发的"**：后端只给 `bundled` / 非 `bundled`，所以靠本地 `.git/config` 里的 remote 判 —— remote 指向 `github.com/krintcal/…`（你自己的账号）就是开发中。结果连同列表一起缓存，刷新时重算。
- 筛选与搜索仍然只作用于"开发中 + 另外安装的"，内置组不受影响。

## 2.2.1 — 2026-11-13

- **首屏不再等 3～5 秒。** `plugins.manage list` 在 73 个插件上要几秒（网关要读每个包的清单），原来每次进来都是白屏 +「正在读取已安装插件…」。现在把上一次成功的结果存进 `rows.v1`，下次进来**直接画出列表**，状态行后面跟一句「正在读取」表示后台在刷新；刷新失败也保留旧列表，不再把「网络抖一下」变成「我一个插件都没有」。
- 冷启动（应用刚起、还没缓存过一次）仍会是那几秒 —— 那是后端扫描的时间，不是界面的。

## 2.2.0 — 2026-11-13

**详情面板加「开发态」。** 只在有 desktop 半边且有安装路径的行出现，**展开时才拉数据**（一次只读当前这一行），结果按插件名缓存在组件 state 里；`重读` 清掉该行缓存重拉。

- **运行副本一致性**：用桥的 `readFileText` 读源 `desktop/plugin.js` 与 `<appRoot>\desktop-plugins\<name>\plugin.js`，去掉 `// synced copy of` 标记行、行尾空白与首尾空行后比较 —— `已同步` / `待同步`（附两边字节数差）/ `源缺失` / `运行副本不存在`。
- **git 分支/提交**：直接读 `.git/HEAD` 与对应 ref 文件（不执行任何命令），显示 `git: main`。
- **认领警告**：运行副本目录里出现 `.hermes-package.json` 时红字提示「已被 Hermes 认领（opt-in），侧边栏默认不显示」。
- **i18n**：新增 `devState`、`devGitBranch`、`devCopySynced`、`devCopyPending`、`devCopyNoSource`、`devCopyMissing`、`devCopyClaimed`、`devReread`、`devLoading`、`devBadPath`、`devRunCopy` 等（三语言各 106 → 123 键）。
- 版本 → `2.2.0`；未改任何既有 list / toggle / update / remove / install 逻辑，未动 agent 半边。

**过程中踩到两件事（已按现实改掉）**

- `readFileText` 返回的是 `{ text, byteSize, truncated }` 对象，不是字符串。一开始按字符串判断，源文件永远"读不到"，界面上就是「源缺失」。已改成认对象。
- **`shell.exec` 在桌面插件里调不通**：网关直接回 `invalid_params`，所以 `git status` 的未提交/ahead-behind、以及 `copy` 同步**都做不了**。同步按钮暂时隐藏（`syncable = false`），开发态只留"能纯读文件拿到"的部分。要恢复这两项，得让插件自己的 **Python 半边**暴露一个 RPC（真正在网关进程里干活），或者由 Agent 侧代劳。

## 2.1.0 — 2026-11-13

**信息架构 + 视觉重做。** 功能逻辑（list / toggle / update / update_all / remove / remove_desktop / inspect / install / install_desktop、consent 与 scan 流程、错误红字）一行没动，只改分组和外观。

- **两组，默认收起内置**：`我的插件`（`source !== 'bundled'`）默认展开，`内置`默认折叠并在组头显示数量；组头整行可点，折叠状态写进 prefs 的 `sections`。
- **一眼看到自己的**：顶部状态行改成 `13 个自己的 · 63 个内置 · 2 个有更新`；筛选芯片与搜索**只作用于「我的插件」**，不再把 63 个内置一起筛出来。
- **来源徽标分档**：`git*` → Git、`catalog*` → 装自目录、`user` → 本地；内置组省略徽标。
- **窄容器 + sticky 工具栏**：`max-w-3xl` 居中，标题 + 状态行 + 全部更新 / 从 Git 安装 / 刷新图标；滚动时工具栏始终可见。
- **行重排**：状态点 + 名称 + 版本 + 来源徽标 + 固定 SHA；第二行 `已启用 · 桌面半边 · 有更新`；右侧只在有更新时出现「更新」，有 `key` 才出现开关，末尾是展开详情的 `›`。
- **详情面板**：两列网格（Key / 来源 / 版本 / 桌面半边 / 固定 SHA / 升级目标）+ 单独一行的路径（复制路径、打开目录）+ 卸载与复制命令；展开按钮带 `aria-expanded`。
- **空态与错误条**：筛选后无结果时显示「没有符合条件的插件」+「清除筛选」；加载/动作/单行/安装失败统一成细红条。
- **i18n**：新增 `mineGroup`、`bundledGroup`、`sourceGit`、`sourceCatalog`、`sourceLocal`、`emptyFiltered`、`clearFilters`、`copyPath`、`copied`、`expandRow`、`collapseRow`；删掉 `requiresVersion`、`agentNone`、`agentInstalled`、`details`、`hideDetails`、`sourceUser`、`sourceDesktop`、`noResult`、`noResultHint`（三语言各 104 → 106 键）。
- **首屏被旧偏好坑住**：`prefs` 里 1.x 存的 `filter: 'disabled'` 会被原样复原，一进来只剩一行停用插件 —— 现在加了 `PREFS_VERSION`，版本不符就整套丢弃并回 `all`。
- **开关看不出开没开**：插件文件的类名不在 App 编译后的 CSS 里，原来那套 `data-[state=checked]:…` 根本没生效，开着的插件显示成灰关；现在用 SDK 的 `Switch size="xs"` + 内联强调色（`var(--ui-accent, #7c5cff)`），开=紫色轨道。

## 2.0.0 — 2026-11-13

**转向：目录浏览器 → 自用插件管理器。** 不再抓远程 `plugins.json`、不再调模型翻译、不再有排行/星级/截图/分页 —— 那些为「逛商店」服务的功能整套删掉。页面只读本机，管已装的插件。

- **行式列表**：名称、版本、来源（内置 / 自己装的）、固定 SHA、agent 半边（已装·启用/停用）、desktop 半边（有/无）、可更新标记；右侧开关 + 详情。
- **筛选**：全部 / 已启用 / 已停用 / 有桌面半边 / 有更新 + 按名字过滤（客户端 `includes`）。
- **全部更新**：`plugins.manage update_all`，逐项结果。
- **更新**：`update`，并且**真的处理两类拒绝** —— `consent_required`（列 `delta_lines`，确认后带 `accept_capabilities` 重试）、`scan_blocked`（显示 `scan_verdict`/`scan_findings`，caution 档可带 `force` 重试）。
- **从 Git 安装**：`inspect` 先看源里有哪半边 → `install`（agent）/ `install_desktop`（只装桌面半边）。
- **卸载**：`remove`（agent 半边）/ `remove_desktop`（只卸桌面半边）；提示「重启网关后完全生效」。
- **详情**：安装路径 + 打开目录、key、来源、版本、固定 SHA、可升级目标、复制对应 `hermes plugins …` 命令。
- 版本门槛从「每一行都挂一个 需 ≥0.22.5」改成**顶部一条**（低于门槛才显示），因为后端 list 行里没有逐插件的 `requires_hermes`。
- 列表失败不再吞：红字带原始 message。

## 1.3.1 — 2026-10-28

- **修「只看已安装」一直是 0。** 0.22 的 `plugins.manage` 是 _scoped RPC：`profile` 参数的意思是「切到**另一个** profile 的 HERMES_HOME 去读」。我们一直把 `host.state.focusedSessionProfile` 传进去，而它在 socket 挂在 default 后端时会归一化成 `'default'`，于是列的是 `E:\Hermes\core`（默认 profile）的插件表 —— 那里没有用户插件，结果就是 0 条。现在 list / toggle / install / remove 四处**都不再传 `profile`**，后端就待在自己真正服务的那个 profile 里。
- **列表失败不再静默。** 之前 `catch {}` 把错误吞掉，读失败和「本来就是空」在界面上长得一模一样。现在失败会把消息显示成一行红字（新增 i18n `installedFailed`），下次再坏一眼能看见。

## 1.3.0 — 2026-10-25

- **详情里标出包的来源。** 0.22.5 的 `plugins.manage list` 行新增了 `portable`（Agent Plugins v1 便携包）和 `pinned_sha`（`--ref` 固定提交）。详情面板在「版本」后面补两个徽标：`便携`（Tip 说明「可原样搬到别的 Hermes」）和 `固定 @ xxxx`（Tip 说明「重新固定前不会跟随目录更新」）。这两个字段在目录 entry 上没有，所以 `DetailPanel` 多接一个 `row` prop，有数据才显示。
- **升级 / 卸载的提示说清生效条件。** 和内置插件页一致：升级后要重启网关才生效，卸载后也要重启网关才完全卸载。`updateUnchanged`（已是最新）没变。
- **git 安装的「可升级」不再装成目录升级。** `update_available` 对 git 安装也会为 true（靠 `update_target`），但目录升级接口对它们只会回 4020。现在只有 `catalog_sha` 存在才显示原来的「升级」按钮；只有 `update_target` 时徽标仍是「可升级」，按钮换成 ghost 的「去 App 里升级」，点击跳到 App 的插件页，Tip 说明这个包不是从目录装的。4020 分支保留作兜底。

## 1.2.8 — 2026-10-24

- **卸载改走原生 RPC。** 1.1.0 时后端没有 `remove`，只能用 `shell.exec` 调 CLI 兜底；0.22.5 的 `plugins.manage` 补上了 `remove`（和 `hermes plugins remove` 同一个核心函数 `dashboard_remove_user_plugin`）。现在优先发 `{action:'remove', name}`，只有后端回 `4017 unknown plugins action`（老版本）才退回 CLI。常见路径不再需要 shell，也不依赖 gateway 的 PATH。
- **升级提示显示版本号。** 0.22.5 的 list 行新增了 `catalog_version`，Tip 里从「两截短 SHA」改成「已装版本 → 目录版本」（拿不到版本时才退回 SHA）。
- **侧栏文案的重试收成一次。** 之前为 0.21.2（没有 `onLocaleChange`）打了 200/800/2000ms 三次重试；0.22.5 已经有该钩子，只保留注册后 400ms 的那一次，用来等 `display.language` 完成 hydrate。

## 1.2.7 — 2026-10-24

- **卡片顶部减负。** 原来一行塞了六项一样重的灰字（档位/分类/星数/更新于/首次收录于/工具数），扫不动。现在：星数缩成 `36.5k`（`formatStars`，四位以上才截断），两个日期合成一个——有 `updatedAt` 就显示「更新于 X」，否则退回「首次收录于 X」，两个都在 Tip 里；「工具 N」只在详情里出现（那里本来就有工具名列表）。
- **按钮有了主次。** 「安装」换成主色（`variant: 'default'`），「译」保持 ghost 安静，「详情」仍是带箭头的文字按钮。之前三个都是灰的，看不出哪个是主要动作。

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
