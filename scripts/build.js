'use strict'

// Source is already native CommonJS JavaScript: no compiler/bundler dependencies.
// Validate syntax, then assemble the directly loadable dist artifact.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const root = path.resolve(__dirname, '..')
const destination = path.join(root, 'dist')
fs.mkdirSync(destination, { recursive: true })
for (const filename of ['i18n.js', 'logging.js', 'index.js']) {
    const source = path.join(root, 'src', filename)
    execFileSync(process.execPath, ['--check', source], { stdio: 'inherit' })
    fs.copyFileSync(source, path.join(destination, filename))
}
fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
fs.copyFileSync(path.join(root, 'src', 'ScreenShot.jpg'), path.join(root, 'docs', 'ScreenShot.jpg'))
console.log('Built dist modules and documentation screenshot (zero additional dependencies).')
