# CN-plugins-market

Browse the [Hermes](https://hermes-agent.nousresearch.com) plugin catalog **inside the Desktop app, in your own language.**

The curated catalog is written in English. This plugin adds a catalog page to Hermes Desktop that ranks it, installs from it, and — the point of the whole thing — **translates each plugin's blurb into the language you choose**, caching the translation so you only ever pay for it once.

> 官方插件目录是英文的。这个插件在 Hermes 桌面端里加一页「插件目录」：可排行、可一键安装，并把每个插件的简介**翻成你选的语言**——译文按插件缓存，翻过一次就永久复用。

## Features / 功能

- **A real ranking.** Sort the catalog by **most starred**, **recently updated**, **newly listed**, or **most capable** (tools + hooks), with the rank number on every card. Category chips and a search box (searches the translation too, once you have one).
- **One-click install.** Same backend path as the built-in catalog page (`plugins.manage`), so installed state stays in sync across the app.
- **Translate on demand, or in bulk.** `Translate` on a single card, or `Translate N untranslated` to walk the current filter. Progress with a stop button.
- **Cached forever.** Translations are keyed by `<plugin>@<pinned sha>`, so a plugin that updates comes back untranslated rather than showing you a stale blurb — and everything else stays free.
- **Target language is yours.** Follows the app language by default (zh → 简体中文, zh-hant → 繁體中文, ja → 日本語, …), or pick from the list. UI strings ship in English, 简体中文 and 繁體中文 via the plugin SDK's own i18n bundles.
- **Click the name** to open the plugin's repository in your browser.

## Install / 安装

From the Hermes plugin catalog:

```bash
hermes plugins install cn-plugins-market --enable
```

or manually:

```bash
git clone https://github.com/krintcal/CN-plugins-market.git ~/.hermes/desktop-plugins/cn-plugins-market
```

Then, in the Desktop app: **⌘K → Reload desktop plugins**. The page appears in the sidebar as **Plugin catalog**.

## Screenshots

Add `screenshots/*.png` here; they are rendered as the gallery on the plugin's catalog page.

## How it works

- Desktop-only plugin: a single ESM file, `desktop/plugin.js`, using nothing but the public plugin SDK (`@hermes/plugin-sdk`) — it registers one full page (`ROUTES_AREA`) and one sidebar row (`SIDEBAR_NAV_AREA`).
- The catalog is fetched from the same public URL the app itself uses (`plugins.json`), with HTTP caching disabled so re-opening the page always shows the current listing.
- Everything else — ranking, search, filters, the translation cache, your last-used sort/language — is computed and stored locally (`ctx.storage`).

## Cost & privacy

- Browsing, ranking, searching and installing are **free**, and read no credentials.
- The only model call is an explicit translation, one plugin per call, through the gateway's `llm.oneshot` on **whatever provider and model you already have active** — no separate key, no separate bill. Bulk-translating a 400-entry catalog is a fraction of a cent on a cheap model; after that it is cached and free.
- Nothing leaves your machine except the catalog fetch (the same public URL the app fetches) and your own translation calls to your own provider. No telemetry, no self-updater.

## Requirements

- Hermes Agent Desktop, `>=0.21.5`.

## License

MIT — see [LICENSE](LICENSE).
