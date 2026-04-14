import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { config } from './config/env.js'
import { runMigrations } from './db/migrate.js'
import { createDbClient } from './db/client.js'
import { createSessionService } from './auth/session.js'
import { hashPassword } from './auth/password.js'
import { createWorkspaceRepo } from './db/repositories/workspace-repo.js'
import { createWorkspaceMemberRepo } from './db/repositories/workspace-member-repo.js'
import { createSharedRecordRepo } from './db/repositories/shared-record-repo.js'
import { createRecordRevisionRepo } from './db/repositories/record-revision-repo.js'
import { createMigrationJobRepo } from './db/repositories/migration-job-repo.js'
import { createBackupSnapshotRepo } from './db/repositories/backup-snapshot-repo.js'
import { createSecurityEventService } from './services/security-event-service.js'
import { createSharedRecordService } from './services/shared-record-service.js'
import { createMigrationService } from './services/migration-service.js'
import { createBackupService } from './services/backup-service.js'
import { createApiRouter } from './api/router.js'
import { createLanRestriction } from './api/lan-restriction.js'
import { ApiError, toErrorEnvelope } from './api/errors.js'

function json(res, status, body) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type,idempotency-key,authorization')
  if (status === 204) {
    res.writeHead(204)
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function createApp({
  dbPath = config.dbPath,
  host = config.host,
  port = config.port,
  seedDemoData = true,
} = {}) {
  runMigrations(dbPath)
  const db = createDbClient(dbPath)

  if (seedDemoData) {
    const hasUsers = db.query('SELECT id FROM users LIMIT 1;').length > 0
    if (!hasUsers) {
      const userId = randomUUID()
      const workspaceId = randomUUID()
      const now = new Date().toISOString()
      db.exec(`
        INSERT INTO users (id, username, password_hash, role, is_active, created_at)
        VALUES ('${userId}', 'owner', '${hashPassword('password123')}', 'owner', 1, '${now}');
        INSERT INTO workspaces (id, name, created_by_user_id, created_at, updated_at)
        VALUES ('${workspaceId}', 'Default Workspace', '${userId}', '${now}', '${now}');
        INSERT INTO workspace_members (workspace_id, user_id, permission, joined_at)
        VALUES ('${workspaceId}', '${userId}', 'admin', '${now}');
      `)
    }
  }

  const repos = {
    workspace: createWorkspaceRepo(db),
    workspaceMember: createWorkspaceMemberRepo(db),
    sharedRecord: createSharedRecordRepo(db),
    recordRevision: createRecordRevisionRepo(db),
    migrationJob: createMigrationJobRepo(db),
    backupSnapshot: createBackupSnapshotRepo(db),
  }

  const securityEvents = createSecurityEventService(db)
  const services = {
    session: createSessionService(db, { ttlSeconds: config.sessionTtlSeconds }),
    securityEvents,
    sharedRecords: createSharedRecordService({
      sharedRecordRepo: repos.sharedRecord,
      recordRevisionRepo: repos.recordRevision,
    }),
    migration: null,
    backup: null,
  }

  services.migration = createMigrationService({
    migrationJobRepo: repos.migrationJob,
    sharedRecordService: services.sharedRecords,
  })
  services.backup = createBackupService({
    backupSnapshotRepo: repos.backupSnapshot,
    db,
    securityEvents,
  })

  const enforceLanOnly = createLanRestriction({
    enabled: config.lanOnly,
    allowedSubnets: config.allowedSubnets,
    securityEvents,
  })

  const router = createApiRouter({ db, repos, services, config })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const ctx = { req, res, url, db, repos, services, config }

    try {
      if (req.method === 'OPTIONS') {
        return json(res, 204, null)
      }
      if (url.pathname === '/health') {
        return json(res, 200, { status: 'ok' })
      }
      if (!url.pathname.startsWith(config.apiPrefix)) {
        return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } })
      }
      enforceLanOnly(ctx)
      const routeResponse = await router.handle(ctx)
      if (!routeResponse) {
        return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } })
      }
      return json(res, routeResponse.status, routeResponse.body)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        // eslint-disable-next-line no-console
        console.error(error)
      }
      const formatted = toErrorEnvelope(error)
      return json(res, formatted.status, formatted.body)
    }
  })

  return {
    db,
    repos,
    services,
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve({ host, port }))
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp()
  app.listen().then(({ host, port }) => {
    // eslint-disable-next-line no-console
    console.log(`Kairos backend listening on http://${host}:${port}`)
  })
}
