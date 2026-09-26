import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function unusedPort(): Promise<number> {
  const listener = createServer()
  await new Promise<void>((resolveListen, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port')
  await new Promise<void>((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return Promise.race([
    once(child, 'exit').then(() => undefined),
    new Promise<void>((resolveWait) => setTimeout(resolveWait, timeoutMs)),
  ])
}

test('packaged UI can load before auth while API remains protected', { timeout: 40_000 }, async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'foci-auth-ui-test-'))
  const uiRoot = join(tempRoot, 'ui')
  const profileRoot = join(tempRoot, '.pi-dashboard')
  const workspaceRoot = join(tempRoot, 'workspace')
  const token = 'test-only-dashboard-token'
  mkdirSync(join(uiRoot, 'assets'), { recursive: true })
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(join(uiRoot, 'index.html'), '<!doctype html><title>Test Dashboard</title>', 'utf8')
  writeFileSync(join(uiRoot, 'assets', 'app.js'), 'window.dashboardTest = true', 'utf8')
  writeFileSync(join(profileRoot, 'remote-access.json'), JSON.stringify({ enabled: true, authToken: token }), 'utf8')

  const port = await unusedPort()
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      USERPROFILE: tempRoot,
      HOME: tempRoot,
      APPDATA: join(tempRoot, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(tempRoot, 'AppData', 'Local'),
      PORT: String(port),
      HOST: '127.0.0.1',
      PI_DASHBOARD_UI_DIST: uiRoot,
      PI_DASHBOARD_WORKSPACE: workspaceRoot,
      PI_AGENT_DIR: join(tempRoot, '.pi', 'agent'),
      PI_DASHBOARD_PROFILE: 'core',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await waitForExit(child)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    rmSync(tempRoot, { recursive: true, force: true })
  })

  const baseUrl = `http://127.0.0.1:${port}`
  let statusResponse: Response | undefined
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test server exited early: ${stderr}`)
    try {
      statusResponse = await fetch(`${baseUrl}/api/auth/status`)
      break
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  assert.ok(statusResponse, `Test server did not become ready: ${stderr}`)
  assert.equal(statusResponse.status, 200)
  assert.deepEqual(await statusResponse.json(), { enabled: true, authenticated: false })

  const page = await fetch(baseUrl)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type') ?? '', /text\/html/)
  assert.match(await page.text(), /Test Dashboard/)

  const asset = await fetch(`${baseUrl}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.match(await asset.text(), /dashboardTest/)

  const protectedResponse = await fetch(`${baseUrl}/api/sessions`)
  assert.equal(protectedResponse.status, 401)

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')
  assert.ok(cookie)
  const authenticatedStatus = await fetch(`${baseUrl}/api/auth/status`, { headers: { cookie: cookie.split(';')[0] } })
  assert.deepEqual(await authenticatedStatus.json(), { enabled: true, authenticated: true })
})
