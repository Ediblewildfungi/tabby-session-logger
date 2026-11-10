'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')

class Signal {
    constructor () { this.listeners = new Set() }
    subscribe (observer) {
        this.listeners.add(observer)
        return { unsubscribe: () => this.listeners.delete(observer) }
    }
    next (value) {
        for (const observer of [...this.listeners]) typeof observer === 'function' ? observer(value) : observer.next?.(value)
    }
}

function loadPlugin () {
    class Decorator {
        constructor () { this.subscriptions = new Map() }
        subscribeUntilDetached (tab, subscription) { this.subscriptions.set(tab, subscription) }
        detach (tab) { this.subscriptions.get(tab)?.unsubscribe(); this.subscriptions.delete(tab) }
    }
    const core = { ConfigProvider: class {}, ConfigService: class {}, NotificationsService: class {}, PlatformService: class {}, LocaleService: class {} }
    const angular = {
        NgZone: class {}, ChangeDetectorRef: class {}, Inject: () => () => {}, Injectable: () => () => {},
        Component: options => type => { type.component = options },
        NgModule: options => type => { type.module = options },
    }
    const modules = {
        '@angular/core': angular, '@angular/common': { CommonModule: class {} }, '@angular/forms': { FormsModule: class {} },
        'tabby-core': core, 'tabby-terminal': { TerminalDecorator: Decorator },
        'tabby-settings': { SettingsTabProvider: class {} }, './logging': require('../src/logging'),
        './i18n': require('../src/i18n'),
    }
    const exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8'), {
        exports, require: name => modules[name] || require(name),
    }, { filename: 'src/index.js' })
    return { metadata: exports.default.module, core }
}

function session () { return { binaryOutput$: new Signal(), closed$: new Signal(), destroyed$: new Signal() } }

test('Tabby lifecycle: attach, reconnect, toggle, unrelated settings, detach', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tabby-logger-lifecycle-'))
    t.after(() => fs.promises.rm(directory, { force: true, recursive: true }))
    const { metadata } = loadPlugin()
    const config = { store: { sessionLogger: { directory, filename: '%S.txt', enabled: true } }, changed$: new Signal() }
    const errors = []
    const logger = new metadata.providers[0](config, { error: (...args) => errors.push(args) }, { run: fn => fn() })
    const tab = { profile: { name: '会话', options: { host: 'server' } }, session: session(), sessionChanged$: new Signal() }
    logger.attach(tab)
    logger.attach(tab)
    const first = logger.tabs.get(tab).log
    tab.session.binaryOutput$.next(Buffer.from('first\n'))
    config.changed$.next()
    assert.equal(logger.tabs.get(tab).log, first, 'unrelated settings must not rotate logs')
    const oldSession = tab.session
    tab.session = session()
    tab.sessionChanged$.next(tab.session)
    const second = logger.tabs.get(tab).log
    oldSession.binaryOutput$.next(Buffer.from('ignored'))
    tab.session.binaryOutput$.next(Buffer.from('second\n'))
    config.store.sessionLogger.enabled = false
    config.changed$.next()
    tab.session.binaryOutput$.next(Buffer.from('disabled'))
    assert.equal(logger.tabs.get(tab).log, null)
    config.store.sessionLogger.enabled = true
    config.changed$.next()
    const third = logger.tabs.get(tab).log
    tab.session.binaryOutput$.next(Buffer.from('third\n'))
    logger.detach(tab)
    tab.sessionChanged$.next(tab.session)
    await Promise.all([first.close(), second.close(), third.close()])
    assert.equal(await fs.promises.readFile(first.filePath, 'utf8'), 'first\n')
    assert.equal(await fs.promises.readFile(second.filePath, 'utf8'), 'second\n')
    assert.equal(await fs.promises.readFile(third.filePath, 'utf8'), 'third\n')
    assert.equal(tab.session.binaryOutput$.listeners.size, 0)
    assert.equal(tab.sessionChanged$.listeners.size, 0)
    assert.equal(logger.tabs.size, 0)
    assert.equal(errors.length, 0)
    logger.ngOnDestroy()
    assert.equal(config.changed$.listeners.size, 0)
})

