'use strict'

// All non-Node imports are provided by the Tabby host. No bundled Angular/RxJS.
const angular = require('@angular/core')
const { CommonModule } = require('@angular/common')
const { FormsModule } = require('@angular/forms')
const core = require('tabby-core')
const terminal = require('tabby-terminal')
const { SettingsTabProvider } = require('tabby-settings')
const fs = require('fs')
const path = require('path')
const { DEFAULTS, formatFilename, resolveDirectory, contextFor, SessionLog } = require('./logging')
const { resolveLanguage, translate, errorText } = require('./i18n')

function injectParameters (type, tokens) {
    tokens.forEach((token, index) => angular.Inject(token)(type, undefined, index))
}

function readOptions (store) {
    // Tabby's ConfigProxy also has enumerable internal methods; do not copy them.
    return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, store?.[key] ?? DEFAULTS[key]]))
}

class LoggerConfigProvider extends core.ConfigProvider {
    constructor () { super(); this.defaults = { sessionLogger: { ...DEFAULTS } } }
}
angular.Injectable()(LoggerConfigProvider)

class SessionLoggerDecorator extends terminal.TerminalDecorator {
    constructor (config, notifications, zone, locale) {
        super()
        this.config = config
        this.notifications = notifications
        this.zone = zone
        this.locale = locale
        this.tabs = new Map()
        this.lastFailure = null
        this.signature = this.optionsSignature()
        this.configSubscription = config.changed$.subscribe(() => {
            const signature = this.optionsSignature()
            if (signature === this.signature) return
            this.signature = signature
            for (const [tab, entry] of this.tabs) {
                this.stop(entry)
                this.start(tab, entry)
            }
        })
    }

    options () { return readOptions(this.config.store.sessionLogger) }
    optionsSignature () {
        const { language, ...loggingOptions } = this.options()
        return JSON.stringify(loggingOptions)
    }

    get language () { return resolveLanguage(this.options().language, this.locale?.getLocale()) }

    get lastError () {
        if (!this.lastFailure) return ''
        const { error, file } = this.lastFailure
        return `${errorText(error, this.language)}${file ? ' · ' + file : ''}`
    }

    reportError (error, file) {
        this.lastFailure = { error, file }
        this.zone.run(() => this.notifications.error(translate(this.language, 'stopped'), this.lastError))
    }

    attach (tab) {
        if (this.tabs.has(tab)) return
        const entry = { log: null, subscriptions: [] }
        this.tabs.set(tab, entry)
        this.subscribeUntilDetached(tab, tab.sessionChanged$.subscribe(() => {
            this.stop(entry)
            this.start(tab, entry)
        }))
        this.start(tab, entry)
    }

    start (tab, entry) {
        const session = tab.session
        const options = this.options()
        if (!options.enabled || !session || entry.endedSession === session) return
        try {
            const log = new SessionLog(options, contextFor(tab), (error, file) => this.reportError(error, file))
            entry.log = log
            entry.name = contextFor(tab).session
            // binaryOutput$ includes initial buffered output once the frontend is ready.
            // It avoids decoding split UTF-8 characters independently per chunk.
            entry.subscriptions.push(session.binaryOutput$.subscribe({
                next: data => log.write(data),
                complete: () => { void log.close() },
            }))
            const finish = () => { entry.endedSession = session; this.stop(entry) }
            entry.subscriptions.push(session.closed$.subscribe(finish))
            entry.subscriptions.push(session.destroyed$.subscribe(finish))
        } catch (error) {
            this.reportError(error)
        }
    }

    stop (entry) {
        for (const subscription of entry.subscriptions) subscription.unsubscribe()
        entry.subscriptions = []
        const log = entry.log
        entry.log = null
        if (log) void log.close()
    }

    detach (tab) {
        const entry = this.tabs.get(tab)
        if (entry) this.stop(entry)
        this.tabs.delete(tab)
        super.detach(tab)
    }

    ngOnDestroy () {
        this.configSubscription.unsubscribe()
        for (const tab of this.tabs.keys()) this.detach(tab)
    }

    get activeLogs () {
        return [...this.tabs.values()].filter(entry => entry.log && !entry.log.closed && !entry.log.failed)
            .map(entry => ({ name: entry.name, path: entry.log.filePath || '' }))
    }
}
injectParameters(SessionLoggerDecorator, [core.ConfigService, core.NotificationsService, angular.NgZone, core.LocaleService])
angular.Injectable()(SessionLoggerDecorator)

