import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Agent, request as httpRequest } from 'node:http'
import { Type } from '@sinclair/typebox'

function getToken(): string {
  return process.env.PI_DASHBOARD_WORKER_INTERNAL_TOKEN ?? ''
}

function getPort(): number {
  return Number(process.env.PORT ?? 4317)
}

const MAX_RESPONSE_BYTES = 64 * 1024
const POLL_MS = 2_000
const MAX_DELEGATE_WAIT_MS = 31 * 60_000
const CLEANUP_GRACE_MS = 30_000
const MAX_CONSECUTIVE_POLL_FAILURES = 5

const httpAgent = new Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 10_000,
})

function request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      agent: httpAgent,
      host: '127.0.0.1',
      port: getPort(),
      method,
      path,
      headers: {
        'x-pi-dashboard-worker-token': getToken(),
        'content-type': 'application/json',
        'content-length': String(payload.length),
      },
      timeout: 60_000,
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) response.destroy(new Error('Worker response is too large'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { reject(new Error('Dashboard returned an invalid worker response')); return }
        if ((response.statusCode ?? 500) >= 400) reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'Worker request failed'))
        else resolve(parsed)
      })
    })
    req.on('timeout', () => req.destroy(new Error('Worker request timed out')))
    req.on('error', reject)
    req.end(payload)
  })
}

async function pollTaskUntilDone(
  id: string,
  initialTask: Record<string, unknown>,
  waitDeadline: number,
): Promise<{ task: Record<string, unknown>; waitEnded: boolean }> {
  let task = initialTask
  let consecutiveFailures = 0

  while (task.status === 'queued' || task.status === 'starting' || task.status === 'running' || task.status === 'cancelling') {
    if (Date.now() >= waitDeadline) {
      return { task, waitEnded: true }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    try {
      const latest = await request('GET', `/internal/workers/tasks/${encodeURIComponent(id)}`)
      task = latest
      consecutiveFailures = 0
    } catch {
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return { task, waitEnded: true }
      }
    }
  }
  return { task, waitEnded: false }
}

