import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrations } from '../../src/db/migrate.js'
import { createDbClient } from '../../src/db/client.js'

export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-backend-test-'))
  const dbPath = join(dir, 'test.db')
  runMigrations(dbPath)
  const db = createDbClient(dbPath)

  function cleanup() {
    rmSync(dir, { recursive: true, force: true })
  }

  return { db, dbPath, cleanup }
}