class LoggerSettingsComponent {
    constructor (config, platform, logger, zone, changeDetector, locale) {
        this.config = config
        this.platform = platform
        this.logger = logger
        this.zone = zone
        this.changeDetector = changeDetector
        this.locale = locale
        this.destroyed = false
        this.options = readOptions(config.store.sessionLogger)
        this.failure = null
        this.messageKey = ''
        this.saving = false
        this.previewDate = new Date()
        this.tokens = [
            ['%H', 'host', 'server01'], ['%S', 'session', ''],
            ['%Y', 'year', '2026'], ['%y', 'shortYear', '26'],
            ['%M', 'month', '11'], ['%D', 'day', '10'],
            ['%h', 'hour', '22'], ['%m', 'minute', '08'],
            ['%s', 'second', '05'], ['%%', 'percent', '%'],
        ]
        this.localeSubscription = locale?.localeChanged$.subscribe(() => this.updateView(() => {}))
    }

    get language () { return resolveLanguage(this.options.language, this.locale?.getLocale()) }
    t (key) { return translate(this.language, key) }
    get error () { return this.failure ? errorText(this.failure, this.language) : '' }
    get message () { return this.messageKey ? this.t(this.messageKey) : '' }
    get lastError () {
        const failure = this.logger.lastFailure
        return failure ? `${errorText(failure.error, this.language)}${failure.file ? ' · ' + failure.file : ''}` : ''
    }

    updateView (update) {
        // Native async/await and Node filesystem promises can resume outside
        // Angular's zone. Re-enter it and mark the settings view for checking.
        this.zone.run(() => {
            update()
            if (!this.destroyed) this.changeDetector.markForCheck()
        })
    }

    ngOnDestroy () { this.destroyed = true; this.localeSubscription?.unsubscribe() }

    get preview () {
        try {
            return path.join(resolveDirectory(this.options.directory), formatFilename(this.options.filename,
                { host: 'server01', session: this.t('sampleSession') }, this.previewDate))
        } catch (error) { return errorText(error, this.language) }
    }

    async browse () {
        try {
            const directory = await this.platform.pickDirectory()
            if (directory) this.updateView(() => { this.options.directory = directory })
        } catch (error) { this.updateView(() => { this.failure = error }) }
    }

    async openDirectory () {
        try {
            const directory = resolveDirectory(this.options.directory)
            await fs.promises.mkdir(directory, { recursive: true })
            this.platform.openPath(directory)
        } catch (error) { this.updateView(() => { this.failure = error }) }
    }