test('session close flushes final output; settings validation prevents invalid persistence', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tabby-logger-settings-'))
    t.after(() => fs.promises.rm(directory, { force: true, recursive: true }))
    const { metadata } = loadPlugin()
    let saves = 0
    const config = { store: { sessionLogger: { directory, filename: 'test.txt' } }, changed$: new Signal(), save: async () => { saves++; config.changed$.next() } }
    const logger = new metadata.providers[0](config, { error: () => {} }, { run: fn => fn() })
    const tab = { profile: { name: 'test' }, session: session(), sessionChanged$: new Signal() }
    logger.attach(tab)
    const log = logger.tabs.get(tab).log
    tab.session.binaryOutput$.next(Buffer.from('final output'))
    tab.session.closed$.next()
    await log.close()
    assert.equal(await fs.promises.readFile(log.filePath, 'utf8'), 'final output')
    const settings = new metadata.declarations[0](config, {}, logger, { run: fn => fn() }, { markForCheck: () => {} })
    settings.options.filename = '%Q.txt'
    await settings.save()
    assert.equal(saves, 0)
    assert.match(settings.error, /Unknown placeholder/)
    settings.options.filename = 'new.log'
    settings.options.enabled = false
    await settings.save()
    assert.equal(saves, 1)
    assert.equal(config.store.sessionLogger.filename, 'new.log')
    logger.ngOnDestroy()
})

test('package metadata meets installed Tabby discovery requirements', () => {
    const pkg = require('../package.json')
    assert.ok(pkg.name.startsWith('tabby-'))
    assert.ok(pkg.keywords.includes('tabby-plugin'))
    assert.ok(pkg.author)
    assert.equal(pkg.main, 'dist/index.js')
    assert.equal(pkg.dependencies, undefined)
    assert.equal(pkg.devDependencies, undefined)
})

function viewHarness (type, config, platform = {}, locale) {
    let inZone = false
    const frames = []
    const zone = { run: fn => { inZone = true; try { return fn() } finally { inZone = false } } }
    let settings
    const detector = { markForCheck: () => {
        assert.equal(inZone, true, 'UI refresh must run inside Angular zone')
        frames.push({ saving: settings.saving, message: settings.message, error: settings.error, directory: settings.options.directory })
    } }
    settings = new type(config, platform, {}, zone, detector, locale)
    return { settings, frames }
}

test('native asynchronous save refreshes success state and prevents duplicate submissions', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tabby-logger-refresh-'))
    t.after(() => fs.promises.rm(directory, { force: true, recursive: true }))
    const { metadata } = loadPlugin()
    let complete
    let started
    const startedPromise = new Promise(resolve => { started = resolve })
    let saves = 0
    const config = {
        store: { sessionLogger: { directory, __getValue: () => {}, __setValue: () => {} } },
        save: () => { saves++; started(); return new Promise(resolve => { complete = resolve }) },
    }
    const { settings, frames } = viewHarness(metadata.declarations[0], config)
    assert.equal(settings.options.__getValue, undefined, 'do not copy proxy methods into editable options')
    const pending = settings.save()
    await startedPromise
    await settings.save()
    assert.equal(saves, 1)
    assert.equal(frames.at(-1).saving, true)
    complete()
    await pending
    assert.equal(frames.at(-1).saving, false)
    assert.match(frames.at(-1).message, /Saved/)
    assert.equal(frames.at(-1).error, '')
})

test('rejected save refreshes error state, clears spinner, and restores prior options', async () => {
    const { metadata } = loadPlugin()
    const config = {
        store: { sessionLogger: { enabled: false, directory: os.tmpdir(), filename: 'before.txt' } },
        save: async () => { await Promise.resolve(); throw new Error('simulated save failure') },
    }
    const { settings, frames } = viewHarness(metadata.declarations[0], config)
    settings.options.filename = 'after.txt'
    await settings.save()
    assert.equal(frames.at(-1).saving, false)
    assert.match(frames.at(-1).error, /save failure/)
    assert.equal(config.store.sessionLogger.filename, 'before.txt')
})

test('directory picker refreshes view and late save completion respects destroyed view', async () => {
    const { metadata } = loadPlugin()
    let finish
    const config = { store: { sessionLogger: { enabled: false, directory: os.tmpdir() } }, save: () => new Promise(resolve => { finish = resolve }) }
    const { settings, frames } = viewHarness(metadata.declarations[0], config, { pickDirectory: async () => os.tmpdir() })
    await settings.browse()
    assert.equal(frames.at(-1).directory, os.tmpdir())
    const pending = settings.save()
    settings.ngOnDestroy()
    const frameCount = frames.length
    finish()
    await pending
    assert.equal(frames.length, frameCount, 'never mark a destroyed view')
    assert.equal(settings.saving, false)
})

