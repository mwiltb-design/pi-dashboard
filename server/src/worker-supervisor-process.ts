import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { createWorkerAdapters } from './worker-adapter-factory.js'
import { WorkerCoordinator, WorkerError } from './worker-coordinator.js'
import { WorkerRulesService } from './worker-rules.js'
import { supervisorPipePath } from './worker-supervisor-client.js'
import type { SupervisorRequest, SupervisorResponse, WorkerSupervisorConfig } from './worker-supervisor-types.js'

const MAX_REQUEST_BYTES = 256 * 1024
const IDLE_EXIT_MS = 2 * 60_000

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const configPath = argument('--config')
if (!configPath) throw new Error('Worker supervisor requires --config')
const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkerSupervisorConfig
if (config.schemaVersion !== 1 || !config.dataDir || !config.workspace) throw new Error('Worker supervisor configuration is invalid')
const token = (await readFile(`${config.dataDir}/worker-supervisor.token`, 'utf8')).trim()
const pipePath = supervisorPipePath(config.dataDir)
const rules = new WorkerRulesService(config.rulesRoot)
const coordinator = new WorkerCoordinator({
  storePath: config.storePath,
  archivePath: config.archivePath,
  adapters: createWorkerAdapters(config),
  rulesService: rules,
  bounds: config.bounds,
  primaryDefaults: async () => ({}),
  workspace: config.workspace,
})
await coordinator.initialize()

let lastRequestAt = Date.now()
let closing = false

function authenticated(candidate: string): boolean {
  const supplied = Buffer.from(candidate)
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function dispatch(request: SupervisorRequest): Promise<unknown> {
  const params = request.params ?? {}
  switch (request.method) {
    case 'ping': return { ok: true, pid: process.pid, workspace: config.workspace }
    case 'shutdown':
      setTimeout(() => void stop(true), 25).unref()
      return { ok: true }
    case 'snapshot': return coordinator.snapshot()
    case 'get': return coordinator.get(String(params.id ?? ''))
    case 'getArchivedTasks': return coordinator.getArchivedTasks()
    case 'archiveTask': return coordinator.archiveTask(String(params.id ?? ''))
    case 'archiveAllCompleted': return coordinator.archiveAllCompleted()
    case 'restoreTask': return coordinator.restoreTask(String(params.id ?? ''))
    case 'start': return coordinator.start(params)
    case 'continueTask': return coordinator.continueTask(String(params.id ?? ''), String(params.prompt ?? ''), typeof params.mode === 'string' ? params.mode : undefined, params.forceHandoff === true)
    case 'cancel': return coordinator.cancel(String(params.id ?? ''))
    case 'changes': return coordinator.changes(String(params.id ?? ''), typeof params.runId === 'string' ? params.runId : undefined)
    case 'updateConfig':
      await rules.updateConfig(params.updates && typeof params.updates === 'object' ? params.updates as any : {})
      return coordinator.snapshot()
    case 'saveRule': return rules.saveRule(String(params.id ?? ''), String(params.content ?? ''))
    default: throw new WorkerError(`Unknown supervisor method '${request.method}'`, 404)
  }
}

function respond(socket: Socket, response: SupervisorResponse): void {
  if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`)
}

const server = createServer((socket) => {
  let buffer = ''
  let size = 0
  socket.setTimeout(30_000, () => socket.destroy())
  socket.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      socket.destroy()
      return
    }
    buffer += chunk.toString('utf8')
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    socket.removeAllListeners('data')
    let request: SupervisorRequest
    try {
      request = JSON.parse(buffer.slice(0, newline)) as SupervisorRequest
    } catch {
      respond(socket, { id: '', error: { message: 'Invalid supervisor request', status: 400 } })
      return
    }
    if (!authenticated(request.token ?? '')) {
      respond(socket, { id: request.id ?? '', error: { message: 'Not found', status: 404 } })
      return
    }
    lastRequestAt = Date.now()
    void dispatch(request)
      .then((result) => respond(socket, { id: request.id, result }))
      .catch((error) => respond(socket, {
        id: request.id,
        error: { message: error instanceof Error ? error.message : 'Supervisor request failed', status: error instanceof WorkerError ? error.status : 500 },
      }))
  })
  socket.on('error', () => undefined)
})

server.once('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') process.exit(0)
  throw error
})
server.listen(pipePath)

const idleTimer = setInterval(() => {
  void coordinator.snapshot().then((snapshot) => {
    const active = Boolean(snapshot.activeTaskId) || snapshot.tasks.some((task) => task.status === 'queued' || task.status === 'running')
    if (!active && Date.now() - lastRequestAt >= IDLE_EXIT_MS) void stop(false)
  }).catch(() => undefined)
}, 30_000)
idleTimer.unref()

async function stop(cancelWorkers: boolean): Promise<void> {
  if (closing) return
  closing = true
  clearInterval(idleTimer)
  if (cancelWorkers) await coordinator.shutdown().catch(() => undefined)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  process.exit(0)
}

process.on('SIGINT', () => void stop(true))
process.on('SIGTERM', () => void stop(true))
