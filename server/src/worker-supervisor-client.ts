import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { atomicWriteFile } from './durable-file.js'
import { WorkerError } from './worker-coordinator.js'
import type { WorkerConfiguration, WorkerTask } from './worker-types.js'
import type { SupervisorRequest, SupervisorResponse, WorkerSupervisorConfig } from './worker-supervisor-types.js'

const MAX_MESSAGE_BYTES = 3 * 1024 * 1024

export function supervisorPipePath(dataDir: string): string {
  const normalized = resolve(dataDir).toLowerCase().replaceAll('\\', '/')
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return process.platform === 'win32' ? `\\\\.\\pipe\\foci-supervisor-${hash}` : join(tmpdir(), `foci-supervisor-${hash}.sock`)
}

async function tokenFor(dataDir: string): Promise<string> {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, 'worker-supervisor.token')
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const token = randomBytes(32).toString('base64url')
  try {
    const handle = await open(path, 'wx', 0o600)
    try { await handle.writeFile(`${token}\n`) } finally { await handle.close() }
    return token
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return (await readFile(path, 'utf8')).trim()
  }
}

export class WorkerSupervisorClient {
  private token = ''
  private readonly pipePath: string
  private readonly configPath: string
  private reconnecting?: Promise<void>

  constructor(private readonly config: WorkerSupervisorConfig) {
    this.pipePath = supervisorPipePath(config.dataDir)
    this.configPath = join(config.dataDir, 'worker-supervisor-config.json')
  }

  async initialize(): Promise<void> {
    this.token = await tokenFor(this.config.dataDir)
    await atomicWriteFile(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`)
    await this.ensureSupervisor()
  }

  private async ensureSupervisor(): Promise<void> {
    if (this.reconnecting) return this.reconnecting
    const reconnect = this.connectOrStart()
    this.reconnecting = reconnect
    try {
      await reconnect
    } finally {
      if (this.reconnecting === reconnect) this.reconnecting = undefined
    }
  }

  private async connectOrStart(): Promise<void> {
    try {
      await this.rawCall('ping')
      return
    } catch {
      // No owner is listening yet. The named pipe arbitrates simultaneous launch attempts.
    }
    const entry = resolve(import.meta.dirname, 'worker-supervisor-process.ts')
    const child = spawn(process.execPath, ['--import', 'tsx', entry, '--config', this.configPath], {
      cwd: resolve(import.meta.dirname, '..'),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PI_DASHBOARD_SUPERVISOR: '1' },
    })
    child.unref()

    const deadline = Date.now() + 10_000
    let lastError: unknown
    while (Date.now() < deadline) {
      try {
        await this.rawCall('ping')
        return
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw new WorkerError(`Worker supervisor did not start: ${lastError instanceof Error ? lastError.message : 'connection timed out'}`, 503)
  }

  async close(): Promise<void> {
    // Disconnecting a Dashboard must not cancel supervisor-owned work.
  }

  async info(): Promise<{ ok: boolean; pid: number; workspace: string }> { return this.call('ping') }
  async shutdown(): Promise<void> { await this.call('shutdown') }
  async snapshot(): Promise<any> { return this.call('snapshot') }
  async get(id: string): Promise<WorkerTask | undefined> { return this.call('get', { id }) }
  async getArchivedTasks(): Promise<WorkerTask[]> { return this.call('getArchivedTasks') }
  async archiveTask(id: string): Promise<boolean> { return this.call('archiveTask', { id }) }
  async archiveAllCompleted(): Promise<number> { return this.call('archiveAllCompleted') }
  async restoreTask(id: string): Promise<boolean> { return this.call('restoreTask', { id }) }
  async start(input: Record<string, unknown>): Promise<WorkerTask> { return this.call('start', input) }
  async continueTask(id: string, prompt: string, mode?: string, forceHandoff = false): Promise<WorkerTask> { return this.call('continueTask', { id, prompt, mode, forceHandoff }) }
  async cancel(id: string): Promise<WorkerTask> { return this.call('cancel', { id }) }
  async changes(id: string, runId?: string): Promise<unknown> { return this.call('changes', { id, runId }) }
  async updateConfig(updates: Partial<WorkerConfiguration>): Promise<any> { return this.call('updateConfig', { updates }) }
  async saveRule(id: string, content: string): Promise<any> { return this.call('saveRule', { id, content }) }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    try {
      return await this.rawCall<T>(method, params)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!['ENOENT', 'ECONNREFUSED'].includes(code ?? '')) throw error
      await this.ensureSupervisor()
      return this.rawCall<T>(method, params)
    }
  }

  private rawCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const request: SupervisorRequest = { id: randomUUID(), token: this.token, method, ...(params ? { params } : {}) }
    return new Promise<T>((resolveCall, rejectCall) => {
      const socket = connect(this.pipePath)
      let buffer = ''
      let size = 0
      let settled = false
      const finish = (error?: Error, result?: T) => {
        if (settled) return
        settled = true
        socket.destroy()
        if (error) rejectCall(error)
        else resolveCall(result as T)
      }
      socket.setTimeout(30_000, () => finish(new WorkerError('Worker supervisor request timed out', 504)))
      socket.once('error', (error) => finish(error))
      socket.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_MESSAGE_BYTES) return finish(new WorkerError('Worker supervisor response was too large', 502))
        buffer += chunk.toString('utf8')
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as SupervisorResponse
          if (response.id !== request.id) return finish(new WorkerError('Worker supervisor response did not match the request', 502))
          if (response.error) return finish(new WorkerError(response.error.message, response.error.status))
          finish(undefined, response.result as T)
        } catch {
          finish(new WorkerError('Worker supervisor returned invalid JSON', 502))
        }
      })
      socket.once('connect', () => socket.end(`${JSON.stringify(request)}\n`))
    })
  }
}
