import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDbClient } from './client.js'
import { config } from '../config/env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATION_FILE = resolve(__dirname, '../migrations/001_initial_schema.sql')

export function runMigrations(dbPath = config.dbPath) {
  const db = createDbClient(dbPath)
  const sql = readFileSync(MIGRATION_FILE, 'utf8')
  db.exec(sql)
  const now = new Date().toISOString()
  db.exec(
    `INSERT INTO migration_meta (id, schema_version, applied_at)
     VALUES (1, 1, '${now}')
     ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version, applied_at=excluded.applied_at;`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
  console.log('Migrations applied')
}
