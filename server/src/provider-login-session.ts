import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { WebSocket } from 'ws'
import pty from '@homebridge/node-pty-prebuilt-multiarch'
import { resolvePiCli, resolveNode20CompatScript, resolveNodeExecutable } from './runtime-compat.js'

const LOGIN_ARGS = ['--no-context-files', '--no-extensions', '--no-skills', '--no-prompt-templates']

export class ProviderLoginSession {
  private ptyProcess: any = null
  private browser: WebSocket | null = null
  private loginTimer: NodeJS.Timeout | null = null

  get active(): boolean {
    return this.ptyProcess !== null
  }

  attach(browser: WebSocket): void {
    if (this.active) {
      browser.close(1013, 'A provider login is already open')
      return
    }

    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TERM: 'xterm-256color',
        COLUMNS: '100',
        LINES: '28',
      }
      delete env.PI_DASHBOARD_AUTH_TOKEN

      const cliPath = resolvePiCli()
      const compatScript = resolveNode20CompatScript()
      const compatArgs = (compatScript && existsSync(compatScript)) ? ['-r', compatScript] : []
      const command = resolveNodeExecutable()

      const isElectronBinary = command === process.execPath && !command.toLowerCase().endsWith('node.exe') && !command.toLowerCase().endsWith('node')
      if (isElectronBinary) {
        env.ELECTRON_RUN_AS_NODE = '1'
      }

      const ptyModule = (pty as any).default || pty
      const spawnArgs = [...compatArgs, cliPath, ...LOGIN_ARGS]
      const proc = ptyModule.spawn(command, spawnArgs, {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd: tmpdir(),
        env,
      })

      this.ptyProcess = proc
      this.browser = browser

      proc.onData((data: string) => {
        if (browser.readyState === browser.OPEN) {
          browser.send(Buffer.from(data, 'utf8'))
        }
      })

      this.loginTimer = setTimeout(() => {
        if (this.ptyProcess === proc) {
          proc.write('/login\r')
        }
      }, 1_800)

      const finish = (code = 1000, reason = 'Provider login console closed'): void => {
        if (this.loginTimer) clearTimeout(this.loginTimer)
        this.loginTimer = null
        if (this.ptyProcess === proc) this.ptyProcess = null
        if (this.browser === browser) this.browser = null
        if (browser.readyState === browser.OPEN) browser.close(code, reason.slice(0, 120))
      }

      proc.onExit(({ exitCode }: { exitCode?: number } = {}) => finish(1000, `Provider login console closed (code ${exitCode ?? 0})`))

      browser.on('message', (data) => {
        if (this.ptyProcess !== proc) return
        const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : new TextDecoder().decode(data as ArrayBuffer)
        try {
          const parsed = JSON.parse(text)
          if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
            proc.resize(Math.max(20, Math.min(200, parsed.cols)), Math.max(5, Math.min(100, parsed.rows)))
            return
          }
          if (parsed.type === 'input' && typeof parsed.data === 'string') {
            proc.write(parsed.data)
            return
          }
        } catch {}
        proc.write(text)
      })

      browser.once('error', () => void this.stop())
      browser.once('close', () => void this.stop())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to spawn provider login console'
      console.error('[ProviderLoginSession] Failed to attach:', message)
      if (browser.readyState === browser.OPEN) {
        browser.send(Buffer.from(`\r\n\x1b[31mError starting login console: ${message}\x1b[0m\r\n`))
        browser.close(1011, message.slice(0, 120))
      }
    }
  }

  async stop(): Promise<void> {
    const proc = this.ptyProcess
    if (!proc) return
    if (this.loginTimer) clearTimeout(this.loginTimer)
    this.loginTimer = null
    this.ptyProcess = null
    this.browser = null
    try {
      proc.kill()
    } catch {}
  }
}
