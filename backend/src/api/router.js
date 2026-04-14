import { createIdempotencyMiddleware } from './idempotency.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import { registerRecordRoutes } from './routes/record-routes.js'
import { registerSyncRoutes } from './routes/sync-routes.js'
import { registerMigrationRoutes } from './routes/migration-routes.js'
import { registerBackupRoutes } from './routes/backup-routes.js'

function compilePattern(pattern) {
  const keys = []
  const regex = new RegExp(
    `^${pattern.replace(/:[A-Za-z0-9_]+/g, (match) => {
      keys.push(match.slice(1))
      return '([^/]+)'
    })}$`
  )
  return { regex, keys }
}

export function createApiRouter(deps) {
  const routes = []
  const idempotency = createIdempotencyMiddleware(deps.db)

  function addRoute(method, path, handler, options = {}) {
    const { regex, keys } = compilePattern(path)
    routes.push({ method, regex, keys, handler, options })
  }

  function registerAll() {
    registerAuthRoutes(addRoute, deps)
    registerRecordRoutes(addRoute, deps)
    registerSyncRoutes(addRoute, deps)
    registerMigrationRoutes(addRoute, { ...deps, idempotency })
    registerBackupRoutes(addRoute, deps)
  }

  registerAll()

  async function handle(ctx) {
    const method = ctx.req.method.toUpperCase()
    const path = ctx.url.pathname
    for (const route of routes) {
      if (route.method !== method) continue
      const match = path.match(route.regex)
      if (!match) continue
      const params = {}
      route.keys.forEach((key, idx) => {
        params[key] = decodeURIComponent(match[idx + 1])
      })
      ctx.params = params
      return route.handler(ctx)
    }
    return null
  }

  return {
    handle,
    addRoute,
  }
}
