# cn-plugins-market v2.4.1 评审与 v2.5.0 改进

评审日期：2026-11-13。先完整阅读 `desktop/plugin.js`，核对接口契约，再修改实现并执行自检。优先修功能正确性、异步状态和错误处理；没有增加 npm 依赖。

## 1. 接口正确性与确认流程

| 级别 | 原问题 | 改了什么 | 为什么 |
| --- | --- | --- | --- |
| P1 | Ref 留空时 `install_desktop` 没有 `ref`，后端直接拒绝 | 始终传 inspect 返回并展示的完整 SHA | 桌面安装接口要求已检查的提交，不能只传仓库 URL |
| P1 | inspect 未绑定输入；修改 URL/Ref、关闭面板后旧请求仍能写回 | 保存检查时的 identifier/ref；输入或面板变化递增 epoch，过期响应不落地；安装再次校验快照 | 防止拿 A 仓库的检查结果安装 B 仓库 |
| P1 | 任意 Ref 没有真正被 inspect 检查，界面却允许继续 | 当前 inspect 不支持 Ref；明确校验指定 Ref 等于 inspect 的 SHA，否则报错 | 不向用户暗示已经检查了实际上没检查的提交 |
| P1 | scan → consent → 重试会丢 `force`；反向链路只保存部分状态 | 两种确认都保存并携带已有选项；再次被拒绝时继续展示拒绝 | 两种顺序都需要保留用户已作出的明确选择 |
| P1 | 已带重试选项时再次拒绝只显示普通错误 | 再次返回 consent/scan 仍展示相应面板；只有 caution 显示强制重试按钮 | 不吞掉新拒绝，也不为 dangerous/未知 verdict 提供 force 按钮 |
| P2 | `update_all` 失败对象或畸形响应会显示“0 更新”成功提示 | 校验 results/skipped 数组和结果状态，拒绝失败响应 | 空结果和失败不能混为一谈 |
| P2 | 开关、单项更新、全部更新、安装、卸载可能并发，单个 busyName 会被提前清空 | 增加同步 ref 操作锁，页面操作期间统一禁用写操作控件 | 同一事件周期内的双击也不能重复提交 |

核对的 action：`list` 无额外参数；`toggle` 使用 canonical `key` 和 `enable`；`update` 使用 `name` 和明确确认后的选项；`update_all` 无额外参数；`remove` 使用 `name`；`remove_desktop` 使用实际目录名；`inspect` 使用 `identifier`；`install` 使用 `identifier/enable` 和 `inspected_sha` 或匹配的 `ref`；`install_desktop` 使用 `identifier/ref`。没有添加 `profile` 参数。

为避免猜接口，只读核对了本机 `tui_gateway/contracts/tools_mcp_plugins.py`、`methods_tools.py` 及对应安装/卸载实现；没有修改或运行 hermes-agent 文件，也没有向真实网关发送写请求。

## 2. 行身份、半边与卸载

- **React key 不等于选择身份** → agent 行统一按 canonical registry key 去重，桌面合成行使用独立命名空间；选择、busy、错误缓存均使用同一身份 → 同名不同 category 的行能独立选择，重复 canonical key 不重复渲染。
- **同名行的按名称操作有歧义** → 保留按 key 的 toggle，隐藏重复名称的 update/remove 并显示原因 → 后端这两个接口没有 canonical key 参数，不能由前端猜目标。
- **所有行都提供卸载，包括内置行** → 内置行不再提供 agent 卸载 → 后端只支持删除用户安装。
- **用 key 叶名/catalog_name 推测桌面目录，且无条件提供 remove_desktop** → 根据 `.hermes-package.json` 的 package 归属关联；无标记时只做唯一名称匹配；保留实际目录名 → 别名或 catalog 名称相同不足以证明属于同一个包。
- **包所属桌面半边不可独立删除** → 已认领目录隐藏独立卸载入口，回调也再次检查；不发送强制删除 → 后端默认拒绝这类删除，后续 reconcile 也可能恢复它。
- **desktop-only 行没有安装路径，开发态永不显示，还会复制错误的 agent 删除命令** → 使用桥返回的实际桌面目录，展示独立桌面说明，保留独立删除；移除未经转义且不适用于桌面行的“复制删除命令” → 特殊字符名称不再被拼入可执行命令。路径复制仍保留。
- **卸载无保护/失败丢状态风险** → 保留 ConfirmDialog；失败继续保留确认框并交由对话框显示错误 → 用户能看到失败原因并重试。