export default function dashboardWorkers(pi: ExtensionAPI) {
  if (!getToken()) return
  pi.registerTool({
    name: 'dashboard_delegate_worker',
    label: 'Delegate to Worker',
    description: 'Send one bounded task to an enabled worker provider (Sub PI, Antigravity CLI, Codex CLI, Claude CLI). Consult WORKERS.md rules for provider specialization. Returns a concise result envelope; Primary PI must review all findings and changes.',
    promptSnippet: 'Delegate a narrow research, review, or implementation task to a specialized worker CLI',
    promptGuidelines: [
      'Consult WORKERS.md routing rules when choosing which provider to delegate to (e.g. antigravity-cli for science/deep reasoning, codex-cli for fast code/tests, claude-cli for docs/critique, sub-pi for native Pi tasks).',
      'Workers execute sequentially in the background. If multiple tasks are delegated, they queue automatically.',
      'If a task returns status "still_running" or waitEnded: true, DO NOT resubmit the task. Use dashboard_get_worker_task with the taskId to check its progress.',
      'Use workers for narrow, bounded tasks with concrete deliverables.',
      'Review worker results and project changes yourself before presenting them as accepted.',
      'Do not delegate work that requires interactive user approval, credentials, or recursive worker delegation.',
    ],
    parameters: Type.Object({
      providerId: Type.Optional(Type.Union([
        Type.Literal('sub-pi'),
        Type.Literal('antigravity-cli'),
        Type.Literal('codex-cli'),
        Type.Literal('claude-cli'),
      ], { description: 'Target worker provider. Defaults to sub-pi if omitted.' })),
      mode: Type.Union([
        Type.Literal('research'),
        Type.Literal('review'),
        Type.Literal('implement'),
      ], { description: 'Read-only research, read-only review, or project-writing implementation.' }),
      prompt: Type.String({ minLength: 1, maxLength: 12000, description: 'The complete bounded task and expected deliverable.' }),
      bounds: Type.Optional(Type.Object({
        turnLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 30, description: 'Maximum turns (1-30)' })),
        timeoutMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 30, description: 'Maximum minutes (1-30)' })),
        resultLimitKb: Type.Optional(Type.Number({ minimum: 1, maximum: 64, description: 'Maximum result size in KB (1-64)' })),
      }, { description: 'Optional execution bounds override' })),
    }),
    async execute(toolCallId, parameters) {
      let id = ''
      try {
        const payload = {
          providerId: parameters.providerId,
          mode: parameters.mode,
          prompt: parameters.prompt,
          submissionId: toolCallId,
          ...(parameters.bounds ? {
            bounds: {
              ...(parameters.bounds.turnLimit ? { turnLimit: parameters.bounds.turnLimit } : {}),
              ...(parameters.bounds.timeoutMinutes ? { timeoutMs: parameters.bounds.timeoutMinutes * 60_000 } : {}),
              ...(parameters.bounds.resultLimitKb ? { resultLimitBytes: parameters.bounds.resultLimitKb * 1024 } : {}),
            },
          } : {}),
        }
        let created: Record<string, unknown>
        try {
          created = await request('POST', '/internal/workers/tasks', payload)
        } catch (postError) {
          let recovered: Record<string, unknown> | undefined
          try {
            const list = await request('GET', '/internal/workers/tasks')
            const tasks = Array.isArray(list.tasks) ? list.tasks as Record<string, unknown>[] : []
            const targetPrompt = parameters.prompt.trim()
            const targetProvider = parameters.providerId || 'sub-pi'
            recovered = tasks.find((t) =>
              t.submissionId === toolCallId ||
              (['queued', 'starting', 'running'].includes(String(t.status)) &&
                t.providerId === targetProvider &&
                t.mode === parameters.mode &&
                typeof t.prompt === 'string' &&
                t.prompt.trim() === targetPrompt)
            )
          } catch {}
          if (recovered && recovered.id) {
            created = recovered
          } else {
            throw postError
          }
        }
        id = String(created.id ?? '')
        if (!id) throw new Error('Dashboard did not return a worker task ID')

        const bounds = created.bounds as Record<string, unknown> | undefined
        const taskTimeoutMs = typeof bounds?.timeoutMs === 'number' ? bounds.timeoutMs : MAX_DELEGATE_WAIT_MS - CLEANUP_GRACE_MS
        const waitDeadline = Date.now() + Math.min(MAX_DELEGATE_WAIT_MS, Math.max(60_000, taskTimeoutMs + CLEANUP_GRACE_MS))

        const { task, waitEnded } = await pollTaskUntilDone(id, created, waitDeadline)

        if (waitEnded && (task.status === 'queued' || task.status === 'starting' || task.status === 'running' || task.status === 'cancelling')) {
          const summary = {
            taskId: id,
            status: 'still_running',
            actualStatus: task.status,
            waitEnded: true,
            message: 'The worker task is still running in the background. DO NOT submit this task again. Use dashboard_get_worker_task with this taskId to check progress or retrieve the final result.',
            sessionId: task.sessionId,
            result: task.result,
            resultTruncated: task.resultTruncated,
            changedFiles: task.changedFiles,
            error: task.error,
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
            details: summary,
            isError: false,
          }
        }

        const summary = {
          taskId: id,
          status: task.status,
          sessionId: task.sessionId,
          result: task.result,
          resultTruncated: task.resultTruncated,
          changedFiles: task.changedFiles,
          error: task.error,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          details: summary,
          isError: task.status !== 'completed',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Worker delegation failed'
        return {
          content: [{ type: 'text', text: message }],
          details: {
            taskId: id,
            status: id ? 'still_running' : 'failed',
            sessionId: undefined,
            result: undefined,
            resultTruncated: false,
            changedFiles: undefined,
            error: message,
          },
          isError: !id,
        }
      }
    },
  })

  pi.registerTool({
    name: 'dashboard_get_worker_task',
    label: 'Get Worker Task Status',
    description: 'Check the status and retrieve the result of an existing worker task by its taskId. Use this tool when a previous delegation returned waitEnded: true or status: "still_running" instead of rerunning the task.',
    promptSnippet: 'Check the status or wait for the completion of an active or completed worker task',
    promptGuidelines: [
      'Use this tool to poll or retrieve results for a task that was already submitted with dashboard_delegate_worker.',
      'Never resubmit a duplicate task with dashboard_delegate_worker if the previous task is still running.',
    ],
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1, description: 'The task ID returned from dashboard_delegate_worker.' }),
      waitSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 300, description: 'Optional number of seconds to wait/poll for completion before returning current status (default 30, max 300).' })),
    }),
    async execute(toolCallId, parameters) {
      const id = parameters.taskId.trim()
      try {
        const initial = await request('GET', `/internal/workers/tasks/${encodeURIComponent(id)}`)
        const waitSeconds = typeof parameters.waitSeconds === 'number' ? Math.min(300, Math.max(0, parameters.waitSeconds)) : 30
        const waitDeadline = Date.now() + waitSeconds * 1000

        const { task, waitEnded } = await pollTaskUntilDone(id, initial, waitDeadline)

        if (waitEnded && (task.status === 'queued' || task.status === 'starting' || task.status === 'running' || task.status === 'cancelling')) {
          const summary = {
            taskId: id,
            status: 'still_running',
            actualStatus: task.status,
            waitEnded: true,
            message: 'The worker task is still running in the background. Call dashboard_get_worker_task again later or proceed with other work.',
            sessionId: task.sessionId,
            result: task.result,
            resultTruncated: task.resultTruncated,
            changedFiles: task.changedFiles,
            error: task.error,
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
            details: summary,
            isError: false,
          }
        }

        const summary = {
          taskId: id,
          status: task.status,
          sessionId: task.sessionId,
          result: task.result,
          resultTruncated: task.resultTruncated,
          changedFiles: task.changedFiles,
          error: task.error,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          details: summary,
          isError: task.status !== 'completed',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to retrieve worker task status'
        return {
          content: [{ type: 'text', text: message }],
          details: {
            taskId: id,
            status: 'failed',
            sessionId: undefined,
            result: undefined,
            resultTruncated: false,
            changedFiles: undefined,
            error: message,
          },
          isError: true,
        }
      }
    },
  })
}
