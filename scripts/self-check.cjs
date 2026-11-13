// Dependency-free regression harness: executes the real plugin with a mocked SDK,
// bridge and React hook scheduler. It never talks to a gateway or mutates plugins.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8')
const dynamicKeys = ['sourceGit', 'sourceCatalog', 'sourceBundled', 'sourceLocal',
  'statusUpdated', 'statusCurrent', 'statusNeedsReview', 'statusFailed']
const usedKeys = new Set([...source.matchAll(/\bt\(\s*'([^']+)'/g)].map(match => match[1]).concat(dynamicKeys))
const instrumented = source.replace(/import[\s\S]*?from '[^']+'\r?\n/g, '')
  .replace('export default {', 'const plugin = {')
  .replace('  const chip = (id, label) =>', `
  globalThis.page = { refresh, runUpdate, runUpdateAll, toggleRow, runInspect, installHalf, doRemove,
    rows, allRows, selectedKey, consent, scan, inspect, loadError, status, refreshing, devCache,
    setPendingRemove, setInstallRepo, setInstallRef, setSelectedKey, loadDev, toggleDev, devSet }
  const chip = (id, label) =>`)
  + '\nglobalThis.api = { MESSAGES, ManagerPage, normalizeRows, rowKeyOf, canManageAgent, inspectedParams, compareCopy, isSafeName, joinPath, detectDev, requestList, hydrate, readMaybeText };'

function harness(initial = [], desktop) {
  const hooks = []
  let cursor = 0, effects = [], dirty = true, tree
  const calls = [], notices = []
  let respond = async params => params.action === 'list' ? { plugins: initial } : { ok: true }
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const context = vm.createContext({
    console, TextEncoder, setTimeout, clearTimeout,
    window: { hermesDesktop: desktop },
    host: { request: async (method, params, timeout) => {
      assert.equal(method, 'plugins.manage')
      assert.equal(typeof timeout, 'number')
      calls.push(params)
      return respond(params)
    }, notify: notice => notices.push(notice) },
    haptic() {}, cn: (...values) => values.filter(Boolean).join(' '),
    Badge: 'Badge', Button: 'Button', ConfirmDialog: 'ConfirmDialog', CopyButton: 'CopyButton',
    GlyphSpinner: 'GlyphSpinner', Switch: 'Switch', Tip: 'Tip',
    ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'nav',
    jsx: (type, props, key) => ({ type, props, key }),
    jsxs: (type, props, key) => ({ type, props, key }),
    useState(initialValue) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
      return [hooks[index].value, value => {
        const next = typeof value === 'function' ? value(hooks[index].value) : value
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true }
      }]
    },
    useRef(value) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { current: value }
      return hooks[index]
    },
    useMemo(make, deps) {
      const index = cursor++
      if (!hooks[index] || !same(hooks[index].deps, deps)) hooks[index] = { value: make(), deps }
      return hooks[index].value
    },
    useCallback(callback, deps) { return context.useMemo(() => callback, deps) },
    useEffect(effect, deps) {
      const index = cursor++
      if (!hooks[index] || !same(hooks[index].deps, deps)) {
        const previous = hooks[index]
        hooks[index] = { deps }
        effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = effect() })
      }
    },
    useI18n: () => ({ locale: 'en' }),
    usePluginI18n: () => translate
  })
  function translate(key, ...args) {
    assert.ok(Object.hasOwn(context.api.MESSAGES.en, key), `Missing translation ${key}`)
    const value = context.api.MESSAGES.en[key]
    return typeof value === 'function' ? value(...args) : value
  }
  vm.runInContext(instrumented, context)
  vm.runInContext(`rowsCache = { at: 1, plugins: ${JSON.stringify(initial)} }`, context)
  function render() {
    dirty = false; cursor = 0; effects = []
    tree = context.api.ManagerPage()
    effects.forEach(effect => effect())
  }
  return {
    api: context.api, context, calls, notices,
    get page() { return context.page }, get tree() { return tree },
    respond(handler) { respond = handler },
    render,
    async flush() {
      for (let i = 0; i < 30; i++) {
        if (dirty) render()
        await new Promise(resolve => setImmediate(resolve))
      }
      assert.equal(dirty, false, 'Hooks failed to settle (possible effect loop)')
    }
  }
}

