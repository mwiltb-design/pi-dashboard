import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { WorkerChangeTracker } from '../src/worker-change-tracker.js'

const execute = promisify(execFile)

test('WorkerChangeTracker captures edits made after a pre-existing dirty baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-changes-'))
  const data = await mkdtemp(join(tmpdir(), 'worker-change-data-'))
  try {
    await execute('git', ['init'], { cwd: root })
    await execute('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    await execute('git', ['config', 'user.name', 'Test'], { cwd: root })
    const path = join(root, 'notes.txt')
    await writeFile(path, 'original\n')
    await execute('git', ['add', 'notes.txt'], { cwd: root })
    await execute('git', ['commit', '-m', 'baseline'], { cwd: root })
    await writeFile(path, 'user edit before worker\n')

    const tracker = new WorkerChangeTracker(root, join(data, 'tasks.json'))
    await tracker.captureBaseline('run-1')
    await writeFile(path, 'user edit before worker\nworker addition\n')
    const changes = await tracker.captureChanges('run-1')

    assert.equal(changes.files.length, 1)
    assert.equal(changes.files[0]?.path, 'notes.txt')
    assert.match(changes.files[0]?.diff ?? '', /worker addition/)
    assert.match(changes.files[0]?.diff ?? '', /user edit before worker/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(data, { recursive: true, force: true })
  }
})
