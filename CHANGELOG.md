# Changelog

## 1.0.0 — 2026-10-04

First release.

- Catalog page in the Desktop app (sidebar nav + `/cn-plugins-market` route).
- Four ranking modes: most starred, recently updated, newly listed, most capable.
- Category filter and search (matches the translation once it exists).
- One-click install through `plugins.manage`.
- Per-entry and bulk translation of plugin blurbs. Bulk runs batch **8 entries per model call**; a run stops itself after 3 consecutive failed calls.
- Checkbox selection per card, plus `Select all N shown` (respects the current filter) and `Translate N selected`.
- Translations cached per `<plugin>@<sha>#<language>`: switching the target language never displays another language's text.
- Configurable target language, defaulting to the app language.
- UI strings shipped in English, 简体中文 and 繁體中文.
