import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AntigravityWorkerAdapter } from '../src/antigravity-worker.js'
import type { GitService, GitStatusResult } from '../src/git-service.js'
import type { WorkerRunHooks, WorkerRunInput } from '../src/worker-types.js'

function mockGit(): GitService {
  return {
    async status(): Promise<GitStatusResult> {
      return { isRepo: true, branch: 'main', entries: [] }
    },
  } as unknown as GitService
}

test('AntigravityWorkerAdapter advertises native continuation and sessions', () => {
  const adapter = new AntigravityWorkerAdapter({
    workspace: process.cwd(),
    git: mockGit(),
    enabled: true,
  })

  assert.equal(adapter.provider.capabilities.nativeSessions, true)
  assert.equal(adapter.provider.capabilities.continuation, true)
  assert.equal(adapter.provider.capabilities.modelSelection, true)
})

test('AntigravityWorkerAdapter runs with json output format and captures conversation ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agy-worker-test-'))
  const mockScript = join(root, 'mock-agy.cjs')
  const argLog = join(root, 'args.json')

  // Script that records its arguments and prints mock agy JSON output
  await writeFile(
    mockScript,
    `
    const fs = require('fs');
    fs.writeFileSync(${JSON.stringify(argLog)}, JSON.stringify(process.argv.slice(2)));
    console.log(JSON.stringify({
      conversation_id: "conv-12345",
      status: "SUCCESS",
      response: "Mocked Antigravity research result",
      num_turns: 1
    }));
    `,
    'utf8'
  )

  const capturedSessions: string[] = []
  const hooks: WorkerRunHooks = {
    onSession: async (id) => { capturedSessions.push(id) },
    onProgress: async () => {},
  }

  const input: WorkerRunInput = {
    taskId: 'task-1',
    runId: 'run-1',
    providerId: 'antigravity-cli',
    mode: 'research',
    prompt: 'Investigate system architecture',
    bounds: { timeoutMs: 30_000, turnLimit: 5, resultLimitBytes: 4096 },
    ruleContext: '',
  }

  const adapter = new AntigravityWorkerAdapter({
    workspace: root,
    git: mockGit(),
    enabled: true,
    command: process.execPath,
    commandArgs: [mockScript],
  })

  try {
    const output = await adapter.run(input, hooks)

    assert.equal(output.result, 'Mocked Antigravity research result')
    assert.deepEqual(capturedSessions, ['conv-12345'])
    assert.equal(output.resultEnvelope?.sessionId, 'conv-12345')

    // Test continuation: pass sessionId in native continuation mode
    const continuationInput: WorkerRunInput = {
      ...input,
      runId: 'run-2',
      prompt: 'Next step',
      continuation: {
        kind: 'native',
        sessionId: 'conv-12345',
      },
    }

    const continuationOutput = await adapter.run(continuationInput, hooks)
    assert.equal(continuationOutput.result, 'Mocked Antigravity research result')

    const recordedArgs = JSON.parse(await import('node:fs/promises').then((f) => f.readFile(argLog, 'utf8'))) as string[]
    assert.ok(recordedArgs.includes('--conversation'))
    assert.ok(recordedArgs.includes('conv-12345'))
    assert.ok(recordedArgs.includes('--output-format'))
    assert.ok(recordedArgs.includes('json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
