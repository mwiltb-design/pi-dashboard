import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolvePiCli(): string {
  const candidates = [
    (() => {
      try {
        const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
        return resolve(dirname(fileURLToPath(mainUrl)), 'cli.js')
      } catch { return '' }
    })(),
    resolve(process.resourcesPath ?? '', 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    resolve(process.resourcesPath ?? '', 'server/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    resolve(import.meta.dirname ?? '', '../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    resolve(import.meta.dirname ?? '', '../node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    resolve(process.cwd(), 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    resolve(process.cwd(), '../node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0] || resolve(process.cwd(), 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js')
}

export function resolveNode20CompatScript(): string {
  const candidates = [
    resolve(import.meta.dirname ?? '', 'node20-compat.cjs'),
    resolve(import.meta.dirname ?? '', '../templates/node20-compat.cjs'),
    resolve(process.resourcesPath ?? '', 'server/dist/node20-compat.cjs'),
    resolve(process.resourcesPath ?? '', 'server/templates/node20-compat.cjs'),
    resolve(process.cwd(), 'server/templates/node20-compat.cjs'),
    resolve(process.cwd(), 'server/dist/node20-compat.cjs'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0] || ''
}

export function resolveNodeExecutable(): string {
  // If running directly under a normal Node binary (not an Electron GUI executable)
  if (process.execPath) {
    const lower = process.execPath.toLowerCase()
    if (!lower.endsWith('foci dashboard.exe') && !lower.endsWith('electron.exe')) {
      return process.execPath
    }
  }

  // 1. Try finding 'node' via system lookup (where.exe on Windows, which on POSIX)
  try {
    const isWindows = process.platform === 'win32'
    const cmd = isWindows ? 'where.exe node' : 'which node'
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const firstLine = output.split(/\r?\n/)[0]?.trim()
    if (firstLine && existsSync(firstLine)) return firstLine
  } catch {}

  // 2. Common Windows paths for node.exe
  if (process.platform === 'win32') {
    const winCandidates = [
      resolve(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
      resolve(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'node', 'node.exe'),
      resolve(process.env.APPDATA ?? '', 'nvm', 'node.exe'),
      resolve(process.env.LOCALAPPDATA ?? '', 'nvm', 'node.exe'),
    ]
    for (const candidate of winCandidates) {
      if (candidate && existsSync(candidate)) return candidate
    }
  }

  // Fallback to process.execPath
  return process.execPath
}