## 3. 分组与开发态

- **安装来源被当成作者归属** → 保留 `dev.overrides` 的手动 on/off 作为最高优先级；在此之上保留一层**默认推测**（`looksLikeOwnWork`：手放在 app 目录的桌面半边 / 本机安装且带桌面页 / 未被 catalog 固定 SHA 的 git checkout）→ 纯手动判定会让升级后「开发中」变空，与使用习惯不符；推测可被逐行手动推翻，误判成本很低。
- **读取被禁止的 `.git` 后误报“非 Git 仓库”** → 删除 `readGitHead`、`parseGitStatus`、账号 remote 正则及相关不可达 UI，明确显示 Git 元数据不可用 → 读取失败不能证明不是 Git，也不尝试引入命令执行。
- **根目录 plugin.js 的包被误报源缺失** → 比较源文件时支持 `desktop/plugin.js` 与根目录 `plugin.js` → 对齐两种桌面文件布局。
- **截断读取被误判为同步** → 任一副本截断时显示无法比较 → 两段相同的文件前缀不能证明完整文件相同。
- **刷新后开发态仍使用旧结果** → 刷新清缓存，并用 epoch 丢弃刷新前未完成的文件读取 → 更新后的文件不会继续显示旧比较结果。

## 4. 请求、缓存、健壮性与交互

- **昂贵 list 可重复发起** → 模块级共享进行中的 list；组件级合并刷新；list 与桌面枚举并行 → 保留立即显示缓存、后台更新的行为，避免同一次刷新重复扫描。
- **修改完成后可能复用修改前的列表** → 操作后刷新明确等待旧请求，再发新 list → 最终列表来自修改之后；选中项仍存在则保留，否则自动回落。
- **旧 schema 或坏字段可能直接进入 React** → 使用带 schema 版本的 `rows.v3`，过滤坏行、规范化字符串和布尔字段；live list 的畸形行报错，失败保留上次好列表 → 旧缓存不再把非法对象作为 React 文本渲染。
- **桌面桥缺失、root 为空、文件拒绝或桥挂起** → 桥方法检查、空路径短路、10 秒桥调用超时、读取失败降级；枚举失败保留现有目录信息 → 页面不因桥能力缺失崩溃，不再拼出相对运行目录。
- **打开目录的异步拒绝未捕获** → 对 revealPath 的 Promise 添加 catch → 失败能给出反馈而不是未处理拒绝。
- **无谓 effect 依赖变化** → filteredDev/filteredInstalled 使用 useMemo，开发分组直接派生 → 不再为每次无关渲染重建选择集合或额外写分组缓存。
- **固定 19rem 左栏挤压窄窗口** → 基于页面容器宽度的原生 container query，小于 900px 上下排列；左栏最多占 42%，详情可滚动；工具栏可换行 → 不依赖宿主未编译的新增 Tailwind 响应式类。
- **键盘选中态不明确** → 保留原生 button 的 Tab/Enter 行为，增加 aria-pressed、焦点 outline 和含 canonical key 的 title → 重名行也可以辨识。
- **i18n 死键与失效同步逻辑遗留** → 移除 16 个不用的旧键，新增实际使用的错误/说明文本 → en/zh/zh-hant 各 124 个键；静态调用和明确列举的动态调用分支均检查，缺失与未使用均为零。

插件 id/name 仍是 `cn-plugins-market`；版本改为 `2.5.0`；最低 Hermes 版本统一为原页面声明的接口门槛 `0.22.5`。没有新增 SDK 私有导出。未 commit、未 push、未重启 Hermes；所有写入限于本仓库，原有未跟踪的 `BRIEF-CODEX.md` 保留。

## 5. 尚未解决、需要人决定或实机验收的点

