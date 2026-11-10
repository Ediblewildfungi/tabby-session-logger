'use strict'

// Small local dictionaries; no translation package or network requests.
const messages = {
    en: {
        title: 'Session logs',
        description: 'Automatically save terminal output as UTF-8 text files.',
        language: 'Language', auto: 'Follow Tabby',
        languageHint: 'Preview the language immediately; save to keep your choice. Other Tabby languages fall back to English.',
        enabled: 'Enable automatic session logging', directory: 'Log directory',
        directoryPlaceholder: 'For example: D:\\TerminalLogs', browse: 'Choose directory', open: 'Open directory',
        filename: 'Filename pattern (including extension)',
        filenameHint: 'Default: %Y-%M-%DT%h-%m-%s[%H][%S].txt. You can use .log or any other extension.',
        preview: 'Preview (sample host and session)', sampleSession: 'Production server',
        stripAnsi: 'Remove ANSI colors and terminal control sequences (recommended)',
        append: 'Append to existing files with the same name',
        appendHint: 'By default, _1, _2, etc. are added to avoid overwriting files. In append mode, sessions sharing a filename may write to the same file.',
        saving: 'Saving…', save: 'Save settings',
        saved: 'Saved. Changes apply to open sessions and new sessions.',
        placeholders: 'Filename placeholders', token: 'Token', meaning: 'Meaning', example: 'Example',
        host: 'Hostname / SSH address', session: 'Tabby session name',
        year: 'Four-digit year', shortYear: 'Two-digit year', month: 'Month (01–12)', day: 'Day (01–31)',
        hour: 'Hour (00–23)', minute: 'Minute (00–59)', second: 'Second (00–59)', percent: 'Percent sign',
        tokenHint: 'Case sensitive: %M is the month, %m is the minute. Local date and time are fixed when logging starts.',
        active: 'Sessions being logged', empty: 'No sessions are being logged. Enable logging and open a terminal to start.',
        creating: 'Creating file…', lastError: 'Latest error', stopped: 'Session logging stopped',
        behavior: 'Saving changes to logging options starts a new log for open sessions. Changing only the language keeps existing logs running. Disable logging and save to stop. Only terminal output is recorded; keystrokes are not captured separately. Full-screen apps and progress bars are not reconstructed as screen snapshots.',
        filenameRequired: 'Enter a filename pattern.', unknownToken: 'Unknown placeholder: %{token}',
        invalidFilename: 'Use a filename only, without paths or characters such as <>:"/\\|?*.',
        filenameEnding: 'A filename cannot end with a dot or a space.', reservedFilename: 'This filename is reserved by the operating system.',
        filenameLong: 'The filename is too long. Shorten the pattern or session name.',
        directoryRequired: 'Enter a log directory.', directoryAbsolute: 'The log directory must be an absolute path or start with ~/.',
        directoryInvalid: 'The log directory contains an invalid character.',
        tooManyFiles: 'Too many files have this name. Add a timestamp to the filename pattern.',
        queueFull: 'Logging stopped because disk writes could not keep up with terminal output (more than 8 MiB queued).',
        writeFailed: 'Unable to write to the log file.',
        permissionDenied: 'Permission denied. Choose a writable directory.', diskFull: 'The disk is full.',
        notDirectory: 'The selected path is not a directory.', pathMissing: 'The path could not be found.',
    },
    zh: {
        title: '会话日志', description: '自动将终端输出保存为 UTF-8 文本文件。',
        language: '语言', auto: '跟随 Tabby',
        languageHint: '选择后立即预览语言，保存后记住此选择。Tabby 使用其他语言时回退到英文。',
        enabled: '启用自动日志记录', directory: '日志保存目录',
        directoryPlaceholder: '例如 D:\\TerminalLogs', browse: '选择目录', open: '打开目录',
        filename: '文件命名规则（包含扩展名）',
        filenameHint: '默认：%Y-%M-%DT%h-%m-%s[%H][%S].txt。也可改为 .log，扩展名由你决定。',
        preview: '预览（示例主机与会话）', sampleSession: '生产服务器',
        stripAnsi: '去除 ANSI 颜色与终端控制序列（推荐）', append: '同名文件追加写入',
        appendHint: '默认不覆盖：文件名冲突时自动添加 _1、_2 等序号。开启追加后，同名会话可能写入同一文件。',
        saving: '正在保存…', save: '保存设置', saved: '已保存。变更立即应用于已打开及后续的新会话。',
        placeholders: '命名占位符', token: '占位符', meaning: '含义', example: '示例',
        host: '主机名 / SSH 地址', session: 'Tabby 会话名称', year: '四位年份', shortYear: '两位年份',
        month: '月份（01–12）', day: '日期（01–31）', hour: '小时（00–23）', minute: '分钟（00–59）',
        second: '秒（00–59）', percent: '百分号',
        tokenHint: '区分大小写：%M 为月份，%m 为分钟。日期采用本机时间，在日志开始时确定。',
        active: '正在记录的会话', empty: '暂无正在记录的会话。启用后打开一个终端即可。',
        creating: '正在创建…', lastError: '最近错误', stopped: '会话日志记录已停止',
        behavior: '修改日志设置并保存会为当前会话重新开始记录；仅切换语言不会中断现有日志。关闭开关并保存会停止记录。仅记录终端输出，不额外采集键盘输入。全屏程序和进度条不会还原成屏幕快照。',
        filenameRequired: '请填写文件命名规则', unknownToken: '未知占位符：%{token}',
        invalidFilename: '命名规则只能包含文件名，不能包含路径或 <>:"/\\|?* 等字符',
        filenameEnding: '文件名不能以点或空格结尾', reservedFilename: '该文件名是系统保留名称',
        filenameLong: '文件名过长，请缩短命名规则或会话名称', directoryRequired: '请填写日志目录',
        directoryAbsolute: '日志目录必须为绝对路径，或以 ~/ 开头', directoryInvalid: '日志目录包含无效字符',
        tooManyFiles: '同名日志文件过多，请在命名规则中加入时间',
        queueFull: '磁盘写入跟不上终端输出（待写入超过 8 MiB），本次日志已停止', writeFailed: '无法写入日志文件',
        permissionDenied: '没有写入权限，请选择可写入的目录', diskFull: '磁盘空间已满',
        notDirectory: '所选路径不是目录', pathMissing: '找不到指定路径',
    },
}

function resolveLanguage (preference, tabbyLocale) {
    if (preference === 'en' || preference === 'zh') return preference
    return /^zh(?:[-_]|$)/i.test(String(tabbyLocale || '')) ? 'zh' : 'en'
}

function translate (language, key, parameters = {}) {
    const template = messages[language]?.[key] ?? messages.en[key] ?? key
    return template.replace(/\{(\w+)\}/g, (match, name) => String(parameters[name] ?? match))
}

function logError (key, parameters = {}) {
    const error = new Error(translate('en', key, parameters))
    error.translationKey = key
    error.parameters = parameters
    return error
}

function errorText (error, language) {
    if (error?.translationKey) return translate(language, error.translationKey, error.parameters)
    const key = { EACCES: 'permissionDenied', EPERM: 'permissionDenied', ENOSPC: 'diskFull', ENOTDIR: 'notDirectory', ENOENT: 'pathMissing' }[error?.code]
    const details = error?.message || String(error)
    return key ? `${translate(language, key)} (${details})` : details
}

module.exports = { messages, resolveLanguage, translate, logError, errorText }
