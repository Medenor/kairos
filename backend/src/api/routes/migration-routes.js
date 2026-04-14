import { requireAuth } from '../../auth/middleware.js'
import { ApiError } from '../errors.js'
import { parseJsonBody } from '../validation.js'

export function registerMigrationRoutes(addRoute, deps) {
  addRoute('POST', '/api/v1/workspaces/:workspaceId/migrations/local-storage', async (ctx) => {
    const auth = requireAuth({ ...ctx, services: deps.services, db: deps.db })
    const membership = deps.repos.workspaceMember.getMembership(ctx.params.workspaceId, auth.user.id)
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Not a member of this workspace')
    const idempotencyKey = deps.idempotency.requireKey(ctx)
    const cached = deps.idempotency.read(
      ctx.params.workspaceId,
      '/migrations/local-storage',
      idempotencyKey
    )
    if (cached) {
      return { status: 202, body: cached }
    }
    const body = await parseJsonBody(ctx.req)
    const result = deps.services.migration.run({
      workspaceId: ctx.params.workspaceId,
      userId: auth.user.id,
      idempotencyKey,
      payload: body,
    })
    deps.idempotency.write(ctx.params.workspaceId, '/migrations/local-storage', idempotencyKey, result)
    return { status: 202, body: result }
  })

  addRoute('GET', '/api/v1/workspaces/:workspaceId/migrations/:jobId', async (ctx) => {
    const auth = requireAuth({ ...ctx, services: deps.services, db: deps.db })
    const membership = deps.repos.workspaceMember.getMembership(ctx.params.workspaceId, auth.user.id)
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Not a member of this workspace')
    const status = deps.services.migration.getStatus(ctx.params.workspaceId, ctx.params.jobId)
    return { status: 200, body: status }
  })
}
