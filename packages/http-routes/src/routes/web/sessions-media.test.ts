import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import Fastify, { type FastifyInstance } from 'fastify'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime/src/better-sqlite3-adapter'
import type { PathProvider } from '@openchatlab/core'
import type { SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import { registerSessionRoutes } from './sessions'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

describe('managed session media route', () => {
  let root: string
  let app: FastifyInstance
  let raw: Database.Database

  beforeEach(async () => {
    const base = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
    root = fs.mkdtempSync(path.join(base, 'chatlab-session-media-'))
    const mediaDir = path.join(root, 'media', 'chat-1')
    fs.mkdirSync(mediaDir, { recursive: true })
    fs.writeFileSync(path.join(mediaDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    raw = new Database(':memory:', { nativeBinding })
    raw.exec(`
      CREATE TABLE message_attachment (
        id INTEGER PRIMARY KEY,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL
      );
      INSERT INTO message_attachment (id, storage_path, mime_type)
      VALUES (1, 'chat-1/image.png', 'image/png');
    `)
    const db = new BetterSqliteAdapter(raw)
    const sessionAdapter: SessionRuntimeAdapter = {
      listSessionIds: () => ['chat-1'],
      openReadonly: () => db,
      openWritable: () => db,
      closeSession: () => undefined,
      getDbPath: () => ':memory:',
      deleteSessionFile: () => false,
      ensureReadonly: () => db,
      ensureWritable: () => db,
    }
    const pathProvider = {
      getUserDataDir: () => root,
      getSystemDir: () => root,
      getCacheDir: () => path.join(root, 'cache'),
    } as PathProvider

    app = Fastify()
    registerSessionRoutes(app, { sessionAdapter, pathProvider })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    raw.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('streams a managed image with its stored MIME type', async () => {
    const response = await app.inject({ method: 'GET', url: '/_web/sessions/chat-1/attachments/1' })
    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'] || '', /^image\/png/)
    assert.deepEqual(response.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('returns 404 for missing attachment ids', async () => {
    const response = await app.inject({ method: 'GET', url: '/_web/sessions/chat-1/attachments/404' })
    assert.equal(response.statusCode, 404)
  })
})