function localeService (initial = 'en-US') {
    return {
        current: initial, localeChanged$: new Signal(),
        getLocale () { return this.current },
        setLocale (value) { this.current = value; this.localeChanged$.next(value) },
    }
}

test('settings follow live Tabby locale and translate existing errors; explicit language persists', async () => {
    const { metadata } = loadPlugin()
    const locale = localeService('en-GB')
    const config = { store: { sessionLogger: { directory: os.tmpdir(), enabled: false } }, save: async () => {} }
    const { settings, frames } = viewHarness(metadata.declarations[0], config, {}, locale)
    assert.equal(settings.options.language, 'auto')
    assert.equal(settings.t('title'), 'Session logs')
    settings.options.filename = '%Q.txt'
    await settings.save()
    assert.match(settings.error, /Unknown placeholder/)
    locale.setLocale('zh-CN')
    assert.equal(settings.t('title'), '会话日志')
    assert.match(frames.at(-1).error, /未知占位符/)
    assert.match(settings.preview, /未知占位符/)
    settings.options.language = 'en'
    assert.match(settings.error, /Unknown placeholder/)
    settings.options.filename = 'fixed.txt'
    await settings.save()
    assert.equal(config.store.sessionLogger.language, 'en')
    locale.setLocale('zh-TW')
    assert.equal(settings.t('title'), 'Session logs')
    assert.match(settings.message, /Saved/)
    const restored = viewHarness(metadata.declarations[0], config, {}, locale).settings
    assert.equal(restored.language, 'en')
    restored.ngOnDestroy()
    settings.options.language = 'auto'
    await settings.save()
    assert.equal(config.store.sessionLogger.language, 'auto')
    assert.match(settings.message, /已保存/)
    locale.setLocale('fr-FR')
    assert.equal(settings.t('title'), 'Session logs')
    assert.match(settings.message, /Saved/)
    settings.ngOnDestroy()
    assert.equal(locale.localeChanged$.listeners.size, 0)
})

test('language-only saves leave the same session log open and do not translate terminal contents', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tabby-logger-language-'))
    t.after(() => fs.promises.rm(directory, { force: true, recursive: true }))
    const { metadata } = loadPlugin()
    const config = { store: { sessionLogger: { directory, filename: '%S.txt' } }, changed$: new Signal() }
    const locale = localeService('en-US')
    const logger = new metadata.providers[0](config, { error: () => {} }, { run: fn => fn() }, locale)
    const tab = { profile: { name: '原始名称' }, session: session(), sessionChanged$: new Signal() }
    logger.attach(tab)
    const log = logger.tabs.get(tab).log
    tab.session.binaryOutput$.next(Buffer.from('Before 中文\n'))
    config.store.sessionLogger.language = 'zh'
    config.changed$.next()
    assert.equal(logger.tabs.get(tab).log, log)
    locale.setLocale('de-DE')
    config.changed$.next()
    assert.equal(logger.tabs.get(tab).log, log)
    tab.session.binaryOutput$.next(Buffer.from('After English\n'))
    logger.detach(tab)
    await log.close()
    assert.equal(path.basename(log.filePath), '原始名称.txt')
    assert.equal(await fs.promises.readFile(log.filePath, 'utf8'), 'Before 中文\nAfter English\n')
    assert.equal((await fs.promises.readdir(directory)).length, 1)
    logger.ngOnDestroy()
})

test('sidebar title and notifications use persisted plugin language and host fallback', () => {
    const { metadata } = loadPlugin()
    const locale = localeService('zh-CN')
    const config = { store: { sessionLogger: {} }, changed$: new Signal() }
    const Provider = metadata.providers.at(-1).useClass
    const provider = new Provider(config, locale)
    assert.equal(provider.title, '会话日志')
    const notifications = []
    const logger = new metadata.providers[0](config, { error: (...args) => notifications.push(args) }, { run: fn => fn() }, locale)
    const { logError } = require('../src/i18n')
    logger.reportError(logError('queueFull'), 'sample.txt')
    assert.equal(notifications.at(-1)[0], '会话日志记录已停止')
    config.store.sessionLogger.language = 'en'
    assert.equal(provider.title, 'Session logs')
    logger.reportError(logError('unknownToken', { token: 'Q' }))
    assert.equal(notifications.at(-1)[0], 'Session logging stopped')
    assert.match(notifications.at(-1)[1], /Unknown placeholder: %Q/)
    config.store.sessionLogger.language = 'auto'
    locale.setLocale('ja-JP')
    assert.equal(provider.title, 'Session logs')
    logger.ngOnDestroy()
})
