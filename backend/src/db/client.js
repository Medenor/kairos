import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

function ensureDbDir(dbPath) {
  const absPath = resolve(process.cwd(), dbPath)
  mkdirSync(dirname(absPath), { recursive: true })
  return absPath
}

function shellOut(dbPath, args) {
  return execFileSync('sqlite3', [dbPath, ...args], { encoding: 'utf8' })
}

export function quoteSql(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

export function createDbClient(dbPath) {
  const absPath = ensureDbDir(dbPath)

  function exec(sql) {
    shellOut(absPath, [sql])
  }

  function query(sql) {
    const raw = shellOut(absPath, ['-json', sql]).trim()
    if (!raw) return []
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  function transaction(work) {
    exec('BEGIN IMMEDIATE;')
    try {
      const result = work({ exec, query })
      exec('COMMIT;')
      return result
    } catch (error) {
      exec('ROLLBACK;')
      throw error
    }
  }

  return {
    dbPath: absPath,
    exec,
    query,
    transaction,
  }
}
