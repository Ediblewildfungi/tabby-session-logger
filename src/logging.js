'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { StringDecoder } = require('string_decoder')
const { logError } = require('./i18n')

const DEFAULTS = Object.freeze({
    language: 'auto',
    enabled: true,
    directory: path.join(os.homedir(), 'TabbyLogs'),
    filename: '%Y-%M-%DT%h-%m-%s[%H][%S].txt',
    stripAnsi: true,
    append: false,
})

function safePart (value) {
    const cleaned = String(value || 'session').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '') || 'session'
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? '_' + cleaned : cleaned
}

function formatFilename (template, context, date = new Date()) {
    if (typeof template !== 'string' || !template.trim()) throw logError('filenameRequired')
    const pad = n => String(n).padStart(2, '0')
    const tokens = {
        H: safePart(context.host), S: safePart(context.session),
        Y: String(date.getFullYear()), y: pad(date.getFullYear() % 100),
        M: pad(date.getMonth() + 1), D: pad(date.getDate()),
        h: pad(date.getHours()), m: pad(date.getMinutes()), s: pad(date.getSeconds()), '%': '%',
    }
    const filename = template.replace(/%([\s\S]|$)/g, (_, token) => {
        if (!Object.prototype.hasOwnProperty.call(tokens, token)) throw logError('unknownToken', { token })
        return tokens[token]
    })
    if (/[<>:"/\\|?*\x00-\x1f\x7f]/.test(filename)) throw logError('invalidFilename')
    if (filename === '.' || filename === '..' || /[. ]$/.test(filename)) throw logError('filenameEnding')
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) throw logError('reservedFilename')
    if (Buffer.byteLength(filename, 'utf8') > 220) throw logError('filenameLong')
    return filename
}

function resolveDirectory (directory) {
    if (typeof directory !== 'string' || !directory.trim()) throw logError('directoryRequired')
    let result = directory.trim()
    if (result === '~') result = os.homedir()
    else if (/^~[/\\]/.test(result)) result = path.join(os.homedir(), result.slice(2))
    if (!path.isAbsolute(result)) throw logError('directoryAbsolute')
    if (result.includes('\0')) throw logError('directoryInvalid')
    return path.resolve(result)
}

function contextFor (tab) {
    const profile = tab.profile || {}
    return {
        host: profile.options?.host || os.hostname(),
        session: profile.name || tab.title || 'session',
    }
}

// Incremental ECMA-48 filter: escape sequences may cross arbitrary output chunks.
// This is a text transcript, not a terminal-screen emulator.
class AnsiFilter {
    constructor () { this.state = 'text' }
    write (text) {
        const output = []
        for (const c of text) {
            const n = c.charCodeAt(0)
            if (this.state !== 'text' && (n === 0x18 || n === 0x1a)) { this.state = 'text'; continue }
            if (this.state === 'text') {
                if (n === 0x1b) this.state = 'escape'
                else if (n === 0x9b) this.state = 'csi'
                else if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(n)) this.state = n === 0x9d ? 'osc' : 'string'
                else if (n === 9 || n === 10 || n === 13 || (n >= 32 && !(n >= 0x7f && n <= 0x9f))) output.push(c)
            } else if (this.state === 'escape') {
                if (c === '[') this.state = 'csi'
                else if (c === ']') this.state = 'osc'
                else if ('PX^_'.includes(c)) this.state = 'string'
                else if (n >= 0x20 && n <= 0x2f) this.state = 'intermediate'
                else if (n !== 0x1b) this.state = 'text'
            } else if (this.state === 'csi' || this.state === 'intermediate') {
                if (n === 0x1b) this.state = 'escape'
                else if (n >= (this.state === 'csi' ? 0x40 : 0x30) && n <= 0x7e) this.state = 'text'
            } else if (this.state === 'osc' || this.state === 'string') {
                if (n === 0x9c || (n === 7 && this.state === 'osc')) this.state = 'text'
                else if (n === 0x1b) { this.stringState = this.state; this.state = 'stringEscape' }
            } else if (this.state === 'stringEscape') {
                if (c === '\\' || n === 0x9c || (n === 7 && this.stringState === 'osc')) this.state = 'text'
                else if (n !== 0x1b) this.state = this.stringState
            }
        }
        return output.join('')
    }
}

// Asynchronous, ordered writes. A bounded queue prevents a slow/full disk from
// accumulating unlimited terminal output in memory. Errors stop this log only.
class SessionLog {
    constructor (options, context, onError = () => {}, date = new Date()) {
        this.options = { ...DEFAULTS, ...options }
        this.directory = resolveDirectory(this.options.directory)
        this.filename = formatFilename(this.options.filename, context, date)
        this.onError = onError
        this.filter = new AnsiFilter()
        this.decoder = new StringDecoder('utf8')
        this.pendingBytes = 0
        this.maxPendingBytes = 8 * 1024 * 1024
        this.failed = false
        this.closed = false
        this.chain = this.open().catch(error => this.fail(error))
    }

    async open () {
        await fs.promises.mkdir(this.directory, { recursive: true })
        const ext = path.extname(this.filename)
        const stem = this.filename.slice(0, this.filename.length - ext.length)
        for (let suffix = 0; suffix < 10000; suffix++) {
            this.filePath = path.join(this.directory, suffix ? `${stem}_${suffix}${ext}` : this.filename)
            try {
                this.handle = await fs.promises.open(this.filePath, this.options.append ? 'a' : 'wx', 0o600)
                return
            } catch (error) {
                if (error.code !== 'EEXIST' || this.options.append) throw error
            }
        }
        throw logError('tooManyFiles')
    }

    fail (error) {
        if (this.failed) return
        this.failed = true
        try { this.onError(error, this.filePath) } catch (_) { /* notifications must not break terminal output */ }
    }

    write (data) {
        if (this.closed || this.failed) return
        const decoded = this.decoder.write(Buffer.isBuffer(data) ? data : Buffer.from(data))
        this.enqueue(this.options.stripAnsi ? this.filter.write(decoded) : decoded)
    }

    enqueue (text) {
        if (!text || this.failed) return
        const buffer = Buffer.from(text, 'utf8')
        if (this.pendingBytes + buffer.length > this.maxPendingBytes) {
            this.fail(logError('queueFull'))
            void this.close()
            return
        }
        this.pendingBytes += buffer.length
        this.chain = this.chain.then(async () => {
            // Flush accepted chunks even if the queue limit stopped later input.
            if (!this.handle) return
            let offset = 0
            while (offset < buffer.length) {
                const { bytesWritten } = await this.handle.write(buffer, offset, buffer.length - offset, null)
                if (!bytesWritten) throw logError('writeFailed')
                offset += bytesWritten
            }
        }).catch(error => {
            this.fail(error)
            void this.close()
        }).finally(() => { this.pendingBytes -= buffer.length })
    }

    close () {
        if (this.closing) return this.closing
        this.closed = true
        const tail = this.decoder.end()
        this.enqueue(this.options.stripAnsi ? this.filter.write(tail) : tail)
        this.closing = this.chain.then(async () => {
            if (this.handle) {
                const handle = this.handle
                this.handle = null
                await handle.close()
            }
        }).catch(error => this.fail(error))
        return this.closing
    }
}

module.exports = { DEFAULTS, safePart, formatFilename, resolveDirectory, contextFor, AnsiFilter, SessionLog }