    async save () {
        if (this.saving) return
        this.updateView(() => {
            this.failure = null
            this.messageKey = ''
            this.saving = true
        })
        let previous
        let assigned = false
        try {
            previous = readOptions(this.config.store.sessionLogger)
            const options = readOptions(this.options)
            const directory = resolveDirectory(options.directory)
            formatFilename(options.filename, { host: 'server01', session: this.t('sampleSession') })
            if (options.enabled) {
                await fs.promises.mkdir(directory, { recursive: true })
                await fs.promises.access(directory, fs.constants.W_OK)
            }
            // ConfigProxy properties must be assigned individually, preserving defaults.
            assigned = true
            Object.assign(this.config.store.sessionLogger, options, { directory })
            await this.config.save()
            this.updateView(() => {
                this.options.directory = directory
                this.messageKey = 'saved'
            })
        } catch (error) {
            if (assigned) Object.assign(this.config.store.sessionLogger, previous)
            this.updateView(() => { this.failure = error })
        } finally { this.updateView(() => { this.saving = false }) }
    }
}
injectParameters(LoggerSettingsComponent, [core.ConfigService, core.PlatformService, SessionLoggerDecorator, angular.NgZone, angular.ChangeDetectorRef, core.LocaleService])
angular.Component({
    selector: 'session-logger-settings',
    template: `
      <h3>{{ t('title') }}</h3>
      <p class="text-muted">{{ t('description') }}</p>
      <label for="sl-language">{{ t('language') }}</label>
      <select id="sl-language" class="form-control" [(ngModel)]="options.language">
        <option value="auto">{{ t('auto') }}</option>
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
      <p class="text-muted hint">{{ t('languageHint') }}</p>
      <label class="toggle"><input type="checkbox" [(ngModel)]="options.enabled"> {{ t('enabled') }}</label>
      <label for="sl-directory">{{ t('directory') }}</label>
      <div class="input-row">
        <input id="sl-directory" class="form-control" [(ngModel)]="options.directory" [placeholder]="t('directoryPlaceholder')">
        <button type="button" class="btn btn-secondary" (click)="browse()">{{ t('browse') }}</button>
        <button type="button" class="btn btn-secondary" (click)="openDirectory()">{{ t('open') }}</button>
      </div>
      <label for="sl-filename">{{ t('filename') }}</label>
      <input id="sl-filename" class="form-control" [(ngModel)]="options.filename" spellcheck="false">
      <p class="text-muted hint">{{ t('filenameHint') }}</p>
      <div class="preview"><span class="text-muted">{{ t('preview') }}</span><code>{{ preview }}</code></div>
      <label class="toggle"><input type="checkbox" [(ngModel)]="options.stripAnsi"> {{ t('stripAnsi') }}</label>
      <label class="toggle"><input type="checkbox" [(ngModel)]="options.append"> {{ t('append') }}</label>
      <p class="text-muted hint">{{ t('appendHint') }}</p>
      <button type="button" class="btn btn-primary" [disabled]="saving" (click)="save()">{{ saving ? t('saving') : t('save') }}</button>
      <p *ngIf="message" class="text-success" role="status">{{ message }}</p>
      <p *ngIf="error" class="text-danger" role="alert">{{ error }}</p>
      <h4>{{ t('placeholders') }}</h4>
      <table class="table table-sm"><thead><tr><th>{{ t('token') }}</th><th>{{ t('meaning') }}</th><th>{{ t('example') }}</th></tr></thead>
        <tbody><tr *ngFor="let token of tokens"><td><code>{{ token[0] }}</code></td><td>{{ t(token[1]) }}</td><td>{{ token[2] || t('sampleSession') }}</td></tr></tbody>
      </table>
      <p class="text-muted">{{ t('tokenHint') }}</p>
      <h4>{{ t('active') }}</h4>
      <p *ngIf="logger.activeLogs.length === 0" class="text-muted">{{ t('empty') }}</p>
      <div *ngFor="let item of logger.activeLogs" class="active-log"><strong>{{ item.name }}</strong><code>{{ item.path || t('creating') }}</code></div>
      <p *ngIf="lastError" class="text-danger">{{ t('lastError') }}: {{ lastError }}</p>
      <p class="text-muted hint">{{ t('behavior') }}</p>
    `,
    styles: [`
      :host { display: block; max-width: 900px; }
      label { display: block; margin: 18px 0 8px; }
      .toggle { display: flex; align-items: center; gap: 8px; }
      .input-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .input-row input { flex: 1; min-width: 220px; }
      .hint { margin-top: 8px; font-size: 13px; }
      .preview { padding: 14px; margin: 18px 0; background: #8881; border: 1px solid #8884; border-radius: 4px; }
      code { overflow-wrap: anywhere; white-space: pre-wrap; }
      .preview code, .active-log code { display: block; margin-top: 6px; }
      h4 { margin-top: 28px; }
      .active-log { padding: 10px 0; border-bottom: 1px solid #8883; }
      [role=status], [role=alert] { margin-top: 12px; }
    `],
})(LoggerSettingsComponent)

class LoggerSettingsProvider extends SettingsTabProvider {
    constructor (config, locale) {
        super()
        this.config = config
        this.locale = locale
        this.id = 'session-logger'
        this.icon = 'fas fa-file-alt'
    }
    get title () { return translate(resolveLanguage(this.config.store.sessionLogger.language, this.locale.getLocale()), 'title') }
    getComponentType () { return LoggerSettingsComponent }
}
injectParameters(LoggerSettingsProvider, [core.ConfigService, core.LocaleService])
angular.Injectable()(LoggerSettingsProvider)

class SessionLoggerModule {}
angular.NgModule({
    imports: [CommonModule, FormsModule],
    declarations: [LoggerSettingsComponent],
    providers: [
        SessionLoggerDecorator,
        { provide: core.ConfigProvider, useClass: LoggerConfigProvider, multi: true },
        { provide: terminal.TerminalDecorator, useExisting: SessionLoggerDecorator, multi: true },
        { provide: SettingsTabProvider, useClass: LoggerSettingsProvider, multi: true },
    ],
})(SessionLoggerModule)

Object.defineProperty(exports, '__esModule', { value: true })
exports.default = SessionLoggerModule
