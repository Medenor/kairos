import { ApiError } from '../errors.js'
import { parseJsonBody } from '../validation.js'

export function registerMigrationRoutes(addRoute, deps) {
  addRoute('POST', '/api/v1/workspaces/:workspaceId/migrations/local-storage', async (ctx) => {
    const workspace = deps.repos.workspace.getById(ctx.params.workspaceId)
    if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found')
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
      userId: workspace.created_by_user_id,
      idempotencyKey,
      payload: body,
    })
    deps.idempotency.write(ctx.params.workspaceId, '/migrations/local-storage', idempotencyKey, result)
    return { status: 202, body: result }
  })

  addRoute('GET', '/api/v1/workspaces/:workspaceId/migrations/:jobId', async (ctx) => {
    const workspace = deps.repos.workspace.getById(ctx.params.workspaceId)
    if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found')
    const status = deps.services.migration.getStatus(ctx.params.workspaceId, ctx.params.jobId)
    return { status: 200, body: status }
  })
}
