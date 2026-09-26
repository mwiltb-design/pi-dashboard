const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn, fork, execSync } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')

let mainWindow = null
let backendProcess = null
let frontendProcess = null

const DEFAULT_UI_PORT = Number(process.env.UI_PORT || process.env.PI_DASHBOARD_PORT || 5173)
const DEFAULT_BACKEND_PORT = Number(process.env.BACKEND_PORT || 4317)
const ROOT_DIR = path.resolve(__dirname, '..')

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(startPort, excludePorts = []) {
  let port = startPort
  while (excludePorts.includes(port) || await isPortInUse(port)) {
    port += 1
  }
  return port
}

function getResourcePath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath)
  }
  return path.join(ROOT_DIR, relativePath)
}

function findServerScript() {
  const candidates = [
    getResourcePath('server/dist/index.js'),
    path.join(__dirname, '../server/dist/index.js'),
    path.join(__dirname, 'server/dist/index.js'),
    path.join(process.resourcesPath, 'server/dist/index.js'),
    path.join(process.resourcesPath, 'app/server/dist/index.js'),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function findUiDist() {
  const candidates = [
    getResourcePath('ui/dist'),
    path.join(__dirname, '../ui/dist'),
    path.join(__dirname, 'ui/dist'),
    path.join(process.resourcesPath, 'ui/dist'),
    path.join(process.resourcesPath, 'app/ui/dist'),
  ]
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html')))
}

function findIcon() {
  const candidates = [
    getResourcePath('assets/icon.png'),
    path.join(__dirname, '../assets/icon.png'),
    path.join(__dirname, 'assets/icon.png'),
    path.join(process.resourcesPath, 'assets/icon.png'),
    path.join(process.resourcesPath, 'app/assets/icon.png'),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function killChild(child) {
  if (!child || !child.pid) return
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {}
}

async function startServices() {
  const isWindows = process.platform === 'win32'
  const isPackaged = app.isPackaged || process.env.NODE_ENV === 'production'
  const serverScript = findServerScript()
  const uiDist = findUiDist()

  // In packaged production, or if pre-built server and UI are present and not explicitly dev
  const runPackaged = isPackaged || (Boolean(serverScript && uiDist) && process.env.NODE_ENV !== 'development' && !process.env.VITE_DEV)

  // Resolve distinct available ports
  const backendPort = await findAvailablePort(DEFAULT_BACKEND_PORT)
  const uiPort = runPackaged ? backendPort : await findAvailablePort(DEFAULT_UI_PORT, [backendPort])

  console.log(`[Foci Dashboard] Mode: ${runPackaged ? 'Production' : 'Development'} | UI Port: ${uiPort} | Backend Port: ${backendPort}`)

  const defaultProjectsRoot = path.resolve(require('node:os').homedir(), 'Pi-Dashboards')
  const workspacePath = process.env.PI_WORKSPACE || process.env.PI_DASHBOARD_WORKSPACE || path.resolve(defaultProjectsRoot, 'Default')
  try { fs.mkdirSync(workspacePath, { recursive: true }) } catch {}

  const configuredOrigins = (process.env.PI_DASHBOARD_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const localOrigins = [`http://localhost:${uiPort}`, `http://127.0.0.1:${uiPort}`, `http://localhost:${backendPort}`, `http://127.0.0.1:${backendPort}`]
  const mergedOrigins = [...new Set([...localOrigins, ...configuredOrigins])].join(',')

  const nodePathCandidates = [
    path.join(process.resourcesPath, 'node_modules'),
    path.join(process.resourcesPath, 'server/node_modules'),
    path.join(ROOT_DIR, 'node_modules'),
  ].filter((p) => fs.existsSync(p)).join(path.delimiter)

  const extraPaths = isWindows ? [
    'C:\\Program Files\\nodejs',
    'C:\\Program Files (x86)\\nodejs',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node'),
    path.join(process.env.APPDATA || '', 'npm'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd'),
    'C:\\Program Files\\Git\\cmd',
  ].filter((p) => p && fs.existsSync(p)) : []

  const currentPath = process.env.PATH || ''
  const enrichedPath = extraPaths.length
    ? [...extraPaths, ...currentPath.split(path.delimiter)].filter(Boolean).join(path.delimiter)
    : currentPath

  const env = {
    ...process.env,
    PATH: enrichedPath,
    PORT: String(backendPort),
    HOST: '127.0.0.1',
    NODE_ENV: runPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
    PI_DASHBOARD_WORKSPACE: workspacePath,
    PI_DASHBOARD_ALLOWED_ORIGINS: mergedOrigins,
    DASHBOARD_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    ...(uiDist ? { PI_DASHBOARD_UI_DIST: uiDist } : {}),
    ...(nodePathCandidates ? { NODE_PATH: nodePathCandidates } : {}),
  }

  if (runPackaged && serverScript) {
    // Determine real filesystem working directory
    const scriptParent = path.dirname(path.dirname(serverScript))
    let serverCwd = workspacePath
    if (fs.existsSync(scriptParent) && !scriptParent.includes('.asar')) {
      serverCwd = scriptParent
    } else if (fs.existsSync(process.resourcesPath)) {
      serverCwd = process.resourcesPath
    }

    console.log(`[Foci Dashboard] Spawning backend from: ${serverScript} (CWD: ${serverCwd})`)

    // Start Backend via Electron's embedded Node runtime (ELECTRON_RUN_AS_NODE=1)
    backendProcess = spawn(process.execPath, [serverScript], {
      cwd: serverCwd,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    backendProcess.stdout?.on('data', (data) => {
      console.log(`[Backend stdout] ${data.toString().trim()}`)
    })

    backendProcess.stderr?.on('data', (data) => {
      console.error(`[Backend stderr] ${data.toString().trim()}`)
    })

    backendProcess.on('error', (err) => {
      console.error('[Foci Dashboard] Backend process spawn error:', err)
    })

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Foci Dashboard] Backend process exited with code ${code} / signal ${signal}`)
    })

    frontendProcess = null
  } else {
    // Development fallback using npx
    const npxCmd = isWindows ? 'npx.cmd' : 'npx'

    backendProcess = spawn(npxCmd, ['tsx', 'src/index.ts'], {
      cwd: path.join(ROOT_DIR, 'server'),
      env,
      stdio: 'ignore',
      windowsHide: true,
      shell: isWindows,
    })

    frontendProcess = spawn(npxCmd, ['vite', '--port', String(uiPort), '--host', '127.0.0.1'], {
      cwd: path.join(ROOT_DIR, 'ui'),
      env: { ...env, VITE_BACKEND_PORT: String(backendPort) },
      stdio: 'ignore',
      windowsHide: true,
      shell: isWindows,
    })
  }

  return { uiPort, backendPort }
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 500) resolve(true)
          else reject(new Error(`Status ${res.statusCode}`))
        })
        req.on('error', reject)
        req.setTimeout(1000, () => req.destroy())
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function createWindow(uiPort, backendPort) {
  const iconPath = findIcon()

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0a0d10',
    title: 'Foci Dashboard',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const backendUrl = `http://127.0.0.1:${backendPort}/api/auth/status`
  const targetUrl = `http://127.0.0.1:${uiPort}`

  // Wait for backend API and UI to be fully ready
  await waitForServer(backendUrl, 20000)
  if (frontendProcess) {
    await waitForServer(targetUrl, 20000)
  }

  mainWindow.loadURL(targetUrl)

  mainWindow.on('closed', () => {
    mainWindow = null
    killChild(backendProcess)
    killChild(frontendProcess)
  })
}

app.whenReady().then(async () => {
  const { uiPort, backendPort } = await startServices()
  await createWindow(uiPort, backendPort)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(uiPort, backendPort)
  })

  app.on('will-quit', () => {
    killChild(backendProcess)
    killChild(frontendProcess)
  })
})

app.on('window-all-closed', () => {
  killChild(backendProcess)
  killChild(frontendProcess)
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
