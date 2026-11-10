'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const root = path.resolve(__dirname, '..')
const base = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'tabby')
    : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'tabby')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'tabby')
const target = path.resolve(process.argv[2] || path.join(base, 'plugins', 'node_modules', 'tabby-session-logger'))
if (path.basename(target) !== 'tabby-session-logger') throw new Error('The installation target must end with tabby-session-logger')
if (target === root) throw new Error('不能将源码目录作为安装目标')
execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' })
fs.mkdirSync(path.join(target, 'dist'), { recursive: true })
for (const filename of ['index.js', 'logging.js', 'i18n.js']) fs.copyFileSync(path.join(root, 'dist', filename), path.join(target, 'dist', filename))
for (const filename of ['README.md', 'README.zh-CN.md', 'LICENSE']) fs.copyFileSync(path.join(root, filename), path.join(target, filename))
fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
fs.copyFileSync(path.join(root, 'docs', 'ScreenShot.jpg'), path.join(target, 'docs', 'ScreenShot.jpg'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
delete pkg.scripts
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
console.log('Installed: ' + target + '\nRestart Tabby to load the plugin.')
