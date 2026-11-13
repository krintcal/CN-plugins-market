# Codex 任务：评审并改进 cn-plugins-market 插件（v2.4.1）

仓库：`E:\Hermes\core\profiles\priestess\plugins\cn-plugins-market`（git 仓库，主文件 `desktop/plugin.js`，约 2400 行）

## 这是什么

一个 Hermes Desktop 的**桌面插件页面**（不是 web 应用）：单文件、用 `@hermes/plugin-sdk` + React 的 `jsx()/jsxs()`（**不能用 JSX 语法**）渲染一个「插件管理器」——列出本机已装插件，分组（开发中 / 另外安装的 / 内置）、开关、更新、全部更新、卸载、卸载桌面半边、从 Git 安装、详情面板里的「开发态」（git 分支、源文件与运行副本是否一致、被认领提示）。

## 你的任务

**先评审，再改进，最后写报告。** 优先修真实缺陷，不要为了改而改。

评审重点（按重要性）：

1. **正确性**：`plugins.manage` 各 action 的参数与返回值处理（list / toggle / update / update_all / remove / remove_desktop / inspect / install / install_desktop）；update 的两类拒绝分支（`consent_required` 带 `accept_capabilities` 重试、`scan_blocked` 的 caution 档带 `force` 重试）是否有漏洞；卸载时 agent/desktop 半边与「属于某个包」的判定；安装流程的 inspect→install 状态机；行去重与 React key 是否唯一；`desktop-only` 合成行（source `'desktop'`）在各种操作下的行为。
2. **分组判定**：`detectDev()` 的启发式（`source==='desktop'` / `source==='user' && has_desktop_half` / `source==='git' && !pinned_sha`，外加 `devOverrides` 手动覆盖）。有没有更稳、更少误判的判法？**注意：Electron 的 `readFileText` 会拒绝读 `.git` 下的文件**（敏感路径），所以不能靠读 `.git/config` 判断 remote。
3. **性能与渲染**：`plugins.manage list` 本身要 3～5 秒（73 个插件），已有 `rows.v1/v2` 缓存 + stale-while-revalidate；检查是否还有重复请求、无谓的全量重渲染、useMemo/useCallback 依赖错误、effect 依赖缺失导致的死循环或失真。
4. **健壮性**：桥（`window.hermesDesktop`）缺失时；`desktopPluginsRoot()` 返回空；路径含空格/中文；插件名特殊字符；`install_dir` 为空；列表请求超时/失败；缓存里是旧版本 schema 的数据。
5. **交互与视觉细节**：左右分栏在窄窗口（<900px）下是否会挤坏；空态/加载态/错误态是否都覆盖；危险操作（卸载）是否有确认；操作后列表与选中项是否同步刷新；键盘可达性（Tab/Enter/aria）。
6. **i18n**：`en` / `zh` / `'zh-hant'` 三个键集合必须完全一致、没有用到不存在的键、没有残留死键。
7. **代码质量**：死代码（例如 `syncable = false` 之后的同步逻辑、`readGitHead`、`parseGitStatus` 是否仍被使用）、重复实现、可读性。

## 硬约束

- **不改 `E:\Hermes\core\hermes-agent`（Hermes 本体）**，只改这个仓库里的文件。
- 不新增任何 npm 依赖；只用 `@hermes/plugin-sdk` 的公开导出。
- **禁止 JSX 语法**，一律 `jsx()/jsxs()`；三语言 i18n 键集合必须仍完全一致。
- 不要 `git commit`、不要 `git push`、不要重启 Hermes 桌面端。
- **不要调用 `shell.exec`**（桌面插件里不可用，网关回 `invalid_params`）；不要尝试写文件到插件目录之外。
- 插件 id 必须仍是 `cn-plugins-market`；`plugin.yaml` 的 `name` 不要改，`version` 改成 `2.5.0`。

## 交付

1. 直接改代码（`desktop/plugin.js`、必要时 `CHANGELOG.md`、`plugin.yaml`）。
2. 自检并把**真实输出**贴进报告：`node --check desktop/plugin.js`、三语言键数一致（自己写个小脚本比对）、`grep` 确认没有 `shell.exec` / 没有 JSX 转译残留 / 没有 `profile:` 参数。
3. 在仓库根写 `REVIEW.md`：分了哪几类问题、每条「问题 → 改了什么 → 为什么」，以及**你认为还没解决、需要人决定的点**。
