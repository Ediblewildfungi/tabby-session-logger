'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { DEFAULTS, formatFilename, resolveDirectory, contextFor, AnsiFilter, SessionLog } = require('../src/logging')
const context = { host: 'server01', session: '生产服务器' }
const date = new Date(2026, 10, 10, 22, 8, 5)

async function temporary (t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tabby-logger-test-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    return directory
}

test('SecureCRT-style tokens are case sensitive and preserve custom extensions', () => {
    assert.equal(formatFilename('%H_%S_%Y-%M-%D_%h-%m-%s.txt', context, date), 'server01_生产服务器_2026-11-10_22-08-05.txt')
    assert.equal(formatFilename('%y_%%.log', context, date), '26_%.log')
    assert.equal(formatFilename('output.custom', context, date), 'output.custom')
    assert.equal(formatFilename('output', context, date), 'output')
})

test('host/session values cannot introduce directories or recursive token substitution', () => {
    assert.equal(formatFilename('%H_%S.log', { host: '2001:db8::1', session: '../a\\b%Y' }, date), '2001_db8__1_.._a_b%Y.log')
    assert.equal(formatFilename('%S.txt', { session: 'CON' }, date), '_CON.txt')
})

test('invalid templates fail clearly', () => {
    for (const value of ['', '  ', '%Q.log', 'a%', '../a.log', 'C:\\a.txt', 'NUL.log', 'a.', '%H/hello.txt']) {
        assert.throws(() => formatFilename(value, context, date), Error, value)
    }
    assert.throws(() => formatFilename('文'.repeat(100), context, date), { translationKey: 'filenameLong' })
})

test('directories require absolute paths and support home expansion', () => {
    assert.equal(resolveDirectory('~/TabbyLogs'), path.join(os.homedir(), 'TabbyLogs'))
    assert.throws(() => resolveDirectory('../outside'), { translationKey: 'directoryAbsolute' })
    assert.throws(() => resolveDirectory(''), { translationKey: 'directoryRequired' })
})

test('SSH metadata uses destination host and stable profile name; local uses machine hostname', () => {
    assert.deepEqual(contextFor({ profile: { name: '服务器', options: { host: '10.0.0.1' } }, title: 'dynamic title' }), { host: '10.0.0.1', session: '服务器' })
    assert.equal(contextFor({ profile: { name: 'PowerShell', options: {} } }).host, os.hostname())
})

test('ANSI filtering works for every possible boundary, OSC links, DCS, and C1 controls', () => {
    const input = '你\x1b[31m好\x1b[0m\r\n\x1b]0;title\x07abc\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\x1bPsecret\x1b\\\x1b(B!\x9b32m绿\x9b0m\tend'
    const expected = '你好\r\nabclink!绿\tend'
    for (let i = 0; i <= input.length; i++) {
        const filter = new AnsiFilter()
        assert.equal(filter.write(input.slice(0, i)) + filter.write(input.slice(i)), expected)
    }
    const filter = new AnsiFilter()
    assert.equal([...input].map(c => filter.write(c)).join(''), expected)
})

test('creates directories, preserves split UTF-8, flushes before closing, ignores later writes', async t => {
    const directory = path.join(await temporary(t), 'nested', 'logs')
    const errors = []
    const log = new SessionLog({ directory, filename: '中文.txt' }, context, e => errors.push(e))
    const bytes = Buffer.from('你好🙂\x1b[31m红色\x1b[0m\r\n')
    for (const byte of bytes) log.write(Buffer.from([byte]))
    const closing = log.close()
    assert.equal(log.close(), closing)
    await closing
    log.write('should not appear')
    assert.equal(await fs.readFile(log.filePath, 'utf8'), '你好🙂红色\r\n')
    assert.deepEqual(errors, [])
    assert.equal(log.pendingBytes, 0)
})

test('raw mode preserves ANSI and text output', async t => {
    const log = new SessionLog({ directory: await temporary(t), filename: 'raw.log', stripAnsi: false }, context)
    log.write('\x1b[32m测试\x1b[0m')
    await log.close()
    assert.equal(await fs.readFile(log.filePath, 'utf8'), '\x1b[32m测试\x1b[0m')
})

test('concurrent sessions atomically choose distinct names without overwriting', async t => {
    const directory = await temporary(t)
    await fs.writeFile(path.join(directory, 'same.txt'), 'existing')
    const logs = Array.from({ length: 12 }, (_, i) => {
        const log = new SessionLog({ directory, filename: 'same.txt' }, context)
        log.write(String(i))
        return log
    })
    await Promise.all(logs.map(log => log.close()))
    assert.equal(new Set(logs.map(log => log.filePath)).size, 12)
    assert.equal(await fs.readFile(path.join(directory, 'same.txt'), 'utf8'), 'existing')
    for (let i = 0; i < logs.length; i++) assert.equal(await fs.readFile(logs[i].filePath, 'utf8'), String(i))
})

test('append mode keeps existing contents', async t => {
    const directory = await temporary(t)
    await fs.writeFile(path.join(directory, 'append.log'), 'before\n')
    const log = new SessionLog({ directory, filename: 'append.log', append: true }, context)
    log.write('after\n')
    await log.close()
    assert.equal(await fs.readFile(log.filePath, 'utf8'), 'before\nafter\n')
})

test('failed directory reports once without throwing into the terminal', async t => {
    const directory = path.join(await temporary(t), 'not-directory')
    await fs.writeFile(directory, 'file')
    const errors = []
    const log = new SessionLog({ directory }, context, e => errors.push(e))
    log.write('data')
    await log.close()
    assert.equal(errors.length, 1)
    assert.equal(log.failed, true)
    assert.equal(log.pendingBytes, 0)
})

test('bounded queue stops logging while flushing already accepted data', async t => {
    const errors = []
    const log = new SessionLog({ directory: await temporary(t), filename: 'limit.log' }, context, e => errors.push(e))
    log.maxPendingBytes = 5
    log.write('12345')
    log.write('6')
    await log.close()
    assert.equal(errors.length, 1)
    assert.equal(await fs.readFile(log.filePath, 'utf8'), '12345')
    assert.equal(log.closed, true)
})

test('disk write failure is contained and closes the file', async t => {
    const errors = []
    const log = new SessionLog({ directory: await temporary(t) }, context, e => errors.push(e))
    await log.chain
    const handle = log.handle
    handle.write = async () => { throw new Error('simulated disk full') }
    log.write('x')
    await log.close()
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /disk full/)
    assert.equal(log.handle, null)
})

test('default policy is automatic, readable, and non-overwriting', () => {
    assert.equal(DEFAULTS.language, 'auto')
    assert.equal(DEFAULTS.filename, '%Y-%M-%DT%h-%m-%s[%H][%S].txt')
    assert.equal(formatFilename(DEFAULTS.filename, context, date), '2026-11-10T22-08-05[server01][生产服务器].txt')
    assert.equal(DEFAULTS.enabled, true)
    assert.equal(DEFAULTS.append, false)
    assert.equal(DEFAULTS.stripAnsi, true)
})
