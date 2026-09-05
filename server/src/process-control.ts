import { execFile, execSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessIdentity {
  pid: number
  creationTime?: string
}

export interface TerminateProcessTreeOptions {
  identity?: ProcessIdentity
  gracefulTimeoutMs?: number
  forceTimeoutMs?: number
}

export function processGroupOptions(): { detached?: boolean } {
  return process.platform === 'win32' ? {} : { detached: true }
}

export function terminateProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null) return
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  child.kill(signal)
}

async function windowsCreationTime(pid: number): Promise<string | undefined> {
  try {
    const command = "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($args[0])\" -ErrorAction Stop; if ($process) { $process.CreationDate.ToUniversalTime().ToString('o') }"
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command, String(pid)], {
      windowsHide: true,
      timeout: 5_000,
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function captureProcessIdentity(child: ChildProcess): Promise<ProcessIdentity | undefined> {
  if (!child.pid) return undefined
  return {
    pid: child.pid,
    ...(process.platform === 'win32' ? { creationTime: await windowsCreationTime(child.pid) } : {}),
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref()
    const finish = (exited: boolean) => {
      clearTimeout(timer)
      child.off('close', onClose)
      child.off('error', onError)
      resolve(exited)
    }
    const onClose = () => finish(true)
    const onError = () => finish(child.exitCode !== null || child.signalCode !== null)
    child.once('close', onClose)
    child.once('error', onError)
  })
}

async function identityStillMatches(identity: ProcessIdentity): Promise<boolean> {
  if (process.platform !== 'win32' || !identity.creationTime) return true
  const current = await windowsCreationTime(identity.pid)
  return current === identity.creationTime
}

async function taskkill(identity: ProcessIdentity, force: boolean): Promise<void> {
  if (!(await identityStillMatches(identity))) {
    throw new Error(`Refusing to terminate PID ${identity.pid}: process identity changed`)
  }
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(identity.pid), '/T', ...(force ? ['/F'] : [])], {
      windowsHide: true,
      timeout: 10_000,
    })
  } catch (error) {
    const stderr = String((error as { stderr?: string | Buffer }).stderr ?? '')
    if (!/not found|no running instance/i.test(stderr)) throw error
  }
}

export async function terminateProcessTree(child: ChildProcess, options: TerminateProcessTreeOptions = {}): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const identity = options.identity ?? await captureProcessIdentity(child)
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 2_000
  const forceTimeoutMs = options.forceTimeoutMs ?? 5_000

  if (process.platform === 'win32' && identity) {
    let forced = false
    try {
      await taskkill(identity, false)
    } catch {
      await taskkill(identity, true)
      forced = true
    }
    if (await waitForExit(child, forced ? forceTimeoutMs : gracefulTimeoutMs)) return
  } else {
    terminateProcess(child, 'SIGTERM')
    if (await waitForExit(child, gracefulTimeoutMs)) return
  }

  if (process.platform === 'win32' && identity) await taskkill(identity, true)
  else terminateProcess(child, 'SIGKILL')

  if (!(await waitForExit(child, forceTimeoutMs))) {
    throw new Error(`Worker process tree ${identity?.pid ?? child.pid ?? 'unknown'} did not exit after forced termination`)
  }
}

export function resolveExecutable(name: string): string {
  if (process.platform === 'win32') {
    const home = homedir()
    const candidates = [
      join(home, 'AppData', 'Local', name, 'bin', `${name}.exe`),
      join(home, 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', `${name}.exe`),
      join(home, 'AppData', 'Local', 'Programs', name, 'bin', `${name}.exe`),
      join(home, 'AppData', 'Roaming', 'npm', `${name}.cmd`),
      join(home, 'AppData', 'Roaming', 'npm', `${name}.exe`),
      join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', `${name}.exe`),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    try {
      const found = execSync(`where.exe ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split(/\r?\n/)[0]?.trim()
      if (found && existsSync(found)) return found
    } catch {}
    return name
  } else {
    try {
      const found = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split(/\r?\n/)[0]?.trim()
      if (found && existsSync(found)) return found
    } catch {}
    return name
  }
}
