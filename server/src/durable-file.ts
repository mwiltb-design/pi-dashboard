import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

function retryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

export async function renameWithRetry(source: string, target: string, attempts = 6): Promise<void> {
  let delay = 15
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      if (attempt >= attempts - 1 || !retryable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay *= 2
    }
  }
}

export async function atomicWriteFile(path: string, contents: string | Buffer, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, contents, { mode })
  await renameWithRetry(temp, path)
}
