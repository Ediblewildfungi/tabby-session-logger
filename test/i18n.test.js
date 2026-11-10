'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { messages, resolveLanguage, translate, logError, errorText } = require('../src/i18n')

test('locale mapping supports Chinese variants, explicit overrides, and English fallback', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'zh-Hans', 'zh_Hant', 'ZH', 'zh']) assert.equal(resolveLanguage('auto', locale), 'zh')
    for (const locale of ['en-US', 'en-GB', 'ja-JP', 'fr-FR', '', undefined]) assert.equal(resolveLanguage('auto', locale), 'en')
    assert.equal(resolveLanguage('en', 'zh-CN'), 'en')
    assert.equal(resolveLanguage('zh', 'en-US'), 'zh')
    assert.equal(resolveLanguage(undefined, 'zh-TW'), 'zh')
    assert.equal(resolveLanguage('invalid', 'zh-CN'), 'zh')
})

test('dictionaries have matching nonempty keys and interpolation parameters', () => {
    assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.zh).sort())
    for (const key of Object.keys(messages.en)) {
        assert.ok(messages.en[key].length)
        assert.ok(messages.zh[key].length)
        assert.deepEqual(messages.en[key].match(/\{\w+\}/g), messages.zh[key].match(/\{\w+\}/g))
    }
    assert.equal(translate('en', 'unknownToken', { token: 'Q' }), 'Unknown placeholder: %Q')
    assert.equal(translate('zh', 'unknownToken', { token: 'Q' }), '未知占位符：%Q')
})

test('every static UI and logging error key exists in both dictionaries', () => {
    const source = ['index.js', 'logging.js'].map(name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')).join('\n')
    const keys = [...source.matchAll(/(?:\bt|logError)\('([^']+)'/g)].map(match => match[1])
    for (const key of keys) {
        assert.ok(messages.en[key], key)
        assert.ok(messages.zh[key], key)
    }
})

test('plugin errors can be retranslated and system errors retain useful details', () => {
    const error = logError('unknownToken', { token: 'bad' })
    assert.match(errorText(error, 'en'), /Unknown placeholder: %bad/)
    assert.match(errorText(error, 'zh'), /未知占位符：%bad/)
    const disk = Object.assign(new Error('ENOSPC: sample.txt'), { code: 'ENOSPC' })
    assert.match(errorText(disk, 'en'), /disk is full.*ENOSPC/)
    assert.match(errorText(disk, 'zh'), /磁盘空间已满.*ENOSPC/)
    assert.equal(errorText(new Error('Native detail'), 'zh'), 'Native detail')
})
