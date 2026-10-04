# Changelog

## 1.0.0 — 2026-10-04

First release.

- Catalog page in the Desktop app (sidebar nav + `/cn-plugins-market` route).
- Four ranking modes: most starred, recently updated, newly listed, most capable.
- Category filter and search (matches the translation once it exists).
- One-click install through `plugins.manage`.
- Per-entry and bulk translation of plugin blurbs. Bulk runs batch **8 entries per model call**; a run stops itself after 3 consecutive failed calls.
- Checkbox selection per card behind an explicit `Select` mode, plus `Select all N shown` (respects the current filter) and `Translate N selected`. The selection clears itself when a run finishes.
- Live bulk progress: spinner + `done/total` + the name of the entry being translated.
- An enable/disable switch on installed rows (`plugins.manage toggle`, the same one the built-in Plugins tab drives), plus a note on plugins whose desktop half is opened separately.
- `Installed only` filter, including installed plugins the catalog doesn't list (Git installs, bundled), each with an `Uninstall` button behind a confirmation dialog; a `Source` control splits your own installs from the bundled defaults, which are hidden by default.
- The chrome collapses to two rows: ranking, category, installed-only and target language became compact dropdowns instead of chip rows.
- The sidebar entry re-registers on a language switch instead of stranding in the language active at load.
- Translations cached per `<plugin>@<sha>#<language>`: switching the target language never displays another language's text.
- Configurable target language, defaulting to the app language.
- UI strings shipped in English, 简体中文 and 繁體中文.
