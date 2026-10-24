# Changelog

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