const row = (name = 'alpha', extra = {}) => ({ name, key: name, source: 'git', status: 'enabled',
  install_dir: `C:\\Plugins with spaces\\${name}`, has_desktop_half: false, ...extra })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const nodes = tree => !tree || typeof tree !== 'object' ? []
  : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
let passed = 0
async function test(name, body) { await body(); passed++; console.log(`PASS ${name}`) }

async function main() {
  const h = harness()
  const messages = h.api.MESSAGES
  const keys = Object.keys(messages.en).sort()
  for (const locale of ['en', 'zh', 'zh-hant']) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys)
    for (const key of usedKeys) assert.ok(Object.hasOwn(messages[locale], key), `${locale}: missing ${key}`)
    for (const key of keys) assert.ok(usedKeys.has(key), `${locale}: unused ${key}`)
    console.log(`i18n ${locale}: ${keys.length} keys`)
  }
  console.log('i18n sets identical; missing=0; unused=0')
  const manifest = fs.readFileSync(path.join(root, 'plugin.yaml'), 'utf8')
  assert.match(manifest, /^name: cn-plugins-market\r?$/m)
  assert.match(manifest, /^version: "2\.5\.0"\r?$/m)
  assert.match(source, /const ID = 'cn-plugins-market'/)
  console.log('metadata: id/name=cn-plugins-market; version=2.5.0')
  for (const [name, pattern] of [
    ['shell.exec', 'shell[.]exec'],
    ['JSX / transform residue', '<[A-Za-z][^>]*>|</[A-Za-z]|React[.]createElement|_jsx|jsxDEV|__jsx|@jsx'],
    ['profile parameter', '\\bprofile\\s*:']
  ]) {
    const result = spawnSync('rg', ['-n', pattern, 'desktop/plugin.js'], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 1, `${name}: ${result.stdout}${result.stderr}`)
    console.log(`rg ${name}: no matches (exit 1)`)
  }
  await test('canonical identity, deduplication and malformed cache rows', () => {
    const a = row('same', { key: 'tools/same' }), b = row('same', { key: 'providers/same' })
    const clean = h.api.normalizeRows([a, { ...a, source: 'catalog:x' }, b, null, {}, { name: 'old' }])
    assert.equal(clean.length, 2)
    assert.notEqual(h.api.rowKeyOf(a), h.api.rowKeyOf(b))
    assert.equal(h.api.canManageAgent(a, clean), false)
    assert.equal(h.api.canManageAgent(row('core', { source: 'bundled' }), [row('core')]), false)
    assert.equal(h.api.normalizeRows([row('bad-cache', { version: {}, pinned_sha: [], catalog_version: {} })])[0].version, '')
    vm.runInContext("pluginCtx = {storage:{ get: () => ({v:2,plugins:[null,{name:'old'}]}), set(){} }}; hydrate()", h.context)
  })
  await test('inspected SHA binds both install paths and rejects stale input/ref', () => {
    const sha = 'a'.repeat(40), inspection = { status: 'done', identifier: 'repo', ref: '', data: { sha, agent: true, desktop: true } }
    assert.equal(h.api.inspectedParams(inspection, 'repo', '', 'desktop').ref, sha)
    assert.equal(h.api.inspectedParams(inspection, 'repo', '', 'agent').inspected_sha, sha)
    assert.equal(h.api.inspectedParams(inspection, 'changed', '', 'agent'), null)
    assert.equal(h.api.inspectedParams(inspection, 'repo', 'b'.repeat(40), 'desktop'), null)
  })
  await test('path handling and incomplete comparisons', () => {
    assert.equal(h.api.joinPath('C:\\a b\\中文', 'x&y', 'plugin.js'), 'C:\\a b\\中文\\x&y\\plugin.js')
    assert.equal(h.api.isSafeName('../bad'), false)
    assert.equal(h.api.isSafeName('中文 & name'), true)
    assert.equal(h.api.compareCopy({ ok: true, text: 'x', truncated: true }, { ok: true, text: 'x' }).kind, 'error')
  })
  await test('dev grouping: heuristic defaults plus persistent manual overrides', () => {
    // Own-work defaults: unpinned git checkout, hand-placed desktop half, local
    // install with a desktop page. A catalog-pinned git install is not.
    const guess = h.api.detectDev([
      row('own-checkout'),
      row('pinned', { pinned_sha: 'a'.repeat(40) }),
      row('hand-made', { source: 'desktop' }),
      row('local-with-page', { source: 'user', has_desktop_half: true }),
      row('local-agent-only', { source: 'user' }),
      row('builtin', { source: 'bundled' })
    ])
    assert.equal(guess.has('own-checkout'), true)
    assert.equal(guess.has('pinned'), false)
    assert.equal(guess.has('hand-made'), true)
    assert.equal(guess.has('local-with-page'), true)
    assert.equal(guess.has('local-agent-only'), false)
    assert.equal(guess.has('builtin'), false)
    // An explicit mark wins in both directions.
    vm.runInContext("devOverrides = {on:['pinned'],off:['own-checkout']}", h.context)
    const marked = h.api.detectDev([row('own-checkout'), row('pinned', { pinned_sha: 'a'.repeat(40) })])
    assert.equal(marked.has('pinned'), true)
    assert.equal(marked.has('own-checkout'), false)
    vm.runInContext("devOverrides = {on:[],off:[]}", h.context)
  })
  await test('missing bridge, cached rendering, stable effects and shared list requests', async () => {
    const app = harness([row()]); await app.flush()
    assert.equal(app.calls.filter(p => p.action === 'list').length, 1)
    const wait = deferred(); app.respond(() => wait.promise)
    const one = app.page.refresh(), two = app.page.refresh()
    await Promise.resolve(); wait.resolve({ plugins: [row()] }); await Promise.all([one, two]); await app.flush()
    assert.equal(app.calls.filter(p => p.action === 'list').length, 2)
    app.respond(() => { throw new Error('timeout') })
    await app.page.refresh(); await app.flush()
    assert.equal(app.page.rows.length, 1); assert.equal(app.page.status, 'ready'); assert.match(app.page.loadError, /timeout/)
  })
  await test('cold list failure, malformed response and empty desktop root', async () => {
    const app = harness([], { desktopPluginsRoot: () => '', readDir: () => { throw new Error('must not read') } })
    app.respond(() => ({ plugins: [null] })); await app.flush()
    assert.equal(app.page.status, 'error')
    app.respond(() => ({ plugins: [] })); await app.page.refresh(); await app.flush()
    assert.equal(app.page.status, 'ready'); assert.equal(app.page.allRows.length, 0)
  })
  await test('shared list request also deduplicates independent consumers', async () => {
    const app = harness(); const wait = deferred(); app.respond(() => wait.promise)
    const one = app.api.requestList(), two = app.api.requestList()
    await Promise.resolve(); assert.equal(app.calls.length, 1)
    wait.resolve({ plugins: [] }); await Promise.all([one, two])
  })
  await test('bridge timeout is bounded and file-read rejection degrades safely', async () => {
    const app = harness([], { readFileText: () => new Promise(() => {}) })
    app.context.setTimeout = callback => setImmediate(callback)
    app.context.clearTimeout = clearImmediate
    assert.equal((await app.api.readMaybeText('C:\\plugins\\x.js')).ok, false)
  })
  await test('selection follows canonical key for colliding names', async () => {
    const a = row('same', { key: 'tools/same' }), b = row('same', { key: 'providers/same' })
    const app = harness([a, b]); await app.flush()
    app.page.setSelectedKey(app.api.rowKeyOf(b)); await app.flush()
    assert.equal(app.page.selectedKey, app.api.rowKeyOf(b))
    const buttons = nodes(app.tree).filter(node => node.type === 'button' && node.props.title?.startsWith('same'))
    assert.equal(buttons.length, 2); assert.notEqual(buttons[0].key, buttons[1].key)
    assert.equal(nodes(app.tree).filter(node => node.type === 'Button' && node.props.children === 'Uninstall').length, 0)
  })
  for (const order of ['consent-scan', 'scan-consent']) await test(`update ${order} retains both explicit approvals`, async () => {
    const app = harness([row('alpha', { update_available: true })]); await app.flush()
    const refusals = order === 'consent-scan'
      ? [{ ok: false, consent_required: true }, { ok: false, scan_blocked: true, scan_verdict: 'caution' }]
      : [{ ok: false, scan_blocked: true, scan_verdict: 'caution' }, { ok: false, consent_required: true }]
    let index = 0
    app.respond(params => params.action === 'list' ? { plugins: [row()] } : refusals[index++] || { ok: true })
    await app.page.runUpdate(row()); await app.flush()
    for (let i = 0; i < 2; i++) {
      const dialog = nodes(app.tree).find(node => node.type === 'ConfirmDialog' && node.props.open && node.props.confirmLabel === 'Update anyway')
      if (dialog) await dialog.props.onConfirm()
      else {
        const button = nodes(app.tree).find(node => node.type === 'Button' && node.props.children === 'Update anyway')
        assert.ok(button); await button.props.onClick()
      }
      await app.flush()
    }
    const updates = app.calls.filter(p => p.action === 'update')
    assert.equal(updates.length, 3)
    assert.equal(updates[2].accept_capabilities, true); assert.equal(updates[2].force, true)
  })
  await test('dangerous scan cannot force and repeated refusal remains visible', async () => {
    const app = harness([row()]); await app.flush()
    app.respond(() => ({ ok: false, scan_blocked: true, scan_verdict: 'dangerous' }))
    await app.page.runUpdate(row(), { force: true }); await app.flush()
    assert.equal(app.page.scan.verdict, 'dangerous')
    assert.equal(nodes(app.tree).some(node => node.type === 'Button' && node.props.children === 'Update anyway'), false)
  })
  await test('mutation lock rejects overlapping toggle/update; post-mutation refresh is fresh', async () => {
    const app = harness([row()]); await app.flush()
    const wait = deferred(); app.respond(params => params.action === 'list' ? { plugins: [row()] } : wait.promise)
    const toggle = app.page.toggleRow(row(), false)
    await app.page.runUpdate(row()); wait.resolve({ ok: true }); await toggle; await app.flush()
    assert.equal(app.calls.filter(p => p.action === 'toggle').length, 1)
    assert.equal(app.calls.filter(p => p.action === 'update').length, 0)
    assert.equal(app.calls.filter(p => p.action === 'list').length, 2)
  })
  await test('mutation completion queues a fresh snapshot behind an older list', async () => {
    const app = harness([row()]); await app.flush()
    const old = deferred(); let listCount = 0
    app.respond(params => params.action !== 'list' ? { ok: true }
      : ++listCount === 1 ? old.promise : { plugins: [row('new')] })
    const refresh = app.page.refresh(); await Promise.resolve()
    const toggle = app.page.toggleRow(row(), false)
    old.resolve({ plugins: [row('stale')] })
    await Promise.all([refresh, toggle]); await app.flush()
    assert.equal(app.page.rows[0].name, 'new'); assert.equal(listCount, 2)
  })
  await test('old inspect response cannot install a different repository', async () => {
    const app = harness(); await app.flush()
    const open = nodes(app.tree).find(n => n.type === 'Button' && n.props.children === 'Install from Git')
    open.props.onClick(); await app.flush()
    let input = nodes(app.tree).find(n => n.type === 'input' && n.props['aria-label'] === 'Repository URL')
    input.props.onChange({ target: { value: 'repo-a' } }); await app.flush()
    const wait = deferred(); app.respond(() => wait.promise)
    const pending = app.page.runInspect()
    input = nodes(app.tree).find(n => n.type === 'input' && n.props['aria-label'] === 'Repository URL')
    input.props.onChange({ target: { value: 'repo-b' } }); await app.flush()
    wait.resolve({ ok: true, agent: true, desktop: true, sha: 'a'.repeat(40) }); await pending; await app.flush()
    assert.equal(app.page.inspect.status, 'idle')
    await app.page.installHalf('agent')
    assert.equal(app.calls.some(p => p.action === 'install'), false)
  })
  await test('desktop install passes reviewed SHA; mismatched ref blocks inspect', async () => {
    const app = harness(); await app.flush(); app.page.setInstallRepo('repo'); await app.flush()
    app.respond(params => params.action === 'list' ? { plugins: [] } : { ok: true, agent: true, desktop: true, sha: 'a'.repeat(40) })
    await app.page.runInspect(); await app.flush(); await app.page.installHalf('desktop'); await app.flush()
    assert.equal(app.calls.find(p => p.action === 'install_desktop').ref, 'a'.repeat(40))
    app.page.setInstallRepo('repo'); app.page.setInstallRef('b'.repeat(40)); await app.flush()
    await app.page.runInspect(); await app.flush(); assert.equal(app.page.inspect.status, 'error')
  })
  await test('package marker controls pairing and desktop removal, standalone stays manageable', async () => {
    const reads = []
    const desktop = {
      desktopPluginsRoot: () => 'C:\\Desktop plugins',
      readDir: () => ({ entries: [{ name: 'paired-folder', isDirectory: true }, { name: 'solo', isDirectory: true }] }),
      readFileText: file => {
        reads.push(file)
        if (file.endsWith('paired-folder\\.hermes-package.json')) return { text: '{"package":"alpha"}' }
        throw new Error('missing')
      }
    }
    const app = harness([row()], desktop); await app.flush()
    const paired = app.page.allRows.find(r => r.key), solo = app.page.allRows.find(r => !r.key)
    assert.equal(paired.desktop_claimed, true); assert.equal(paired.desktop_name, 'paired-folder')
    app.page.setPendingRemove({ row: paired, mode: 'remove_desktop' }); await app.flush(); await app.page.doRemove()
    assert.equal(app.calls.some(p => p.action === 'remove_desktop'), false)
    app.page.setPendingRemove({ row: solo, mode: 'remove_desktop' }); await app.flush(); await app.page.doRemove(); await app.flush()
    assert.equal(app.calls.find(p => p.action === 'remove_desktop').name, 'solo')
    app.page.setPendingRemove({ row: paired, mode: 'remove' }); await app.flush(); await app.page.doRemove()
    assert.equal(app.calls.find(p => p.action === 'remove').name, 'alpha')
    assert.equal(reads.some(file => /[\\/]\.git[\\/]/.test(file)), false)
  })
  await test('remove failure retains confirmation and exposes the backend failure', async () => {
    const app = harness([row()]); await app.flush()
    app.page.setPendingRemove({ row: row(), mode: 'remove' }); await app.flush()
    app.respond(() => ({ ok: false, error: 'remove refused' }))
    await assert.rejects(app.page.doRemove(), /remove refused/)
    assert.ok(app.notices.some(n => n.kind === 'error' && n.message.includes('remove refused')))
    await app.flush()
    assert.ok(nodes(app.tree).find(n => n.type === 'ConfirmDialog' && n.props.open))
  })
  await test('bulk errors are surfaced instead of reporting zero successful updates', async () => {
    const app = harness([row()]); await app.flush(); app.respond(() => ({ ok: false, error: 'backend failed' }))
    await app.page.runUpdateAll(); await app.flush()
    assert.ok(app.notices.some(n => n.kind === 'error' && n.message.includes('backend failed')))
  })
  await test('bulk mixed results preserve review status and refresh', async () => {
    const app = harness([row()]); await app.flush()
    app.respond(params => params.action === 'list' ? { plugins: [row()] } : {
      results: [{ name: 'alpha', status: 'updated' }, { name: 'beta', status: 'needs_review' }], skipped: []
    })
    await app.page.runUpdateAll(); await app.flush()
    assert.ok(app.notices.some(n => n.message.includes('1 updated') && n.message.includes('1 needs review')))
    assert.equal(app.calls.filter(p => p.action === 'list').length, 2)
  })
  console.log(`Regression checks: ${passed} passed, 0 failed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
