import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { FileAccessError, FileService } from '../src/file-service.js'

test('uploads files into uploaded and numbers duplicate names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-upload-'))
  try {
    const service = new FileService(root)
    const first = await service.upload('report.txt', Readable.from(['first']))
    const second = await service.upload('report.txt', Readable.from(['second']))
    assert.equal(first.path, 'uploaded/report.txt')
    assert.equal(second.path, 'uploaded/report (2).txt')
    assert.equal(await readFile(join(root, first.path), 'utf8'), 'first')
    assert.equal(await readFile(join(root, second.path), 'utf8'), 'second')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects unsafe upload names and empty files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-upload-'))
  try {
    const service = new FileService(root)
    await assert.rejects(service.upload('../outside.txt', Readable.from(['no'])), FileAccessError)
    await assert.rejects(service.upload('.env', Readable.from(['secret'])), /Sensitive/)
    await assert.rejects(service.upload('empty.txt', Readable.from([])), /Empty/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('returns validated PDFs for inline viewing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-upload-'))
  try {
    const service = new FileService(root)
    const body = Buffer.from('%PDF-1.7\nexample\n%%EOF')
    const uploaded = await service.upload('sample.pdf', Readable.from([body]))
    assert.deepEqual(await service.pdf(uploaded.path), body)
    const text = await service.upload('fake.pdf', Readable.from(['not a pdf']))
    await assert.rejects(service.pdf(text.path), /not a valid PDF/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