1. **自动识别“本人开发”需要可靠元数据。** 目前采用手动标记，首次升级后以前仅凭来源推断的插件会归入“另外安装的”。若希望自动分组，需要后端/公开桥提供明确的开发标记或归属信息；不应恢复读 `.git/config` 或账号硬编码。
2. **无法 inspect 任意历史 Ref。** 本次只允许与当前检查 SHA 相同的 Ref，其他 Ref 明确报错。要完整支持历史提交检查，需要后端 inspect 新增 Ref 能力；本次没有修改本体。
3. **Git 分支、dirty/ahead/behind 无法通过当前公开桥取得。** 现在诚实显示不可用。是否提供专用只读元数据接口，需要宿主侧决定。
4. **手动开发标记仍按名称保存。** 同名的多个 canonical 行会共享标记，以保留现有偏好格式；若需要逐行独立归属，需要决定偏好迁移规则。按名称的更新/卸载也受后端接口限制，本次对歧义行采取禁用策略。
5. **桥目录视图与网关安装位置必须属于同一台机器。** 本地 Desktop 是当前目标；若连接远端网关，不能仅凭本地目录视图保证远端 remove_desktop 操作的是同一份安装，需要宿主公开服务器侧 presence/ownership。
6. **后端确认选项没有前端可绑定的事务令牌。** 前端保存的是同一行的用户选择；检查与应用之间源变更、后端安装路径校验和安全扫描仍由后端负责。本次不声称实现了跨请求事务。
7. **未做真实桌面视觉/键盘及端到端写操作验收。** 自检执行真实 JS 的 helpers、事件回调和 effect，但 React/SDK/桥/网关为模拟，不能代替 Electron 中 800px/899px/900px 布局、长中文路径和 SDK ConfirmDialog 的实机操作。没有重启或热重载操作，也没有为了测试实际安装/卸载任何插件。
8. **缓存版本升级会有一次冷加载。** `rows.v1/v2` 不作为可信新 schema 读取；后续使用 `rows.v3` 恢复即时缓存首屏。list 本身的 3～5 秒成本没有改动后端。

## 6. 真实自检输出

`scripts/self-check.cjs` 使用 Node 内置模块，无依赖；执行真实插件代码，模拟 React hook 调度和 SDK/桥，验证异步回调与状态更新。对 i18n 的动态调用明确列出 source/status 分支；禁止模式扫描仅针对交付的 `desktop/plugin.js`，报告和历史日志中提及的字符串不属于运行代码。

以下为最终检查命令的原样 stdout/stderr；Node 语法检查成功时本身没有 stdout，随后显式打印退出码。

```text
> node --check desktop/plugin.js
exit=0

> node scripts/self-check.cjs
i18n en: 124 keys
i18n zh: 124 keys
i18n zh-hant: 124 keys
i18n sets identical; missing=0; unused=0
metadata: id/name=cn-plugins-market; version=2.5.0
rg shell.exec: no matches (exit 1)
rg JSX / transform residue: no matches (exit 1)
rg profile parameter: no matches (exit 1)
PASS canonical identity, deduplication and malformed cache rows
PASS inspected SHA binds both install paths and rejects stale input/ref
PASS path handling and incomplete comparisons
PASS conservative dev grouping with persistent manual overrides
PASS missing bridge, cached rendering, stable effects and shared list requests
PASS cold list failure, malformed response and empty desktop root
PASS shared list request also deduplicates independent consumers
PASS bridge timeout is bounded and file-read rejection degrades safely
PASS selection follows canonical key for colliding names
PASS update consent-scan retains both explicit approvals
PASS update scan-consent retains both explicit approvals
PASS dangerous scan cannot force and repeated refusal remains visible
PASS mutation lock rejects overlapping toggle/update; post-mutation refresh is fresh
PASS mutation completion queues a fresh snapshot behind an older list
PASS old inspect response cannot install a different repository
PASS desktop install passes reviewed SHA; mismatched ref blocks inspect
PASS package marker controls pairing and desktop removal, standalone stays manageable
PASS remove failure retains confirmation and exposes the backend failure
PASS bulk errors are surfaced instead of reporting zero successful updates
PASS bulk mixed results preserve review status and refresh
Regression checks: 20 passed, 0 failed
exit=0

> git diff --check
exit=0

```
