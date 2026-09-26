import { build } from 'esbuild'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function run() {
  console.log('[server] Building backend with esbuild...')

  // Build main server entrypoint
  await build({
    entryPoints: [resolve(__dirname, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: {
      js: `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`,
    },
    external: ['@homebridge/node-pty-prebuilt-multiarch', 'fsevents'],
    outfile: resolve(__dirname, 'dist/index.js'),
    sourcemap: true,
  })

  // Build worker supervisor process
  await build({
    entryPoints: [resolve(__dirname, 'src/worker-supervisor-process.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: {
      js: `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`,
    },
    external: ['@homebridge/node-pty-prebuilt-multiarch', 'fsevents'],
    outfile: resolve(__dirname, 'dist/worker-supervisor-process.js'),
    sourcemap: true,
  })

  // Copy Node 20 undici compatibility polyfill
  copyFileSync(resolve(__dirname, 'templates/node20-compat.cjs'), resolve(__dirname, 'dist/node20-compat.cjs'))

  console.log('[server] Server bundle ready at dist/index.js')
}

run().catch((err) => {
  console.error('[server] Build failed:', err)
  process.exit(1)
})
